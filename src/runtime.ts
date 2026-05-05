import { loadConfig, loadSecrets, resolvePaths, type Config, type Secrets } from "./config.js";
import { createBrokerAdapter } from "./execution/adapters/index.js";
import { Orchestrator } from "./orchestrator.js";
import { LogService } from "./services/logService.js";
import { container } from "./services/container.js";

export async function bootstrapOrchestrator(
  config: Config,
  secrets: Secrets,
  logService?: LogService,
): Promise<Orchestrator> {
  const logs = logService ?? container.tryResolve("logs") ?? new LogService();
  const broker = createBrokerAdapter(config.broker.platform, secrets);

  // Register the active broker adapter for any downstream consumers.
  container.register("alpaca", broker);
  container.register("logs", logs);

  const orchestrator = new Orchestrator({ config, secrets, broker, logService: logs });
  await orchestrator.start();
  return orchestrator;
}

export function loadRuntime(root = process.cwd()) {
  const paths = resolvePaths(root);
  const config = loadConfig(paths);
  const secrets = loadSecrets(config, paths);

  // Bootstrap the log service first so it is available before the orchestrator.
  const logService = new LogService();
  container.register("logs", logService);

  return { paths, config, secrets, logService };
}
