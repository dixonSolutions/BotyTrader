/**
 * Walk-forward optimization: challengers, gates, learning-rate merge into config.
 */

import { writeConfig, type Config } from "../../config.js";
import type { TradingRepositories } from "../storage/repositories.js";
import { generateChallengers } from "./challenger.js";
import { runBacktest } from "./backtester.js";
import { OptimizationRepositories, readIndicatorWeightsFromConfig } from "./repositories.js";
import type {
  ChallengerBundle,
  FeatureSnapshotRow,
  IndicatorWeights,
  OptimizationStateSummary,
} from "./types.js";
import { ALL_INDICATOR_WEIGHT_KEYS } from "./types.js";

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;

function bundleFromConfig(config: Config): ChallengerBundle {
  const o = config.optimization;
  return {
    weights: readIndicatorWeightsFromConfig(config),
    buyThreshold: config.strategy.simple.buy_threshold,
    exitWindowHours: o.exit_window_hours,
    swapThreshold: o.challenger_swap_threshold,
    minEntryScore: o.challenger_min_entry_score,
  };
}

function normalizeIndicatorWeights(w: IndicatorWeights, fallback: IndicatorWeights): IndicatorWeights {
  let sum = 0;
  for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
    sum += Math.max(0, w[k]);
  }
  if (sum <= 0) return { ...fallback };
  const out = { ...w };
  for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
    out[k] = Math.max(0, out[k]! / sum);
  }
  return out;
}

function blendWeights(
  current: IndicatorWeights,
  optimal: IndicatorWeights,
  alpha: number,
): IndicatorWeights {
  const out = { ...current };
  for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
    out[k] = current[k] * (1 - alpha) + optimal[k] * alpha;
  }
  return normalizeIndicatorWeights(out, current);
}

function maxWeight(w: IndicatorWeights): number {
  let m = 0;
  for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
    m = Math.max(m, w[k]);
  }
  return m;
}

/**
 * Find a contiguous 7-day window (by wall-clock) with weakest champion PnL for stress testing.
 */
function findStressWindowRows(rows: FeatureSnapshotRow[], champion: ChallengerBundle): FeatureSnapshotRow[] {
  if (rows.length < 10) return [];
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const minMs = Date.parse(sorted[0]!.createdAt);
  const maxMs = Date.parse(sorted[sorted.length - 1]!.createdAt);
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs - minMs < MS_WEEK) return [];

  let worstSlice: FeatureSnapshotRow[] = [];
  let worstPnl = Infinity;
  for (let t = minMs; t + MS_WEEK <= maxMs; t += MS_DAY) {
    const slice = sorted.filter((r) => {
      const ms = Date.parse(r.createdAt);
      return ms >= t && ms < t + MS_WEEK;
    });
    if (slice.length < 3) continue;
    const pnl = runBacktest(slice, champion).totalPnl;
    if (pnl < worstPnl) {
      worstPnl = pnl;
      worstSlice = slice;
    }
  }
  return worstSlice;
}

export interface OptimizationCycleResult {
  runId: string;
  status: "completed" | "skipped" | "failed";
  notes: string;
  weightsUpdated: boolean;
}

/**
 * Run one full optimization pass (DB + in-memory config). Caller should persist orchestrator state.
 */
