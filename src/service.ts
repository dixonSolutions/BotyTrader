import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SERVICE_NAME = "botytrader.service";

export type ServiceAction =
  | "install"
  | "uninstall"
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "logs";

export interface ServiceOptions {
  cwd: string;
  startAfterInstall: boolean;
}

export function runServiceAction(action: ServiceAction, options: ServiceOptions): void {
  switch (action) {
    case "install":
      installService(options);
      return;
    case "uninstall":
      uninstallService();
      return;
    case "start":
    case "stop":
    case "restart":
      runSystemctl([action, SERVICE_NAME], { inherit: true });
      return;
    case "status":
      runSystemctl([action, SERVICE_NAME], { inherit: true, allowFailure: true });
      return;
    case "logs":
      runJournalctl(["--user", "-u", SERVICE_NAME, "-f"], { inherit: true });
      return;
  }
}

function installService(options: ServiceOptions): void {
  const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
  fs.mkdirSync(serviceDir, { recursive: true });

  const unitPath = path.join(serviceDir, SERVICE_NAME);
  fs.writeFileSync(unitPath, renderUnit(options.cwd));

  runSystemctl(["daemon-reload"]);
  runSystemctl(["enable", SERVICE_NAME]);

  if (options.startAfterInstall) {
    runSystemctl(["restart", SERVICE_NAME]);
  }

  console.log(`Installed ${SERVICE_NAME} for ${options.cwd}`);
  console.log("The scheduler now runs through systemd even when the TUI is closed.");
}

function uninstallService(): void {
  runSystemctl(["disable", "--now", SERVICE_NAME], { allowFailure: true });

  const unitPath = path.join(os.homedir(), ".config", "systemd", "user", SERVICE_NAME);
  if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);

  runSystemctl(["daemon-reload"]);
  console.log(`Removed ${SERVICE_NAME}`);
}

function renderUnit(cwd: string): string {
  const launch = resolveLaunchCommand();
  const args = [...launch.args, "run", "--cwd", cwd];
  const execStart = [launch.command, ...args].map(systemdQuote).join(" ");

  return `[Unit]
Description=BotyTrader scheduled trading bot
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(cwd)}
ExecStart=${execStart}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function resolveLaunchCommand(): { command: string; args: string[] } {
  const override = process.env.BOTYTRADER_SERVICE_EXEC;
  if (override?.trim()) return { command: override.trim(), args: [] };

  const packagedProcess = process as NodeJS.Process & { pkg?: unknown };
  if (packagedProcess.pkg) return { command: process.execPath, args: [] };

  const entry = process.argv[1];
  if (!entry) return { command: process.execPath, args: [] };

  return { command: process.execPath, args: [path.resolve(entry)] };
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function runSystemctl(args: string[], options: { inherit?: boolean; allowFailure?: boolean } = {}): void {
  runCommand("systemctl", ["--user", ...args], options);
}

function runJournalctl(args: string[], options: { inherit?: boolean; allowFailure?: boolean } = {}): void {
  runCommand("journalctl", args, options);
}

function runCommand(
  command: string,
  args: string[],
  options: { inherit?: boolean; allowFailure?: boolean } = {},
): void {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });

  if (result.status === 0 || options.allowFailure) return;

  const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`${command} ${args.join(" ")} failed${details ? `:\n${details}` : ""}`);
}
