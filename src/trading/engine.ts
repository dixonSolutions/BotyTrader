/**
 * Deterministic simple-strategy engine: signals, persistence, optional orders.
 */

import fs from "node:fs";

import { submitOrder, type SubmitOrderResult } from "../actions/alpaca.js";
import type { Decision } from "../actions/types.js";
import type { Config, Secrets } from "../config.js";
import { resolveTradingDatabasePath } from "../config.js";
import type { AccountSummary, BrokerAdapter, NewsItem, Position, PriceBar } from "../execution/broker.js";
import type { LogService } from "../services/logService.js";
import { aggregateNewsSentiment, getLocalClassifier } from "./sentiment/finbert.js";
import { checkTradingReadiness, type ReadinessResult } from "./readiness.js";
import { openTradingDatabase } from "./storage/database.js";
import { newsItemsForSymbol, TradingRepositories } from "./storage/repositories.js";
import type { OhlcBar } from "../signal/types.js";
import { tryRecordFeatureSnapshot, updateExpiredOutcomes } from "./optimization/snapshots.js";
import {
  buildOptimizationStateSummary,
  runOptimizationCycle,
  type OptimizationCycleResult,
} from "./optimization/optimizer.js";
import type { OptimizationStateSummary } from "./optimization/types.js";
import { computeSimpleStrategy } from "./strategy/simple.js";

import type Database from "better-sqlite3";

import type { SignalRow } from "./types.js";

const TIMEFRAME = "1Day";
const BARS_DAYS = 120;

export interface TradingEngineStatus {
  ready: boolean;
  readiness: ReadinessResult;
  lastError: string | null;
  /** Set when SQLite native module fails to load (e.g. Node ABI mismatch). */
  dbOpenError: string | null;
  lastPortfolioAt: string | null;
  lastCandidateAt: string | null;
  sentimentModelOk: boolean;
  sentimentError: string | null;
  dbPath: string;
  /** Autonomous optimizer summary (null if DB unavailable). */
  optimization: OptimizationStateSummary | null;
}

export class TradingEngine {
  private readonly config: Config;
  private readonly secrets: Secrets;
  private broker: BrokerAdapter;
  private db: Database.Database | null = null;
  private repo: TradingRepositories | null = null;
  private status: TradingEngineStatus;
  private pendingSymbolCooldown = new Map<string, number>();
  /** Optional real-time log bus — injected from Orchestrator. */
  private readonly logService: LogService | null;

  constructor(config: Config, secrets: Secrets, broker: BrokerAdapter, logService?: LogService) {
    this.config = config;
    this.secrets = secrets;
    this.broker = broker;
    this.logService = logService ?? null;
    this.status = {
      ready: false,
      readiness: { ok: true, issues: [], warnings: [] },
      lastError: null,
      dbOpenError: null,
      lastPortfolioAt: null,
      lastCandidateAt: null,
      sentimentModelOk: true,
      sentimentError: null,
      dbPath: resolveTradingDatabasePath(config),
      optimization: null,
    };
  }

  getStatus(): TradingEngineStatus {
    const baseStatus: TradingEngineStatus = {
      ...this.status,
    };
    const repo = this.repo;
    if (repo) {
      try {
        baseStatus.optimization = buildOptimizationStateSummary(this.config, repo);
      } catch {
        baseStatus.optimization = this.status.optimization;
      }
    }
    return baseStatus;
  }

  private ensureDb(): TradingRepositories | null {
    if (this.repo && this.db) {
      return this.repo;
    }
    const p = resolveTradingDatabasePath(this.config);
    this.status.dbPath = p;
    try {
      this.db = openTradingDatabase(p);
      this.repo = new TradingRepositories(this.db);
      this.status.dbOpenError = null;
      return this.repo;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      this.db = null;
      this.repo = null;
      this.status.dbOpenError = describeSqliteLoadError(raw);
      this.refreshReadiness();
      return null;
    }
  }

