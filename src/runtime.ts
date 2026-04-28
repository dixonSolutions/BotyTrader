import { loadConfig, loadSecrets, resolvePaths, type Config, type Secrets } from "./config.js";
import { createBrokerAdapter } from "./execution/adapters/index.js";
import { ModelManager } from "./llm/model_manager.js";
import { DisabledMemoryStore } from "./memory/disabled_store.js";
import { GeminiEmbedder } from "./memory/embedder.js";
import { HfBucket } from "./memory/hf.js";
import { MemoryStore } from "./memory/store.js";
import { Orchestrator } from "./orchestrator.js";

export async function bootstrapOrchestrator(
  config: Config,
  secrets: Secrets,
): Promise<Orchestrator> {
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

export function loadRuntime(root = process.cwd()) {
  const paths = resolvePaths(root);
  const config = loadConfig(paths);
  const secrets = loadSecrets(config, paths);
  return { paths, config, secrets };
}
