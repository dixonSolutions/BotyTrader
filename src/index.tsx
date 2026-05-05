/**
 * BotyTrader entry point.
 *
 * Startup sequence (mirrors docs/configuration.md → "Startup validation flow"):
 *   1. Load config.toml (creating from example if absent).
 *   2. Load .env into process.env, then run SecretsSchema.
 *   3. PASS  -> bootstrap orchestrator + render main TUI.
 *      FAIL  -> render the Setup wizard, persist values, then re-run the flow.
 */

import React from "react";
import { render, useInput } from "ink";
import { MouseProvider } from "@zenobius/ink-mouse";
import path from "node:path";

import { App } from "./tui/app.js";
import { AlternateScreen } from "./tui/AlternateScreen.js";
import { ViewportRoot } from "./tui/ViewportRoot.js";
import { Setup } from "./tui/screens/Setup.js";
import { bootstrapOrchestrator, loadRuntime } from "./runtime.js";
import { runServiceAction, type ServiceAction } from "./service.js";

/**
 * Ink only enables TTY raw mode while a `useInput` hook is active. Screens without a
 * text field (e.g. Home) would otherwise leave echo on, so SGR mouse bytes show as
 * `^[[<…` noise. A no-op listener keeps stdin raw for the whole session; Ctrl+C is
 * still handled by Ink before this callback runs.
 */
function KeepStdinRaw(): null {
  useInput(() => {}, { isActive: true });
  return null;
}

interface CliOptions {
  mode: "tui" | "run" | "service" | "help";
  cwd: string;
  serviceAction?: ServiceAction;
  startAfterInstall: boolean;
}

async function runTui(root: string): Promise<void> {
  process.chdir(root);
  const { config, secrets, logService } = loadRuntime(root);

  if (secrets.ok) {
    const orchestrator = await bootstrapOrchestrator(config, secrets.secrets, logService);
    render(
      <MouseProvider>
        <AlternateScreen />
        <KeepStdinRaw />
        <ViewportRoot>
          <App orchestrator={orchestrator} logService={logService} />
        </ViewportRoot>
      </MouseProvider>,
    );
    return;
  }

  // Render the Setup wizard; once complete, re-validate and continue the flow.
  await new Promise<void>((resolve) => {
    const ink = render(
      <MouseProvider>
        <AlternateScreen />
        <KeepStdinRaw />
        <ViewportRoot>
          <Setup
            brokerName={config.broker.platform}
            missing={secrets.missing}
            onComplete={() => {
              ink.unmount();
              resolve();
            }}
            onAbort={() => {
              ink.unmount();
              process.exit(0);
            }}
          />
        </ViewportRoot>
      </MouseProvider>,
    );
  });

  await runTui(root);
}

async function runHeadless(root: string): Promise<void> {
  process.chdir(root);
  const { config, secrets } = loadRuntime(root);
  if (!secrets.ok) {
    throw new Error(
      `Cannot start background bot; missing required secrets: ${secrets.missing.join(", ")}. Run the TUI setup first.`,
    );
  }

  const orchestrator = await bootstrapOrchestrator(config, secrets.secrets);
  let printedLogs = 0;
  const unsubscribe = orchestrator.subscribe((state) => {
    const nextLogs = state.logs.slice(printedLogs);
    printedLogs = state.logs.length;
    for (const entry of nextLogs) {
      console.log(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}`);
    }
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`Received ${signal}; stopping BotyTrader.`);
    unsubscribe();
    orchestrator.stop();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(`BotyTrader background scheduler running from ${root}`);
  await new Promise(() => {});
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  if (options.mode === "help") {
    printHelp();
    return;
  }

  if (options.mode === "run") {
    await runHeadless(options.cwd);
    return;
  }

  if (options.mode === "service") {
    if (!options.serviceAction) throw new Error("Missing service action.");
    runServiceAction(options.serviceAction, {
      cwd: options.cwd,
      startAfterInstall: options.startAfterInstall,
    });
    return;
  }

  await runTui(options.cwd);
}

function parseCli(argv: string[]): CliOptions {
  const args = [...argv];
  const options: CliOptions = {
    mode: "tui",
    cwd: process.cwd(),
    startAfterInstall: true,
  };

  const command = args[0]?.startsWith("-") ? undefined : args.shift();
  if (command === "run") options.mode = "run";
  else if (command === "service") options.mode = "service";
  else if (command === "dashboard" || command === "tui" || command === undefined) options.mode = "tui";
  else if (command === "help" || command === "--help" || command === "-h") options.mode = "help";
  else throw new Error(`Unknown command: ${command}`);

  if (options.mode === "service") {
    const action = args[0]?.startsWith("-") ? undefined : args.shift();
    if (!action || !isServiceAction(action)) {
      throw new Error("Service command requires one of: install, uninstall, start, stop, restart, status, logs.");
    }
    options.serviceAction = action;
  }

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--cwd") {
      const cwd = args.shift();
      if (!cwd) throw new Error("--cwd requires a directory.");
      options.cwd = cwd;
    } else if (arg === "--no-start") {
      options.startAfterInstall = false;
    } else if (arg === "--help" || arg === "-h") {
      options.mode = "help";
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { ...options, cwd: pathResolve(options.cwd) };
}

function isServiceAction(value: string): value is ServiceAction {
  return ["install", "uninstall", "start", "stop", "restart", "status", "logs"].includes(value);
}

function pathResolve(value: string): string {
  const expanded = value.startsWith("~")
    ? value.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")
    : value;
  return path.resolve(expanded);
}

function printHelp(): void {
  console.log(`BotyTrader

Usage:
  botytrader                         Launch the TUI dashboard
  botytrader run [--cwd DIR]         Run the scheduler without the TUI
  botytrader service install         Install and start the background user service
  botytrader service uninstall       Stop and remove the background user service
  botytrader service status          Show service status
  botytrader service logs            Follow service logs

Options:
  --cwd DIR       Config directory containing config.toml and .env
  --no-start      Install service without starting it immediately
`);
}

main().catch((err) => {
  console.error("BotyTrader failed to start:", err);
  process.exit(1);
});