  /**
   * Warm local FinBERT when enabled; records status for the TUI.
   */
  async warmSentimentModel(): Promise<void> {
    const p = this.config.sentiment.provider;
    if (p !== "local_finbert" && p !== "hybrid_finbert") {
      this.status.sentimentModelOk = true;
      this.status.sentimentError = null;
      this.refreshReadiness();
      return;
    }
    try {
      await getLocalClassifier(this.config, (m) => {
        this.status.sentimentError = m;
      });
      this.status.sentimentModelOk = true;
      this.status.sentimentError = null;
    } catch (e) {
      this.status.sentimentModelOk = false;
      this.status.sentimentError = e instanceof Error ? e.message : String(e);
    }
    this.refreshReadiness();
  }

  refreshReadiness(): void {
    const hasAlpaca =
      this.config.broker.platform === "alpaca_paper" || this.config.broker.platform === "alpaca_live";
    let readiness = checkTradingReadiness(this.config, this.secrets, {
      hasAlpaca,
      sentimentModelLoadFailed: this.status.sentimentModelOk ? null : this.status.sentimentError,
    });
    if (this.status.dbOpenError) {
      readiness = {
        ok: false,
        issues: [this.status.dbOpenError, ...readiness.issues],
        warnings: readiness.warnings,
      };
    }
    this.status.readiness = readiness;
    this.status.ready = readiness.ok;
  }

  /** Recent strategy signals from SQLite (empty if DB unavailable). */
  listRecentSignals(limit: number): SignalRow[] {
    const repo = this.ensureDb();
    if (!repo) return [];
    try {
      return repo.recentSignalsAll(limit);
    } catch {
      return [];
    }
  }

