/**
 * Stable row ids and copy for Config global search (Settings / Secrets / Schedule).
 */

import { SECRET_DESCRIPTIONS, SecretsSchema, BrokerPlatformSchema } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

export type ConfigTabId = "settings" | "trading" | "discovery" | "secrets" | "schedule";

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

function tradingHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const s = config.strategy.simple;
  const rows: { rowId: string; label: string; valueHint: string }[] = [
    { rowId: "trading_enabled", label: "Trading engine", valueHint: String(config.trading.enabled) },
    { rowId: "trading_mode", label: "Paper / live (Alpaca)", valueHint: config.trading.mode },
    { rowId: "db_path", label: "SQLite database path", valueHint: config.trading.database_path },
    { rowId: "simple_enabled", label: "Simple strategy", valueHint: String(s.enabled) },
    { rowId: "tech_w", label: "Technical weight", valueHint: String(s.technical_weight) },
    { rowId: "sent_w", label: "Sentiment weight", valueHint: String(s.sentiment_weight) },
    { rowId: "buy_th", label: "Buy threshold", valueHint: String(s.buy_threshold) },
    { rowId: "sell_th", label: "Sell threshold", valueHint: String(s.sell_threshold) },
    { rowId: "sent_provider", label: "Sentiment provider", valueHint: config.sentiment.provider },
  ];
  return rows.map((r) => ({
    tab: "trading" as const,
    rowId: r.rowId,
    title: r.label,
    subtitle: `Current: ${r.valueHint}`,
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
    {
      tab: "schedule" as const,
      rowId: "portfolio",
      title: "Portfolio trading cycle (seconds)",
      subtitle: `Current: ${config.schedule.portfolio_cycle_seconds}s`,
    },
    {
      tab: "schedule" as const,
      rowId: "candidate",
      title: "Candidate / watchlist cycle (seconds)",
      subtitle: `Current: ${config.schedule.candidate_cycle_seconds}s`,
    },
    {
      tab: "schedule" as const,
      rowId: "discovery",
      title: "Discovery cycle (seconds)",
      subtitle: `Current: ${config.schedule.discovery_cycle_seconds}s`,
    },
  ];
}

function discoveryHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const d = config.discovery ?? {};
  return [
    {
      tab: "discovery",
      rowId: "discovery_enabled",
      title: "Discovery scanner",
      subtitle: `Enabled: ${d.enabled ?? false}`,
    },
    {
      tab: "discovery",
      rowId: "auto_invest",
      title: "Auto-invest in discoveries",
      subtitle: `Enabled: ${d.auto_invest ?? false} · Threshold: ${d.invest_threshold ?? 0.4}`,
    },
    {
      tab: "discovery",
      rowId: "scan_interval",
      title: "Discovery scan interval",
      subtitle: `Current: ${d.scan_interval_seconds ?? 14400}s (${((d.scan_interval_seconds ?? 14400) / 3600).toFixed(1)}h)`,
    },
    {
      tab: "discovery",
      rowId: "max_candidates",
      title: "Max candidates per scan",
      subtitle: `Current: ${d.max_candidates ?? 20}`,
    },
    {
      tab: "discovery",
      rowId: "min_rank_score",
      title: "Minimum rank score",
      subtitle: `Current: ${d.min_rank_score ?? 50} (0-100)`,
    },
    {
      tab: "discovery",
      rowId: "max_new_positions",
      title: "Max new positions per scan",
      subtitle: `Current: ${d.max_new_positions ?? 3}`,
    },
  ];
}

export function buildConfigSearchHits(orchestrator: Orchestrator): ConfigSearchHit[] {
  return [
    ...settingsHits(orchestrator.config),
    ...tradingHits(orchestrator.config),
    ...discoveryHits(orchestrator.config),
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
