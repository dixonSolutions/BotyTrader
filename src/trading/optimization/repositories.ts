/**
 * SQLite persistence for feature snapshots, optimization runs, and weight history.
 */

import { randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import type { Config } from "../../config.js";
import type {
  CompositeScores,
  FeatureSnapshotRow,
  IndicatorWeights,
  OptimizationRunRow,
  OptimizationRunStatus,
} from "./types.js";

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function mapSnapshotRow(r: Record<string, unknown>): FeatureSnapshotRow {
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    createdAt: String(r.created_at),
    source: String(r.source),
    signalId: r.signal_id != null ? String(r.signal_id) : null,
    scores: {
      sma: Number(r.score_sma ?? 0),
      ema: Number(r.score_ema ?? 0),
      rsi: Number(r.score_rsi ?? 0),
      macd: Number(r.score_macd ?? 0),
      bollinger: Number(r.score_bollinger ?? 0),
      stochastic: Number(r.score_stochastic ?? 0),
      obv: Number(r.score_obv ?? 0),
      fibonacci: Number(r.score_fibonacci ?? 0),
      ichimoku: Number(r.score_ichimoku ?? 0),
    },
    weights: {
      sma: Number(r.weight_sma ?? 0),
      ema: Number(r.weight_ema ?? 0),
      rsi: Number(r.weight_rsi ?? 0),
      macd: Number(r.weight_macd ?? 0),
      bollinger: Number(r.weight_bollinger ?? 0),
      stochastic: Number(r.weight_stochastic ?? 0),
      atr: Number(r.weight_atr ?? 0),
      obv: Number(r.weight_obv ?? 0),
      fibonacci: Number(r.weight_fibonacci ?? 0),
      ichimoku: Number(r.weight_ichimoku ?? 0),
    },
    volatilityDampener: Number(r.volatility_dampener ?? 1),
    technicalWeight: Number(r.technical_weight ?? 0.6),
    sentimentWeight: Number(r.sentiment_weight ?? 0.4),
    hybridScore: Number(r.hybrid_score),
    technicalScore: Number(r.technical_score),
    sentimentScore: Number(r.sentiment_score),
    isShadow: Number(r.is_shadow) === 1,
    priceAtSnapshot: Number(r.price_at_snapshot),
    action: String(r.action),
    outcomePctChange: r.outcome_pct_change != null ? Number(r.outcome_pct_change) : null,
    outcomeRecordedAt: r.outcome_recorded_at != null ? String(r.outcome_recorded_at) : null,
    exitWindowHours: Number(r.exit_window_hours),
    buyThreshold: Number(r.buy_threshold),
    swapThreshold: Number(r.swap_threshold),
  };
}

export class OptimizationRepositories {
  constructor(private readonly db: Database.Database) {}

  insertFeatureSnapshot(row: {
    symbol: string;
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
    exitWindowHours: number;
    buyThreshold: number;
    swapThreshold: number;
  }): string {
    const id = newId("fsnap");
    const now = new Date().toISOString();
    const w = row.weights;
    const s = row.scores;
    this.db
      .prepare(
        `INSERT INTO feature_snapshots (
        id, symbol, created_at, source, signal_id,
        score_sma, score_ema, score_rsi, score_macd, score_bollinger, score_stochastic, score_obv, score_fibonacci, score_ichimoku,
        weight_sma, weight_ema, weight_rsi, weight_macd, weight_bollinger, weight_stochastic, weight_atr, weight_obv, weight_fibonacci, weight_ichimoku,
        volatility_dampener, technical_weight, sentiment_weight, hybrid_score, technical_score, sentiment_score,
        is_shadow, price_at_snapshot, action, exit_window_hours, buy_threshold, swap_threshold
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        row.symbol.toUpperCase(),
        now,
        row.source,
        row.signalId,
        s.sma,
        s.ema,
        s.rsi,
        s.macd,
        s.bollinger,
        s.stochastic,
        s.obv,
        s.fibonacci,
        s.ichimoku,
        w.sma,
        w.ema,
        w.rsi,
        w.macd,
        w.bollinger,
        w.stochastic,
        w.atr,
        w.obv,
        w.fibonacci,
        w.ichimoku,
        row.volatilityDampener,
        row.technicalWeight,
        row.sentimentWeight,
        row.hybridScore,
        row.technicalScore,
        row.sentimentScore,
        row.isShadow ? 1 : 0,
        row.priceAtSnapshot,
        row.action,
        row.exitWindowHours,
        row.buyThreshold,
        row.swapThreshold,
      );
    return id;
  }

  listSnapshotsPendingOutcome(limit: number): FeatureSnapshotRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM feature_snapshots WHERE outcome_recorded_at IS NULL ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapSnapshotRow);
  }

  updateSnapshotOutcome(id: string, outcomePctChange: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE feature_snapshots SET outcome_pct_change = ?, outcome_recorded_at = ? WHERE id = ?`,
      )
      .run(outcomePctChange, now, id);
  }

