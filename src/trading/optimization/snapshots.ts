/**
 * Feature snapshot recording and outcome backfill from price_history.
 */

import type { Config } from "../../config.js";
import type { TechnicalScoreResult } from "../../signal/technicalScore.js";
import type { TradingRepositories } from "../storage/repositories.js";
import { OptimizationRepositories, readIndicatorWeightsFromConfig } from "./repositories.js";
import type { CompositeScores } from "./types.js";
import type { SimpleStrategyResult } from "../strategy/simple.js";

const TIMEFRAME = "1Day";

function extractCompositeScores(breakdown: TechnicalScoreResult | undefined): CompositeScores | null {
  if (!breakdown?.indicators) return null;
  const ind = breakdown.indicators;
  return {
    sma: ind.sma.score,
    ema: ind.ema.score,
    rsi: ind.rsi.score,
    macd: ind.macd.score,
    bollinger: ind.bollinger.score,
    stochastic: ind.stochastic.score,
    obv: ind.obv.score,
    fibonacci: ind.fibonacci.score,
    ichimoku: ind.ichimoku.score,
  };
}

/**
 * Persist a feature row when optimization is enabled and we have a full technical breakdown.
 * Records "near miss" shadow rows when hybrid is below buy threshold but within `shadow_capture_range`.
 * Records executed-side signals when hybrid >= buy_threshold (candidate would buy on score alone).
 */
export function tryRecordFeatureSnapshot(args: {
  config: Config;
  tradingRepo: TradingRepositories;
  symbol: string;
  source: "portfolio" | "candidate" | "manual";
  strat: SimpleStrategyResult;
  sentimentScore: number;
  priceAtSnapshot: number;
  signalId?: string | null;
}): void {
  const opt = args.config.optimization;
  if (!opt?.enabled) return;

  const scores = extractCompositeScores(args.strat.technicalBreakdown);
  if (!scores) return;

  const buyTh = args.config.strategy.simple.buy_threshold;
  const hybrid = args.strat.hybridScore;
  const range = opt.shadow_capture_range ?? 0.2;
  const shadowLower = buyTh * (1 - range);
  const isShadow = hybrid < buyTh && hybrid >= shadowLower;
  const isStrongCandidate = hybrid >= buyTh;

  if (!isShadow && !isStrongCandidate) return;

  const weights = readIndicatorWeightsFromConfig(args.config);
  const damp = args.strat.technicalBreakdown?.volatilityDampener ?? 1;
  const s = args.config.strategy.simple;
  const exitH = opt.exit_window_hours ?? 48;
  const swapTh = args.config.optimization.challenger_swap_threshold;

  const optRepo = new OptimizationRepositories(args.tradingRepo.getDatabase());
  optRepo.insertFeatureSnapshot({
    symbol: args.symbol,
    source: args.source,
    signalId: args.signalId ?? null,
    scores,
    weights,
    volatilityDampener: damp,
    technicalWeight: s.technical_weight,
    sentimentWeight: s.sentiment_weight,
    hybridScore: hybrid,
    technicalScore: args.strat.technicalScore,
    sentimentScore: args.sentimentScore,
    isShadow,
    priceAtSnapshot: args.priceAtSnapshot,
    action: args.strat.action,
    exitWindowHours: exitH,
    buyThreshold: buyTh,
    swapThreshold: swapTh,
  });
}

/**
 * Fill `outcome_pct_change` for snapshots whose exit window has elapsed, using daily bars in `price_history`.
 */
export function updateExpiredOutcomes(
  tradingRepo: TradingRepositories,
  opts?: { batchSize?: number; timeframe?: string },
): number {
  const timeframe = opts?.timeframe ?? TIMEFRAME;
  const batch = opts?.batchSize ?? 500;
  const optRepo = new OptimizationRepositories(tradingRepo.getDatabase());
  const pending = optRepo.listSnapshotsPendingOutcome(batch);
  let updated = 0;
  for (const row of pending) {
    const startMs = Date.parse(row.createdAt);
    if (!Number.isFinite(startMs)) continue;
    const endMs = startMs + row.exitWindowHours * 3_600_000;
    if (Date.now() < endMs) continue;

    const startIso = row.createdAt;
    const endIso = new Date(endMs).toISOString();

    const closeStart =
      row.priceAtSnapshot > 0
        ? row.priceAtSnapshot
        : tradingRepo.getCloseOnOrBefore(row.symbol, timeframe, startIso);
    const closeEnd = tradingRepo.getCloseOnOrAfter(row.symbol, timeframe, endIso);

    if (closeStart == null || closeStart <= 0 || closeEnd == null || !Number.isFinite(closeEnd)) continue;

    const pct = ((closeEnd - closeStart) / closeStart) * 100;
    if (!Number.isFinite(pct)) continue;

    optRepo.updateSnapshotOutcome(row.id, pct);
    updated++;
  }
  return updated;
}