  /**
   * Evaluate one symbol: technical + news sentiment, store signal, optionally trade.
   */
  async evaluateSymbol(
    symbol: string,
    _reason: "portfolio" | "candidate" | "manual",
  ): Promise<void> {
    void _reason;
    if (!this.config.trading.enabled || !this.config.strategy.simple.enabled) {
      return;
    }
    this.refreshReadiness();
    const hasAlpaca =
      this.config.broker.platform === "alpaca_paper" || this.config.broker.platform === "alpaca_live";
    if (!hasAlpaca) {
      this.status.lastError = "Simple strategy requires Alpaca (paper or live).";
      return;
    }

    const sym = symbol.toUpperCase();
    const repo = this.ensureDb();
    if (!repo) {
      this.status.lastError = this.status.dbOpenError ?? "Trading database unavailable.";
      return;
    }
    const now = Date.now();
    const cool = this.pendingSymbolCooldown.get(sym) ?? 0;
    if (now < cool) {
      return;
    }

    let positions: Position[] = [];
    try {
      positions = await this.broker.listPositions();
    } catch {
      /* ignore */
    }
    const pos = positions.find((p) => p.symbol === sym);
    const hasPosition = pos != null && pos.qty > 0;

    let bars: PriceBar[];
    try {
      bars = await this.broker.getPriceHistory(sym, BARS_DAYS);
    } catch (e) {
      this.status.lastError = e instanceof Error ? e.message : String(e);
      this.logTrading("warn", `${sym}: price fetch failed — ${this.status.lastError}`);
      repo.insertSignal({
        symbol: sym,
        technicalScore: null,
        sentimentScore: null,
        hybridScore: null,
        action: "hold",
        executed: false,
        rejectionReason: `No price data: ${this.status.lastError}`,
      });
      return;
    }
    if (bars.length < 55) {
      this.logTrading("warn", `${sym}: only ${bars.length} bars — need ≥55 for SMA/RSI, skipping`);
      repo.insertSignal({
        symbol: sym,
        technicalScore: null,
        sentimentScore: null,
        hybridScore: null,
        action: "hold",
        executed: false,
        rejectionReason: "Not enough daily bars for SMA/RSI",
      });
      return;
    }
    repo.upsertPriceBars(TIMEFRAME, bars, sym);
    const closes = bars.map((b) => b.c);
    const lastClose = closes[closes.length - 1] ?? 0;

    let newsItems: NewsItem[] = [];
    if (this.broker.getNews) {
      try {
        newsItems = await this.broker.getNews(sym, 12);
      } catch {
        /* ignore */
      }
    }
    const { sentimentScore, scored: newsItemCount } = await aggregateNewsSentiment(
      this.config,
      this.secrets,
      repo,
      newsItemsForSymbol(newsItems),
    );

    const ohlcBars: OhlcBar[] = bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
    const strat =
      ohlcBars.length >= 80
        ? computeSimpleStrategy(this.config, { bars: ohlcBars, sentimentScore })
        : computeSimpleStrategy(this.config, { closes, sentimentScore });

    this.logTrading(
      "debug",
      `${sym}: tech=${strat.technicalScore.toFixed(3)} sentiment=${sentimentScore?.toFixed(3) ?? "n/a"} hybrid=${strat.hybridScore.toFixed(3)} rsi=${strat.rsiValue?.toFixed(1) ?? "—"} → ${strat.action.toUpperCase()}`,
    );

    tryRecordFeatureSnapshot({
      config: this.config,
      tradingRepo: repo,
      symbol: sym,
      source: _reason,
      strat,
      sentimentScore,
      priceAtSnapshot: lastClose,
      signalId: null,
    });
    const hybrid01 = (strat.hybridScore + 1) / 2;
    const confidence = Math.max(0, Math.min(1, hybrid01));

    let action: "buy" | "sell" | "hold" = strat.action;
    if (strat.action === "sell" && !hasPosition) {
      action = "hold";
    }
    if (strat.action === "buy" && hasPosition) {
      action = "hold";
    }

    let rejection: string | null = null;
    if (action === "hold") {
      if (strat.action !== "hold") {
        rejection =
          strat.action === "buy" && hasPosition
            ? "already long"
            : strat.action === "sell" && !hasPosition
              ? "no position to close"
              : "hold band";
      } else {
        rejection = "hybrid in hold band";
      }
    } else if (!this.config.autotrade.enabled) {
      rejection = "autotrade.enabled is false";
    } else if (confidence < this.config.risk.min_confidence_to_trade) {
      rejection = `confidence ${confidence.toFixed(2)} < min_confidence_to_trade ${this.config.risk.min_confidence_to_trade}`;
    } else if (!this.status.readiness.ok) {
      rejection = this.status.readiness.issues[0] ?? "readiness not ok";
    }

    if (rejection) {
      this.logTrading("debug", `${sym}: signal ${strat.action.toUpperCase()} rejected — ${rejection}`);
      repo.insertSignal({
        symbol: sym,
        technicalScore: strat.technicalScore,
        sentimentScore,
        hybridScore: strat.hybridScore,
        action: strat.action,
        executed: false,
        rejectionReason: rejection,
      });
      return;
    }
    this.logTrading("info", `${sym}: signal ${action.toUpperCase()} — proceeding to order (confidence=${confidence.toFixed(2)})`);

    let isFractionable = false;
    if (this.broker.getAsset) {
      try {
        const asset = await this.broker.getAsset(sym);
        isFractionable = asset?.fractionable === true;
      } catch {
        /* ignore — default false */
      }
    }

    if (action === "buy" && this.config.trading.fractional_shares && !isFractionable) {
      const rejection = "asset.fractionable is not true";
      repo.insertSignal({
        symbol: sym,
        technicalScore: strat.technicalScore,
        sentimentScore,
        hybridScore: strat.hybridScore,
        action: "buy",
        executed: false,
        rejectionReason: rejection,
      });
      this.logTrading("debug", `${sym}: buy not placed — ${rejection}`);
      return;
    }

    const account = await this.broker.getAccount();
    const decision = await buildOrderDecision(
      this.config,
      sym,
      action,
      confidence,
      strat,
      newsItemCount,
      lastClose,
      account,
      hasPosition && pos ? pos.qty : 0,
      strat.sellPositionFraction,
      strat.buyNotionalBandFraction,
      isFractionable,
    );

    if (decision.action === "hold" && action === "sell") {
      repo.insertSignal({
        symbol: sym,
        technicalScore: strat.technicalScore,
        sentimentScore,
        hybridScore: strat.hybridScore,
        action: "sell",
        executed: false,
        rejectionReason: decision.reasoning,
      });
      this.logTrading("debug", `${sym}: sell not placed — ${decision.reasoning}`);
      return;
    }

    if (decision.action === "hold" && action === "buy") {
      repo.insertSignal({
        symbol: sym,
        technicalScore: strat.technicalScore,
        sentimentScore,
        hybridScore: strat.hybridScore,
        action: "buy",
        executed: false,
        rejectionReason: decision.reasoning,
      });
      this.logTrading("debug", `${sym}: buy not placed — ${decision.reasoning}`);
      return;
    }

    const signalId = repo.insertSignal({
      symbol: sym,
      technicalScore: strat.technicalScore,
      sentimentScore,
      hybridScore: strat.hybridScore,
      action: decision.action === "close" || decision.action === "sell" ? "sell" : decision.action,
      executed: false,
      rejectionReason: null,
    });

    let submission: SubmitOrderResult;
    try {
      submission = await submitOrder(decision, this.config, this.broker);
    } catch (e) {
      this.status.lastError = e instanceof Error ? e.message : String(e);
      repo.updateSignal(signalId, { executed: false, rejectionReason: this.status.lastError });
      return;
    }

    if (submission.submitted && submission.order) {
      this.pendingSymbolCooldown.set(sym, Date.now() + 3_600_000);
      repo.insertTrade({
        signalId,
        brokerOrderId: submission.order.id,
        symbol: sym,
        side: decision.action === "sell" || decision.action === "close" ? "sell" : "buy",
        qty: decision.qty,
        status: submission.order.status,
        submittedAt: submission.order.submittedAt,
        filledAt: null,
        filledAvgPrice: submission.order.filledAvgPrice ?? null,
      });
      repo.updateSignal(signalId, { executed: true, rejectionReason: null });
      this.logTrading(
        "info",
        `${sym}: ORDER submitted — ${decision.action.toUpperCase()} qty=${decision.qty} orderId=${submission.order.id} status=${submission.order.status}`,
      );
    } else {
      const reason = submission?.reason ?? "order not submitted";
      repo.updateSignal(signalId, { executed: false, rejectionReason: reason });
      this.logTrading("warn", `${sym}: order NOT submitted — ${reason}`);
    }
  }

