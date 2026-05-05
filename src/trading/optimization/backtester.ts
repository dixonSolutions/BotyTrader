/**
 * Replay hybrid decisions on stored snapshots for walk-forward scoring.
 */

import type { BacktestResult, ChallengerBundle, CompositeIndicatorKey, FeatureSnapshotRow } from "./types.js";
import { COMPOSITE_INDICATOR_KEYS } from "./types.js";

function replayTechnicalScore(row: FeatureSnapshotRow, challengerWeights: ChallengerBundle["weights"]): number {
  const damp = row.volatilityDampener;
  let sum = 0;
  let wsum = 0;
  for (const key of COMPOSITE_INDICATOR_KEYS) {
    const snapW = row.weights[key as CompositeIndicatorKey];
    if (snapW <= 0) continue;
    const cw = challengerWeights[key as CompositeIndicatorKey];
    sum += row.scores[key] * cw;
    wsum += cw;
  }
  const raw = wsum > 0 ? sum / wsum : 0;
  return raw * damp;
}

function replayHybrid(row: FeatureSnapshotRow, bundle: ChallengerBundle): number {
  const tech = replayTechnicalScore(row, bundle.weights);
  return row.technicalWeight * tech + row.sentimentWeight * row.sentimentScore;
}

/**
 * Walk snapshots in time order; each virtual "buy" when replay hybrid exceeds challenger buy threshold
 * contributes `outcome_pct_change` as a simple return (percent points → fraction).
 */
export function runBacktest(rows: FeatureSnapshotRow[], bundle: ChallengerBundle): BacktestResult {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let tradeCount = 0;
  let winCount = 0;

  for (const row of sorted) {
    const oc = row.outcomePctChange;
    if (oc == null || !Number.isFinite(oc)) continue;

    const hybrid = replayHybrid(row, bundle);
    if (hybrid <= bundle.buyThreshold) continue;

    const ret = oc / 100;
    equity *= 1 + ret;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDd = Math.max(maxDd, dd);
    tradeCount++;
    if (ret > 0) winCount++;
  }

  const totalPnl = (equity - 1) * 100;
  const calmarDenom = 1 + maxDd * 2;
  const calmarScore = calmarDenom > 0 ? totalPnl / calmarDenom : totalPnl;

  return {
    totalPnl,
    maxDrawdown: maxDd * 100,
    tradeCount,
    winCount,
    calmarScore,
  };
}
