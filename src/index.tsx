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

import { App } from "./tui/app.js";
import { AlternateScreen } from "./tui/AlternateScreen.js";
import { ViewportRoot } from "./tui/ViewportRoot.js";
import { Setup } from "./tui/screens/Setup.js";
import {
  loadConfig,
  loadSecrets,
  resolvePaths,
  type Config,
  type Secrets,
} from "./config.js";
import { createBrokerAdapter } from "./execution/adapters/index.js";
import { DisabledMemoryStore } from "./memory/disabled_store.js";
import { GeminiEmbedder } from "./memory/embedder.js";
import { HfBucket } from "./memory/hf.js";
import { MemoryStore } from "./memory/store.js";
import { Orchestrator } from "./orchestrator.js";
import { ModelManager } from "./llm/model_manager.js";

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

async function bootstrap(config: Config, secrets: Secrets): Promise<Orchestrator> {
  const broker = createBrokerAdapter(config.broker.platform, secrets);
  const memory = config.features.memory_enabled
    ? new MemoryStore({
        bucket: new HfBucket({
          bucketName: config.huggingface.bucket_name,
          endpoint: config.huggingface.endpoint,
          region: config.huggingface.region,
          token: secrets.HF_TOKEN!,
        }),
        embedder: new GeminiEmbedder({
          apiKey: secrets.GEMINI_API_KEY!,
          model: config.gemini.embedding_model,
        }),
      })
    : new DisabledMemoryStore();

  const models = new ModelManager(config);
  const orchestrator = new Orchestrator({ config, secrets, broker, memory, models });
  await orchestrator.start();
  return orchestrator;
}

async function main(): Promise<void> {
  const paths = resolvePaths();
  const config = loadConfig(paths);
  const result = loadSecrets(config, paths);

  if (result.ok) {
    const orchestrator = await bootstrap(config, result.secrets);
    render(
      <MouseProvider>
        <AlternateScreen />
        <KeepStdinRaw />
        <ViewportRoot>
          <App orchestrator={orchestrator} />
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
            missing={result.missing}
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

  await main();
}

main().catch((err) => {
  console.error("BotyTrader failed to start:", err);
  process.exit(1);
});