  async runPortfolioCycle(): Promise<void> {
    this.status.lastPortfolioAt = new Date().toISOString();
    if (!this.config.trading.enabled) {
      this.logTrading("warn", "Portfolio cycle skipped — trading disabled");
      return;
    }
    this.refreshReadiness();
    if (!this.status.readiness.ok) {
      this.logTrading("warn", `Portfolio cycle skipped — not ready: ${this.status.readiness.issues[0] ?? "unknown"}`);
      return;
    }

    const positions: Position[] = await this.broker.listPositions();
    this.logTrading("info", `Portfolio cycle: evaluating ${positions.length} open position(s)`);
    for (const p of positions) {
      this.logTrading("debug", `  evaluating position ${p.symbol} (qty ${p.qty})`);
      await this.evaluateSymbol(p.symbol, "portfolio");
    }
    this.logTrading("info", "Portfolio cycle complete");
  }

  async runCandidateCycle(): Promise<void> {
    this.status.lastCandidateAt = new Date().toISOString();
    if (!this.config.trading.enabled) {
      this.logTrading("warn", "Candidate cycle skipped — trading disabled");
      return;
    }
    const repo = this.ensureDb();
    if (repo) {
      for (const s of this.config.watchlist.symbols) {
        repo.upsertWatchlistEntry({
          symbol: s,
          status: "watching",
          source: "config",
          rankScore: null,
          lastScannedAt: new Date().toISOString(),
          cooldownUntil: null,
          notes: "synced from config.watchlist",
        });
      }
    }
    const symbols = this.config.watchlist.symbols;
    this.logTrading("info", `Candidate cycle: evaluating ${symbols.length} watchlist symbol(s)`);
    for (const s of symbols) {
      this.logTrading("debug", `  evaluating watchlist candidate ${s}`);
      await this.evaluateSymbol(s, "candidate");
    }
    this.logTrading("info", "Candidate cycle complete");
  }

  /** Backfill snapshot outcomes from `price_history` (returns rows updated). */
  runOutcomeBackfill(): number {
    const repo = this.ensureDb();
    if (!repo) return 0;
    return updateExpiredOutcomes(repo, { batchSize: 500, timeframe: TIMEFRAME });
  }

