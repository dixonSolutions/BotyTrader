/**
 * Types for the autonomous optimizer (walk-forward, snapshots, challengers).
 */

/** Indicator keys that contribute to the composite technical score (excludes ATR dampener). */
export const COMPOSITE_INDICATOR_KEYS = [
  "sma",
  "ema",
  "rsi",
  "macd",
  "bollinger",
  "stochastic",
  "obv",
  "fibonacci",
  "ichimoku",
] as const;

export type CompositeIndicatorKey = (typeof COMPOSITE_INDICATOR_KEYS)[number];

/** All configurable indicator weight keys (includes ATR for persistence). */
export const ALL_INDICATOR_WEIGHT_KEYS = [
  "sma",
  "ema",
  "rsi",
  "macd",
  "bollinger",
  "stochastic",
  "atr",
  "obv",
  "fibonacci",
  "ichimoku",
] as const;

export type AllIndicatorWeightKey = (typeof ALL_INDICATOR_WEIGHT_KEYS)[number];

/** Decimal weights for the 10 indicators (sum typically ~1). */
export type IndicatorWeights = Record<AllIndicatorWeightKey, number>;

/** Per-snapshot indicator scores (-1..1) for composite indicators only. */
export type CompositeScores = Record<CompositeIndicatorKey, number>;

export interface FeatureSnapshotRow {
  id: string;
  symbol: string;
  createdAt: string;
  source: string;
  signalId: string | null;
  scores: CompositeScores;
  weights: IndicatorWeights;
  volatilityDampener: number;
  technicalWeight: number;
  sentimentWeight: number;
  hybridScore: number;
  technicalScore: number;
  sentimentScore: number;
  isShadow: boolean;
  priceAtSnapshot: number;
  action: string;
  outcomePctChange: number | null;
  outcomeRecordedAt: string | null;
  exitWindowHours: number;
  buyThreshold: number;
  swapThreshold: number;
}

export interface BacktestResult {
  totalPnl: number;
  maxDrawdown: number;
  tradeCount: number;
  winCount: number;
  /** Calmar-style ranking: totalPnl / (1 + maxDrawdown * 2) */
  calmarScore: number;
}

export interface ChallengerBundle {
  weights: IndicatorWeights;
  buyThreshold: number;
  exitWindowHours: number;
  swapThreshold: number;
  /** Challenger min rank (0–100) — tuned with learning rate when optimizer gates pass. */
  minEntryScore: number;
}

export interface ChallengerResult {
  bundle: ChallengerBundle;
  backtest: BacktestResult;
}

export type OptimizationRunStatus = "running" | "completed" | "failed" | "skipped";

export interface OptimizationRunRow {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: OptimizationRunStatus;
  challengerCount: number | null;
  lookbackDays: number | null;
  championPnl: number | null;
  winnerPnl: number | null;
  improvementPct: number | null;
  passedDiversityCheck: boolean | null;
  passedStressTest: boolean | null;
  weightsUpdated: boolean;
  notes: string | null;
}

/** Summary for TUI / orchestrator state. */
export interface OptimizationStateSummary {
  lastRunAt: string | null;
  lastStatus: OptimizationRunStatus | null;
  lastImprovementPct: number | null;
  lastNotes: string | null;
  snapshotTotal: number;
  snapshotsWithOutcome: number;
  shadowCount: number;
  nextScheduledHint: string;
}
