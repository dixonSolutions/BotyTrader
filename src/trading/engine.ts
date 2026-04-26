/**
 * Deterministic simple-strategy engine: signals, persistence, optional orders.
 */

import { submitOrder, type SubmitOrderResult } from "../actions/alpaca.js";
import type { Decision } from "../actions/types.js";
import type { Config, Secrets } from "../config.js";
import { resolveTradingDatabasePath } from "../config.js";
import type { BrokerAdapter, NewsItem, Position, PriceBar } from "../execution/broker.js";
import { aggregateNewsSentiment, getLocalClassifier } from "./sentiment/finbert.js";
import { checkTradingReadiness, type ReadinessResult } from "./readiness.js";
import { openTradingDatabase } from "./storage/database.js";
import { newsItemsForSymbol, TradingRepositories } from "./storage/repositories.js";
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
  lastDiscoveryAt: string | null;
  sentimentModelOk: boolean;
  sentimentError: string | null;
  dbPath: string;
}

export class TradingEngine {
  private readonly config: Config;
  private readonly secrets: Secrets;
  private broker: BrokerAdapter;
  private db: Database.Database | null = null;
  private repo: TradingRepositories | null = null;
  private status: TradingEngineStatus;
  private pendingSymbolCooldown = new Map<string, number>();

  constructor(config: Config, secrets: Secrets, broker: BrokerAdapter) {
    this.config = config;
    this.secrets = secrets;
    this.broker = broker;
    this.status = {
      ready: false,
      readiness: { ok: true, issues: [], warnings: [] },
      lastError: null,
      dbOpenError: null,
      lastPortfolioAt: null,
      lastCandidateAt: null,
      lastDiscoveryAt: null,
      sentimentModelOk: true,
      sentimentError: null,
      dbPath: resolveTradingDatabasePath(config),
    };
  }

  getStatus(): TradingEngineStatus {
    return { ...this.status };
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
    if (this.config.sentiment.provider !== "local_finbert") {
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
    _reason: "portfolio" | "candidate" | "discovery" | "manual",
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

    const strat = computeSimpleStrategy(this.config, { closes, sentimentScore });
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

    const account = await this.broker.getAccount();
    const decision = await buildOrderDecision(
      this.config,
      sym,
      action,
      confidence,
      strat,
      newsItemCount,
      lastClose,
      account.equity,
      hasPosition && pos ? pos.qty : 0,
    );

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
    } else {
      repo.updateSignal(signalId, {
        executed: false,
        rejectionReason: submission?.reason ?? "order not submitted",
      });
    }
  }

  async runPortfolioCycle(): Promise<void> {
    this.status.lastPortfolioAt = new Date().toISOString();
    if (!this.config.trading.enabled) return;
    this.refreshReadiness();
    if (!this.status.readiness.ok) return;
    const positions: Position[] = await this.broker.listPositions();
    for (const p of positions) {
      await this.evaluateSymbol(p.symbol, "portfolio");
    }
  }

  async runCandidateCycle(): Promise<void> {
    this.status.lastCandidateAt = new Date().toISOString();
    if (!this.config.trading.enabled) return;
    for (const s of this.config.watchlist.symbols) {
      await this.evaluateSymbol(s, "candidate");
    }
  }

  async runDiscoveryCycle(): Promise<void> {
    this.status.lastDiscoveryAt = new Date().toISOString();
    if (!this.config.trading.enabled) return;
    const repo = this.ensureDb();
    if (!repo) {
      this.status.lastError = this.status.dbOpenError ?? "Trading database unavailable.";
      return;
    }
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

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
    this.repo = null;
  }

  setBroker(broker: BrokerAdapter): void {
    this.broker = broker;
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

async function buildOrderDecision(
  config: Config,
  symbol: string,
  action: "buy" | "sell" | "hold",
  confidence: number,
  strat: ReturnType<typeof computeSimpleStrategy>,
  newsItemCount: number,
  lastClose: number,
  equity: number,
  positionQty: number,
): Promise<Decision> {
  const reason = `hybrid=${strat.hybridScore.toFixed(3)} tech=${strat.technicalScore.toFixed(3)} news=${newsItemCount} rsi=${strat.rsiValue?.toFixed(1) ?? "—"}`;

  if (action === "hold") {
    return { action: "hold", symbol, qty: 0, reasoning: reason, confidence };
  }
  if (action === "sell" || (action as string) === "close") {
    const q = positionQty;
    if (q <= 0) {
      return { action: "hold", symbol, qty: 0, reasoning: `${reason} (no position)`, confidence };
    }
    return { action: "close", symbol, qty: q, reasoning: reason, confidence };
  }
  const notional = (equity * config.risk.max_position_pct) / 100;
  const qty = lastClose > 0 ? Math.max(1, Math.floor(notional / lastClose)) : 1;
  return { action: "buy", symbol, qty, reasoning: reason, confidence };
}