  listSnapshotsWithOutcomesSince(cutoffIso: string, limit: number): FeatureSnapshotRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM feature_snapshots
         WHERE outcome_recorded_at IS NOT NULL AND created_at >= ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(cutoffIso, limit) as Record<string, unknown>[];
    return rows.map(mapSnapshotRow);
  }

  countSnapshots(): { total: number; withOutcome: number; shadows: number } {
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS n FROM feature_snapshots`).get() as { n: number }).n,
    );
    const withOutcome = Number(
      (
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM feature_snapshots WHERE outcome_recorded_at IS NOT NULL`)
          .get() as { n: number }
      ).n,
    );
    const shadows = Number(
      (this.db.prepare(`SELECT COUNT(*) AS n FROM feature_snapshots WHERE is_shadow = 1`).get() as { n: number })
        .n,
    );
    return { total, withOutcome, shadows };
  }

  insertOptimizationRun(row: {
    id: string;
    startedAt: string;
    completedAt?: string | null;
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
  }): void {
    this.db
      .prepare(
        `INSERT INTO optimization_runs (
        id, started_at, completed_at, status, challenger_count, lookback_days,
        champion_pnl, winner_pnl, improvement_pct, passed_diversity_check, passed_stress_test, weights_updated, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.startedAt,
        row.completedAt ?? null,
        row.status,
        row.challengerCount,
        row.lookbackDays,
        row.championPnl,
        row.winnerPnl,
        row.improvementPct,
        row.passedDiversityCheck == null ? null : row.passedDiversityCheck ? 1 : 0,
        row.passedStressTest == null ? null : row.passedStressTest ? 1 : 0,
        row.weightsUpdated ? 1 : 0,
        row.notes,
      );
  }

  completeOptimizationRun(
    id: string,
    patch: {
      completedAt: string;
      status: OptimizationRunStatus;
      championPnl: number | null;
      winnerPnl: number | null;
      improvementPct: number | null;
      passedDiversityCheck: boolean | null;
      passedStressTest: boolean | null;
      weightsUpdated: boolean;
      notes: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE optimization_runs SET
        completed_at = ?, status = ?, champion_pnl = ?, winner_pnl = ?, improvement_pct = ?,
        passed_diversity_check = ?, passed_stress_test = ?, weights_updated = ?, notes = ?
        WHERE id = ?`,
      )
      .run(
        patch.completedAt,
        patch.status,
        patch.championPnl,
        patch.winnerPnl,
        patch.improvementPct,
        patch.passedDiversityCheck == null ? null : patch.passedDiversityCheck ? 1 : 0,
        patch.passedStressTest == null ? null : patch.passedStressTest ? 1 : 0,
        patch.weightsUpdated ? 1 : 0,
        patch.notes,
        id,
      );
  }

  getLatestOptimizationRun(): OptimizationRunRow | null {
    const r = this.db
      .prepare(`SELECT * FROM optimization_runs ORDER BY started_at DESC LIMIT 1`)
      .get() as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      startedAt: String(r.started_at),
      completedAt: r.completed_at != null ? String(r.completed_at) : null,
      status: String(r.status) as OptimizationRunStatus,
      challengerCount: r.challenger_count != null ? Number(r.challenger_count) : null,
      lookbackDays: r.lookback_days != null ? Number(r.lookback_days) : null,
      championPnl: r.champion_pnl != null ? Number(r.champion_pnl) : null,
      winnerPnl: r.winner_pnl != null ? Number(r.winner_pnl) : null,
      improvementPct: r.improvement_pct != null ? Number(r.improvement_pct) : null,
      passedDiversityCheck:
        r.passed_diversity_check == null ? null : Number(r.passed_diversity_check) === 1,
      passedStressTest: r.passed_stress_test == null ? null : Number(r.passed_stress_test) === 1,
      weightsUpdated: Number(r.weights_updated) === 1,
      notes: r.notes != null ? String(r.notes) : null,
    };
  }

  insertWeightHistory(row: {
    optimizationRunId: string | null;
    weights: IndicatorWeights;
    buyThreshold: number;
    exitWindowHours: number;
    swapThreshold: number;
    minEntryScore: number;
    reason: string;
  }): string {
    const id = newId("whist");
    const now = new Date().toISOString();
    const w = row.weights;
    this.db
      .prepare(
        `INSERT INTO weight_history (
        id, optimization_run_id, recorded_at,
        weight_sma, weight_ema, weight_rsi, weight_macd, weight_bollinger, weight_stochastic, weight_atr, weight_obv, weight_fibonacci, weight_ichimoku,
        buy_threshold, exit_window_hours, swap_threshold, min_entry_score, reason
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        row.optimizationRunId,
        now,
        w.sma,
        w.ema,
        w.rsi,
        w.macd,
        w.bollinger,
        w.stochastic,
        w.atr,
        w.obv,
        w.fibonacci,
        w.ichimoku,
        row.buyThreshold,
        row.exitWindowHours,
        row.swapThreshold,
        row.minEntryScore,
        row.reason,
      );
    return id;
  }

  listRecentWeightHistory(limit: number): {
    recordedAt: string;
    reason: string;
    weights: IndicatorWeights;
    buyThreshold: number;
    exitWindowHours: number;
    swapThreshold: number;
  }[] {
    const rows = this.db
      .prepare(`SELECT * FROM weight_history ORDER BY recorded_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      recordedAt: String(r.recorded_at),
      reason: String(r.reason ?? ""),
      weights: {
        sma: Number(r.weight_sma ?? 0),
        ema: Number(r.weight_ema ?? 0),
        rsi: Number(r.weight_rsi ?? 0),
        macd: Number(r.weight_macd ?? 0),
        bollinger: Number(r.weight_bollinger ?? 0),
        stochastic: Number(r.weight_stochastic ?? 0),
        atr: Number(r.weight_atr ?? 0),
        obv: Number(r.weight_obv ?? 0),
        fibonacci: Number(r.weight_fibonacci ?? 0),
        ichimoku: Number(r.weight_ichimoku ?? 0),
      },
      buyThreshold: Number(r.buy_threshold ?? 0),
      exitWindowHours: Number(r.exit_window_hours ?? 48),
      swapThreshold: Number(r.swap_threshold ?? 10),
    }));
  }
}

export function readIndicatorWeightsFromConfig(config: Config): IndicatorWeights {
  const ind = config.indicators;
  return {
    sma: ind.sma.weight,
    ema: ind.ema.weight,
    rsi: ind.rsi.weight,
    macd: ind.macd.weight,
    bollinger: ind.bollinger.weight,
    stochastic: ind.stochastic.weight,
    atr: ind.atr.weight,
    obv: ind.obv.weight,
    fibonacci: ind.fibonacci.weight,
    ichimoku: ind.ichimoku.weight,
  };
}