export function runOptimizationCycle(
  config: Config,
  tradingRepo: TradingRepositories,
  log?: (msg: string) => void,
): OptimizationCycleResult {
  const opt = config.optimization;
  const optRepo = new OptimizationRepositories(tradingRepo.getDatabase());
  const runId = `opt_${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();

  const fail = (notes: string): OptimizationCycleResult => {
    log?.(`Optimization skipped/failed: ${notes}`);
    const done = new Date().toISOString();
    optRepo.insertOptimizationRun({
      id: runId,
      startedAt,
      completedAt: done,
      status: "skipped",
      challengerCount: null,
      lookbackDays: null,
      championPnl: null,
      winnerPnl: null,
      improvementPct: null,
      passedDiversityCheck: null,
      passedStressTest: null,
      weightsUpdated: false,
      notes,
    });
    return { runId, status: "skipped", notes, weightsUpdated: false };
  };

  if (!opt?.enabled) {
    return fail("optimization.enabled is false");
  }

  const lookbackDays = opt.lookback_days ?? 14;
  const cutoff = new Date(Date.now() - lookbackDays * MS_DAY).toISOString();
  const rows = optRepo.listSnapshotsWithOutcomesSince(cutoff, 100_000);
  const minSnapshots = opt.min_snapshots ?? 10;
  if (rows.length < minSnapshots) {
    return fail(`need at least ${minSnapshots} snapshots with outcomes (have ${rows.length})`);
  }

  const champion = bundleFromConfig(config);
  const championResult = runBacktest(rows, champion);
  const challengerCount = opt.challenger_count ?? 50;
  const mutationRate = opt.mutation_rate ?? 0.02;
  const challengers = generateChallengers(config, challengerCount, mutationRate);

  let best: { bundle: ChallengerBundle; backtest: ReturnType<typeof runBacktest> } | null = null;
  for (const bundle of challengers) {
    const bt = runBacktest(rows, bundle);
    if (!best || bt.calmarScore > best.backtest.calmarScore) {
      best = { bundle, backtest: bt };
    }
  }
  if (!best) {
    return fail("no challengers generated");
  }

  const winner = best;
  const championPnl = championResult.totalPnl;
  const winnerPnl = winner.backtest.totalPnl;
  const improvementPct =
    championPnl !== 0 ? (winnerPnl - championPnl) / Math.max(Math.abs(championPnl), 1e-9) : winnerPnl > 0 ? 1 : 0;

  const improvementThreshold = opt.improvement_threshold ?? 0.1;
  const gate1 = improvementPct >= improvementThreshold;
  const maxSingle = opt.max_single_weight ?? 0.3;
  const gate2 = maxWeight(winner.bundle.weights) <= maxSingle + 1e-9;

  let gate3 = true;
  if (opt.stress_test_enabled !== false) {
    const stressRows = findStressWindowRows(rows, champion);
    if (stressRows.length >= 3) {
      const cStress = runBacktest(stressRows, champion).totalPnl;
      const wStress = runBacktest(stressRows, winner.bundle).totalPnl;
      gate3 = wStress >= cStress - 1e-6;
    }
  }

  const notesParts: string[] = [];
  if (!gate1) notesParts.push(`improvement ${(improvementPct * 100).toFixed(1)}% < ${(improvementThreshold * 100).toFixed(0)}%`);
  if (!gate2) notesParts.push(`diversity: max weight ${(maxWeight(winner.bundle.weights) * 100).toFixed(1)}% > ${(maxSingle * 100).toFixed(0)}%`);
  if (!gate3) notesParts.push("stress test: winner underperformed champion on worst 7d window");

  optRepo.insertOptimizationRun({
    id: runId,
    startedAt,
    completedAt: null,
    status: "running",
    challengerCount,
    lookbackDays,
    championPnl,
    winnerPnl,
    improvementPct,
    passedDiversityCheck: gate2,
    passedStressTest: gate3,
    weightsUpdated: false,
    notes: notesParts.join("; ") || null,
  });

  const allGates = gate1 && gate2 && gate3;
  if (!allGates) {
    const notes = notesParts.join("; ") || "gates not passed";
    optRepo.completeOptimizationRun(runId, {
      completedAt: new Date().toISOString(),
      status: "skipped",
      championPnl,
      winnerPnl,
      improvementPct,
      passedDiversityCheck: gate2,
      passedStressTest: gate3,
      weightsUpdated: false,
      notes,
    });
    log?.(`Optimization run ${runId}: ${notes}`);
    return { runId, status: "skipped", notes, weightsUpdated: false };
  }

  const alpha = opt.learning_rate ?? 0.1;
  const mergedWeights = blendWeights(champion.weights, winner.bundle.weights, alpha);
  for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
    config.indicators[k].weight = mergedWeights[k]!;
  }

  const s = config.strategy.simple;
  s.buy_threshold = s.buy_threshold * (1 - alpha) + winner.bundle.buyThreshold * alpha;

  const o = config.optimization;
  o.challenger_swap_threshold = Math.round(
    o.challenger_swap_threshold * (1 - alpha) + winner.bundle.swapThreshold * alpha,
  );
  o.exit_window_hours = Math.round(o.exit_window_hours * (1 - alpha) + winner.bundle.exitWindowHours * alpha);
  o.challenger_min_entry_score = Math.round(
    o.challenger_min_entry_score * (1 - alpha) + winner.bundle.minEntryScore * alpha,
  );

  writeConfig(config);

  optRepo.completeOptimizationRun(runId, {
    completedAt: new Date().toISOString(),
    status: "completed",
    championPnl,
    winnerPnl,
    improvementPct,
    passedDiversityCheck: true,
    passedStressTest: true,
    weightsUpdated: true,
    notes: `Applied α=${alpha}; champion PnL ${championPnl.toFixed(2)}% → winner ${winnerPnl.toFixed(2)}%`,
  });

  optRepo.insertWeightHistory({
    optimizationRunId: runId,
    weights: readIndicatorWeightsFromConfig(config),
    buyThreshold: s.buy_threshold,
    exitWindowHours: o.exit_window_hours,
    swapThreshold: o.challenger_swap_threshold,
    minEntryScore: o.challenger_min_entry_score,
    reason: "autonomous_optimizer",
  });

  log?.(`Optimization ${runId}: weights updated (α=${alpha}).`);
  return { runId, status: "completed", notes: "weights updated", weightsUpdated: true };
}

/** Local calendar day key YYYY-MM-DD for deduplicating scheduled runs. */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Whether the optimizer should run now (hour slot + optional weekday + once per local day).
 */
export function shouldRunOptimizationSchedule(
  config: Config,
  now: Date,
  lastLocalDayKey: string | null,
): { run: boolean; dayKey: string } {
  const o = config.optimization;
  const dayKey = localDayKey(now);
  if (!o?.enabled) return { run: false, dayKey };

  const hour = o.schedule_hour ?? 2;
  if (now.getHours() !== hour || now.getMinutes() > 5) {
    return { run: false, dayKey };
  }

  const sched = o.schedule_day ?? "daily";
  if (sched !== "daily") {
    const dow = WEEKDAYS[now.getDay()];
    if (dow !== sched) return { run: false, dayKey };
  }

  if (lastLocalDayKey === dayKey) return { run: false, dayKey };
  return { run: true, dayKey };
}

export function buildOptimizationStateSummary(
  config: Config,
  tradingRepo: TradingRepositories,
): OptimizationStateSummary {
  const optRepo = new OptimizationRepositories(tradingRepo.getDatabase());
  const counts = optRepo.countSnapshots();
  const last = optRepo.getLatestOptimizationRun();
  const o = config.optimization;
  const dayHint = o?.schedule_day === "daily" ? "daily" : (o?.schedule_day ?? "daily");
  const hour = o?.schedule_hour ?? 2;
  return {
    lastRunAt: last?.completedAt ?? last?.startedAt ?? null,
    lastStatus: last?.status ?? null,
    lastImprovementPct: last?.improvementPct ?? null,
    lastNotes: last?.notes ?? null,
    snapshotTotal: counts.total,
    snapshotsWithOutcome: counts.withOutcome,
    shadowCount: counts.shadows,
    nextScheduledHint: o?.enabled ? `${dayHint} @ ${hour}:00 local` : "optimizer disabled",
  };
}