  /** Run one walk-forward optimization cycle (mutates config + writes config.toml). */
  runAutonomousOptimization(log?: (msg: string) => void): OptimizationCycleResult {
    const repo = this.ensureDb();
    if (!repo) {
      this.logOptimizer("error", "Optimization aborted — database unavailable");
      return { runId: "", status: "failed", notes: "database unavailable", weightsUpdated: false };
    }
    this.logOptimizer("info", "Walk-forward optimization cycle starting…");
    const combinedLog = (msg: string): void => {
      this.logOptimizer("info", msg);
      log?.(msg);
    };
    const result = runOptimizationCycle(this.config, repo, combinedLog);
    this.logOptimizer(
      result.status === "failed" ? "error" : "info",
      `Optimization complete — status=${result.status} weightsUpdated=${result.weightsUpdated} notes=${result.notes}`,
    );
    return result;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
    this.repo = null;
  }

  /**
   * Delete the SQLite file (and WAL sidecars), then open a fresh migrated DB.
   * Removes signals, optimization snapshots, and other strategy history.
   */
  eraseTradingDatabase(): { ok: boolean; error?: string } {
    const p = resolveTradingDatabasePath(this.config);
    this.status.dbPath = p;
    this.close();
    try {
      removeSqliteFileFamily(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.refreshReadiness();
      return { ok: false, error: msg };
    }
    try {
      this.db = openTradingDatabase(p);
      this.repo = new TradingRepositories(this.db);
      this.status.dbOpenError = null;
      this.status.lastError = null;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      this.db = null;
      this.repo = null;
      this.status.dbOpenError = describeSqliteLoadError(raw);
      this.refreshReadiness();
      return { ok: false, error: this.status.dbOpenError };
    }
    this.refreshReadiness();
    return { ok: true };
  }

  setBroker(broker: BrokerAdapter): void {
    this.broker = broker;
  }

  // ---------------------------------------------------------------------------
  // Internal log helpers — push to the LogService bus so Insights → Bot debugging
  // receives fine-grained messages without touching the orchestrator state.
  // ---------------------------------------------------------------------------

  private logTrading(level: "info" | "warn" | "error" | "debug", message: string): void {
    this.logService?.push("trading", level, message);
  }

  private logOptimizer(level: "info" | "warn" | "error" | "debug", message: string): void {
    this.logService?.push("optimizer", level, message);
  }
}

function removeSqliteFileFamily(dbPath: string): void {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      fs.unlinkSync(path);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw e;
    }
  }
}

/** User-facing line for TUI / logs — avoid multi-line native stack paths. */
function describeSqliteLoadError(raw: string): string {
  const hint = "Fix: npm run rebuild:native — or rm -rf node_modules && npm install --legacy-peer-deps";
  if (raw.includes("NODE_MODULE_VERSION")) {
    return `SQLite was compiled for a different Node.js ABI. ${hint}`;
  }
  if (raw.includes("did not self-register") || raw.includes("self-register")) {
    return `SQLite native module failed to load (wrong Node build or broken install). ${hint}`;
  }
  if (raw.includes("Cannot find module") && raw.includes("better_sqlite3")) {
    return `SQLite native binary missing. ${hint}`;
  }
  const short = raw.replace(/\s+/g, " ").trim().slice(0, 140);
  return short.length < raw.length ? `${short}… ${hint}` : `${short} ${hint}`;
}

/** Map hybrid / buy_threshold from [-1, 1] to [0, 100] for conviction distance. */
function hybridAxisTo100(value: number): number {
  const v = ((value + 1) / 2) * 100;
  return Math.max(0, Math.min(100, v));
}

/**
 * Buy notional (USD) from cash balance and how far hybrid is above buy_threshold
 * on a 0–100 axis: fraction = |score₁₀₀ − threshold₁₀₀| / 100.
 * Then apply `[trading].positioning_scalar` and cap by `[risk].max_position_pct` of equity.
 */
export function computeBuyNotionalUsd(
  config: Config,
  hybridScore: number,
  account: Pick<AccountSummary, "cash" | "equity">,
): { notional: number; conviction: number; score100: number; threshold100: number } {
  const threshold100 = hybridAxisTo100(config.strategy.simple.buy_threshold);
  const score100 = hybridAxisTo100(hybridScore);
  const conviction = Math.abs(score100 - threshold100) / 100;
  const balance = Math.max(0, account.cash);
  const scalar = config.trading.positioning_scalar ?? 1;
  const raw = scalar * balance * conviction;
  const cap = (Math.max(0, account.equity) * config.risk.max_position_pct) / 100;
  const notional = Math.min(raw, cap);
  return { notional, conviction, score100, threshold100 };
}

