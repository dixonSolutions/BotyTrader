/**
 * Stable row ids and copy for Config global search (Settings / Secrets / Schedule).
 */

import { SECRET_DESCRIPTIONS, SecretsSchema, BrokerPlatformSchema } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

export type ConfigTabId = "settings" | "secrets" | "schedule";

export interface ConfigSearchHit {
  tab: ConfigTabId;
  /** Row id passed to editors to focus (field id, secret key, or schedule field id). */
  rowId: string;
  title: string;
  subtitle?: string;
}

const BROKER_OPTIONS = BrokerPlatformSchema.options;

function settingsHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const rows: { rowId: string; label: string; valueHint: string; extra?: string }[] = [
    { rowId: "autotrade", label: "Autotrade", valueHint: String(config.autotrade.enabled) },
    {
      rowId: "memory_enabled",
      label: "Memory (RAG + HF writes)",
      valueHint: String(config.features.memory_enabled),
    },
    {
      rowId: "web_search_enabled",
      label: "Web search (Brave tool)",
      valueHint: String(config.features.web_search_enabled),
    },
    {
      rowId: "broker",
      label: "Broker platform",
      valueHint: config.broker.platform,
      extra: `Platforms: ${BROKER_OPTIONS.join(", ")}`,
    },
    { rowId: "watchlist", label: "Watchlist (comma-separated)", valueHint: config.watchlist.symbols.join(", ") },
    { rowId: "max_position_pct", label: "Max position %", valueHint: String(config.risk.max_position_pct) },
    {
      rowId: "min_confidence_to_trade",
      label: "Min confidence to trade (0-1)",
      valueHint: String(config.risk.min_confidence_to_trade),
    },
    { rowId: "stop_loss_pct", label: "Stop loss %", valueHint: String(config.risk.stop_loss_pct) },
    { rowId: "take_profit_pct", label: "Take profit %", valueHint: String(config.risk.take_profit_pct) },
    { rowId: "embedding_model", label: "Embedding model", valueHint: config.gemini.embedding_model },
    {
      rowId: "active_model",
      label: "Active local model",
      valueHint: config.model.id || "(none)",
    },
    { rowId: "model_dtype", label: "Model dtype (quantisation)", valueHint: config.model.dtype },
    { rowId: "model_device", label: "Inference device", valueHint: config.model.device },
    {
      rowId: "max_new_tokens",
      label: "Max new tokens / turn",
      valueHint: String(config.model.max_new_tokens),
    },
    { rowId: "hf_bucket", label: "HF bucket", valueHint: config.huggingface.bucket_name },
  ];
  return rows.map((r) => ({
    tab: "settings" as const,
    rowId: r.rowId,
    title: r.label,
    subtitle: r.extra ? `Current: ${r.valueHint} · ${r.extra}` : `Current: ${r.valueHint}`,
  }));
}

function secretsHits(): ConfigSearchHit[] {
  const keys = Object.keys(SecretsSchema.shape) as (keyof typeof SECRET_DESCRIPTIONS)[];
  return keys.map((k) => ({
    tab: "secrets" as const,
    rowId: k,
    title: k,
    subtitle: SECRET_DESCRIPTIONS[k],
  }));
}

function scheduleHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  return [
    {
      tab: "schedule" as const,
      rowId: "agent",
      title: "Agent cycle interval (seconds)",
      subtitle: `Current: ${config.schedule.agent_interval_seconds}s`,
    },
    {
      tab: "schedule" as const,
      rowId: "exit",
      title: "Exit monitor interval (seconds)",
      subtitle: `Current: ${config.schedule.exit_monitor_interval_seconds}s`,
    },
  ];
}

export function buildConfigSearchHits(orchestrator: Orchestrator): ConfigSearchHit[] {
  return [
    ...settingsHits(orchestrator.config),
    ...secretsHits(),
    ...scheduleHits(orchestrator.config),
  ];
}

export function hitHaystack(hit: ConfigSearchHit): string {
  return [hit.tab, hit.rowId, hit.title, hit.subtitle ?? ""].join(" ").toLowerCase();
}

export function matchesConfigFilter(query: string, haystack: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.includes(q);
}
