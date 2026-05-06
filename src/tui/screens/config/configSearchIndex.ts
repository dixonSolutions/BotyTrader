/**
 * Stable row ids and copy for Config global search (Settings / Secrets / Schedule).
 */

import { SECRET_DESCRIPTIONS, SecretsSchema, BrokerPlatformSchema } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

export type ConfigTabId =
  | "settings"
  | "trading"
  | "models"
  | "indicators"
  | "optimize"
  | "secrets"
  | "schedule";

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
      rowId: "broker",
      label: "Broker platform",
      valueHint: config.broker.platform,
      extra: `Platforms: ${BROKER_OPTIONS.join(", ")}`,
    },
    { rowId: "max_position_pct", label: "Max position %", valueHint: String(config.risk.max_position_pct) },
    {
      rowId: "min_confidence_to_trade",
      label: "Min confidence to trade (0-1)",
      valueHint: String(config.risk.min_confidence_to_trade),
    },
    { rowId: "stop_loss_pct", label: "Stop loss %", valueHint: String(config.risk.stop_loss_pct) },
    { rowId: "take_profit_pct", label: "Take profit %", valueHint: String(config.risk.take_profit_pct) },
  ];
  return rows.map((r) => ({
    tab: "settings" as const,
    rowId: r.rowId,
    title: r.label,
    subtitle: r.extra ? `Current: ${r.valueHint} · ${r.extra}` : `Current: ${r.valueHint}`,
  }));
}

function modelsHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const s = config.sentiment;
  return [
    {
      tab: "models",
      rowId: "finbert_models",
      title: "FinBERT — download & ONNX cache",
      subtitle: `Provider: ${s.provider} · model_id: ${s.model_id}`,
    },
    {
      tab: "models",
      rowId: "finbert_routing",
      title: "FinBERT — API vs local (HF_TOKEN)",
      subtitle: `Hybrid API ratio: ${s.hf_api_runs_numerator}/${s.hf_api_runs_denominator} batches`,
    },
    {
      tab: "models",
      rowId: "hf_token",
      title: "HF_TOKEN (Hugging Face access token)",
      subtitle: "Set in .env or Config → Secrets — required for API / hybrid API slots",
    },
  ];
}

function tradingHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const s = config.strategy.simple;
  const rows: { rowId: string; label: string; valueHint: string }[] = [
    {
      rowId: "watchlist",
      label: "Symbols to trade (comma-separated)",
      valueHint: config.watchlist.symbols.join(", "),
    },
    { rowId: "trading_enabled", label: "Trading engine", valueHint: String(config.trading.enabled) },
    { rowId: "trading_mode", label: "Paper / live (Alpaca)", valueHint: config.trading.mode },
    { rowId: "db_path", label: "SQLite database path", valueHint: config.trading.database_path },
    {
      rowId: "positioning_scalar",
      label: "Buy sizing scalar (trading)",
      valueHint: String(config.trading.positioning_scalar ?? 1),
    },
    { rowId: "simple_enabled", label: "Simple strategy", valueHint: String(s.enabled) },
    { rowId: "tech_w", label: "Technical weight", valueHint: String(s.technical_weight) },
    { rowId: "sent_w", label: "Sentiment weight", valueHint: String(s.sentiment_weight) },
    { rowId: "buy_th", label: "Buy threshold hybrid", valueHint: String(s.buy_threshold) },
    {
      rowId: "buy_trim_th",
      label: "Buy trim hybrid (optional)",
      valueHint: s.buy_trim_threshold !== undefined ? String(s.buy_trim_threshold) : "unset",
    },
    { rowId: "sell_th", label: "Sell exit (full) hybrid", valueHint: String(s.sell_threshold) },
    {
      rowId: "sell_trim_th",
      label: "Sell trim hybrid (optional)",
      valueHint: s.sell_trim_threshold !== undefined ? String(s.sell_trim_threshold) : "unset",
    },
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
  const o = config.optimization ?? {};
  return [
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
      rowId: "agent_interval",
      title: "Agent / LLM cycle interval (seconds)",
      subtitle: `Current: ${config.schedule.agent_interval_seconds}s`,
    },
    {
      tab: "schedule" as const,
      rowId: "schedule_day",
      title: "Optimizer run day (local)",
      subtitle: `Current: ${o.schedule_day ?? "daily"}`,
    },
    {
      tab: "schedule" as const,
      rowId: "schedule_hour",
      title: "Optimizer run hour (local, 0–23)",
      subtitle: `Current: ${o.schedule_hour ?? 2}`,
    },
    {
      tab: "schedule" as const,
      rowId: "outcome_interval",
      title: "Optimizer outcome backfill (minutes)",
      subtitle: `Current: ${o.outcome_monitor_interval_minutes ?? 30} min`,
    },
  ];
}

function optimizationHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const o = config.optimization ?? {};
  return [
    {
      tab: "optimize",
      rowId: "lookback",
      title: "Optimizer — lookback days",
      subtitle: `Enabled: ${o.enabled ?? false} · lookback: ${o.lookback_days ?? 14}d`,
    },
    {
      tab: "optimize",
      rowId: "challengers",
      title: "Optimizer — challenger count",
      subtitle: `Current: ${o.challenger_count ?? 50}`,
    },
    {
      tab: "optimize",
      rowId: "learning_rate",
      title: "Optimizer — learning rate α",
      subtitle: `Current: ${o.learning_rate ?? 0.1}`,
    },
    {
      tab: "optimize",
      rowId: "exit_window",
      title: "Optimizer — snapshot outcome window (hours)",
      subtitle: `Current: ${o.exit_window_hours ?? 48}`,
    },
    {
      tab: "optimize",
      rowId: "challenger_swap",
      title: "Optimizer — challenger swap threshold (0–100)",
      subtitle: `Current: ${o.challenger_swap_threshold ?? 10}`,
    },
    {
      tab: "optimize",
      rowId: "challenger_min_entry",
      title: "Optimizer — challenger min entry score (0–100)",
      subtitle: `Current: ${o.challenger_min_entry_score ?? 75}`,
    },
  ];
}

function indicatorsHits(config: Orchestrator["config"]): ConfigSearchHit[] {
  const ind = config.indicators;
  return [
    {
      tab: "indicators",
      rowId: "sma",
      title: "SMA — Simple Moving Average",
      subtitle: `Weight: ${(ind.sma.weight * 100).toFixed(0)}% · ${ind.sma.enabled ? "Enabled" : "Disabled"} · Trend indicator`,
    },
    {
      tab: "indicators",
      rowId: "ema",
      title: "EMA — Exponential Moving Average",
      subtitle: `Weight: ${(ind.ema.weight * 100).toFixed(0)}% · ${ind.ema.enabled ? "Enabled" : "Disabled"} · Trend indicator`,
    },
    {
      tab: "indicators",
      rowId: "rsi",
      title: "RSI — Relative Strength Index",
      subtitle: `Weight: ${(ind.rsi.weight * 100).toFixed(0)}% · ${ind.rsi.enabled ? "Enabled" : "Disabled"} · Momentum oscillator`,
    },
    {
      tab: "indicators",
      rowId: "macd",
      title: "MACD — Moving Average Convergence Divergence",
      subtitle: `Weight: ${(ind.macd.weight * 100).toFixed(0)}% · ${ind.macd.enabled ? "Enabled" : "Disabled"} · Momentum indicator`,
    },
    {
      tab: "indicators",
      rowId: "bollinger",
      title: "Bollinger Bands",
      subtitle: `Weight: ${(ind.bollinger.weight * 100).toFixed(0)}% · ${ind.bollinger.enabled ? "Enabled" : "Disabled"} · Volatility bands`,
    },
    {
      tab: "indicators",
      rowId: "stochastic",
      title: "Stochastic Oscillator",
      subtitle: `Weight: ${(ind.stochastic.weight * 100).toFixed(0)}% · ${ind.stochastic.enabled ? "Enabled" : "Disabled"} · Momentum indicator`,
    },
    {
      tab: "indicators",
      rowId: "atr",
      title: "ATR — Average True Range",
      subtitle: `Weight: ${(ind.atr.weight * 100).toFixed(0)}% · ${ind.atr.enabled ? "Enabled" : "Disabled"} · Volatility dampener`,
    },
    {
      tab: "indicators",
      rowId: "obv",
      title: "OBV — On-Balance Volume",
      subtitle: `Weight: ${(ind.obv.weight * 100).toFixed(0)}% · ${ind.obv.enabled ? "Enabled" : "Disabled"} · Volume indicator`,
    },
    {
      tab: "indicators",
      rowId: "fibonacci",
      title: "Fibonacci Retracement",
      subtitle: `Weight: ${(ind.fibonacci.weight * 100).toFixed(0)}% · ${ind.fibonacci.enabled ? "Enabled" : "Disabled"} · Support/resistance`,
    },
    {
      tab: "indicators",
      rowId: "ichimoku",
      title: "Ichimoku Cloud",
      subtitle: `Weight: ${(ind.ichimoku.weight * 100).toFixed(0)}% · ${ind.ichimoku.enabled ? "Enabled" : "Disabled"} · Complex trend`,
    },
  ];
}

export function buildConfigSearchHits(orchestrator: Orchestrator): ConfigSearchHit[] {
  return [
    ...settingsHits(orchestrator.config),
    ...tradingHits(orchestrator.config),
    ...modelsHits(orchestrator.config),
    ...indicatorsHits(orchestrator.config),
    ...optimizationHits(orchestrator.config),
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