async function buildOrderDecision(
  config: Config,
  symbol: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
  strat: ReturnType<typeof computeSimpleStrategy>,
  newsItemCount: number,
  lastClose: number,
  account: AccountSummary,
  positionQty: number,
  sellPositionFraction: number | null,
  buyNotionalBandFraction: number | null,
  isFractionable: boolean,
): Promise<Decision> {
  const reason = `hybrid=${strat.hybridScore.toFixed(3)} tech=${strat.technicalScore.toFixed(3)} news=${newsItemCount} rsi=${strat.rsiValue?.toFixed(1) ?? "—"}`;
  const allowFrac = config.trading.fractional_shares && isFractionable;

  if (action === "hold") {
    return { action: "hold", symbol, qty: 0, reasoning: reason, confidence };
  }
  if (action === "sell" || (action as string) === "close") {
    const q = positionQty;
    if (q <= 0) {
      return { action: "hold", symbol, qty: 0, reasoning: `${reason} (no position)`, confidence };
    }
    const fullExit = sellPositionFraction == null || sellPositionFraction >= 1 - 1e-9;
    const rawQty = fullExit ? q : q * (sellPositionFraction ?? 1);
    const sellQty = fullExit ? q : allowFrac ? rawQty : Math.floor(rawQty);
    const isFractionalSell = sellQty % 1 !== 0;
    const sellNotional = sellQty * lastClose;

    if (sellQty <= 0 || (isFractionalSell && sellNotional < 1.0)) {
      const minReason =
        sellQty <= 0
          ? "partial sell quantity is 0"
          : `fractional sell notional $${sellNotional.toFixed(2)} < $1.00`;
      return {
        action: "hold",
        symbol,
        qty: 0,
        reasoning: `${reason} · ${minReason} (have ${q})`,
        confidence,
      };
    }
    const frac = sellPositionFraction ?? 1;
    const sellNote = fullExit ? "sell 100% of position" : `sell ~${(frac * 100).toFixed(1)}% → ${sellQty}/${q} sh`;
    return {
      action: "close",
      symbol,
      qty: Math.min(sellQty, q),
      reasoning: `${reason} · ${sellNote}`,
      confidence,
    };
  }
  const buyBase = computeBuyNotionalUsd(config, strat.hybridScore, account);
  let notional = buyBase.notional;
  const { conviction, score100, threshold100 } = buyBase;
  const trimFrac = buyNotionalBandFraction;
  let trimmed = false;
  if (trimFrac != null && trimFrac < 1 - 1e-9) {
    notional *= trimFrac;
    trimmed = true;
  }
  const trimNote = trimmed && trimFrac != null ? ` × buyTrim=${(trimFrac * 100).toFixed(1)}%` : "";
  const sizeNote = `notional≈$${notional.toFixed(2)} (cash=$${Math.max(0, account.cash).toFixed(2)}×scalar=${config.trading.positioning_scalar ?? 1}×|${score100.toFixed(1)}−${threshold100.toFixed(1)}|/100=${conviction.toFixed(3)} cap=${config.risk.max_position_pct}%eq)${trimNote}`;

  const rawBuyQty = lastClose > 0 ? notional / lastClose : 0;
  const qty = allowFrac ? rawBuyQty : Math.floor(rawBuyQty);

  if (allowFrac) {
    if (qty <= 0 || notional < 1.0) {
      const failReason = qty <= 0 ? "quantity is 0" : `notional $${notional.toFixed(2)} < $1.00`;
      return {
        action: "hold",
        symbol,
        qty: 0,
        reasoning: `${reason} · ${sizeNote} — ${failReason}`,
        confidence,
      };
    }
  } else if (qty < 1) {
    return {
      action: "hold",
      symbol,
      qty: 0,
      reasoning: `${reason} · ${sizeNote} — below 1 share at last close`,
      confidence,
    };
  }
  return {
    action: "buy",
    symbol,
    qty,
    reasoning: `${reason} · ${sizeNote}`,
    confidence,
  };
}
