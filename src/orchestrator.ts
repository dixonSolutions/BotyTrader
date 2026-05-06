/**
 * Orchestrator — single source of truth for runtime state.
 *
 * Owns:
 *   - the active broker adapter, memory store, and exit monitor
 *   - the cycle schedule and watchlist rotation
 *   - validation gates between agent decisions and broker side effects
 *   - a bounded log buffer the TUI subscribes to
 *
 * The TUI reads `state` and dispatches commands; it never touches brokers
 * or memory directly. This keeps the security boundary in one place and
 * makes a future remote API straightforward to add.
 */

import { resolvePaths, writeConfig, type Config, type Secrets } from "./config.js";
import type { TradingMode } from "./config.js";
import { createBrokerAdapter } from "./execution/adapters/index.js";
import { TradingEngine, type TradingEngineStatus } from "./trading/engine.js";
import type { LogService } from "./services/logService.js";
import { shouldRunOptimizationSchedule } from "./trading/optimization/optimizer.js";
import type { SignalRow } from "./trading/types.js";
import {
  installLocalSentimentWeights,
  removeLocalSentimentArtifacts,
  SUPPORTED_SENTIMENT_REPO_ID,
  type SentimentInstallProgress,
} from "./trading/sentiment/finbert.js";
import type { AccountSummary, BrokerAdapter, NewsItem, Order, Position } from "./execution/broker.js";
import { ExitMonitor, type ExitEvent } from "./execution/exit_monitor.js";
import {
  computePerformance,
  type EquitySample,
  type PerformanceMetrics,
} from "./metrics.js";
import {
  readSessionSnapshot,
  writeSessionSnapshot,
} from "./runtime/session_snapshot.js";
import type { PreviousSessionSummary } from "./runtime/session_snapshot.js";

export type { PreviousSessionSummary } from "./runtime/session_snapshot.js";

import { runCycle } from "./agent/loop.js";
import { submitOrder } from "./actions/alpaca.js";
import { summarizeToMemory } from "./actions/memory.js";
import { DisabledMemoryStore, type WorkingMemoryStore } from "./memory/disabled_store.js";
import { MemoryStore } from "./memory/store.js";
import { GeminiEmbedder } from "./memory/embedder.js";
import { HfBucket } from "./memory/hf.js";

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "agent";
  message: string;
}

export type BotStatus = "running" | "paused" | "error";

export interface OrchestratorState {
  brokerName: string;
  connected: boolean;
  status: BotStatus;
  startedAt: string;
  pingMs: number | null;
  account: AccountSummary | null;
  positions: Position[];
  logs: LogEntry[];
  watchlist: string[];
  autotrade: boolean;
  equityHistory: EquitySample[];
  recentOrders: Order[];
  performance: PerformanceMetrics;
  /** Summary written when the app last exited cleanly (see `session_snapshot.ts`). */
  previousSession: PreviousSessionSummary | null;
  /** Deterministic simple-strategy engine status (FinBERT, DB, Alpaca). */
  trading: TradingEngineStatus;
  /** True while a trading engine cycle (portfolio/candidate) is in flight. */
  tradingBusy: boolean;
  portfolioCycleSeconds: number;
  candidateCycleSeconds: number;
  tradingMode: TradingMode;
  /** Latest rows from `signals` table (simple strategy audit). */
  recentTradingSignals: SignalRow[];
}

export type StateListener = (state: OrchestratorState) => void;

const LOG_BUFFER_MAX = 500;
const EQUITY_HISTORY_MAX = 1024;
const ORDER_HISTORY_MAX = 200;
const PING_INTERVAL_MS = 15_000;

export interface OrchestratorOptions {
  config: Config;
  secrets: Secrets;
  broker: BrokerAdapter;
  /** Optional real-time log bus. When supplied, every log entry is also pushed
   *  to the LogService so the Debugging screen can stream it live. */
  logService?: LogService;
}

export class Orchestrator {
  readonly config: Config;
  readonly secrets: Secrets;
  /** Swapped at runtime when paper/live (Alpaca) changes — do not hold stale references. */
  broker: BrokerAdapter;
  exitMonitor: ExitMonitor;
  readonly tradingEngine: TradingEngine;
  /** Real-time log bus (injected at construction, optional). */
  readonly logService: LogService | null;

  private readonly listeners = new Set<StateListener>();
  private state: OrchestratorState;
  private pingTimer: NodeJS.Timeout | null = null;
  private portfolioTimer: NodeJS.Timeout | null = null;
  private candidateTimer: NodeJS.Timeout | null = null;
  private outcomeMonitorTimer: NodeJS.Timeout | null = null;
  private optimizationScheduleTimer: NodeJS.Timeout | null = null;
  private lastOptimizationLocalDayKey: string | null = null;
  private optimizationInFlight = false;
  private tradingCycleInFlight = false;
  private agentCycleInFlight = false;
  private paused = false;

  constructor(opts: OrchestratorOptions) {
    this.config = opts.config;
    this.secrets = opts.secrets;
    this.broker = opts.broker;
    this.logService = opts.logService ?? null;
    this.exitMonitor = new ExitMonitor(opts.broker, opts.config);
    this.tradingEngine = new TradingEngine(opts.config, opts.secrets, opts.broker, opts.logService);

    const paths = resolvePaths();
    this.state = {
      brokerName: this.broker.name,
      connected: false,
      status: "running",
      startedAt: new Date().toISOString(),
      pingMs: null,
      account: null,
      positions: [],
      logs: [],
      watchlist: [...this.config.watchlist.symbols],
      autotrade: this.config.autotrade.enabled,
      equityHistory: [],
      recentOrders: [],
      performance: emptyPerformance(),
      previousSession: readSessionSnapshot(paths.root),
      trading: this.tradingEngine.getStatus(),
      tradingBusy: false,
      portfolioCycleSeconds: this.config.schedule.portfolio_cycle_seconds,
      candidateCycleSeconds: this.config.schedule.candidate_cycle_seconds,
      tradingMode: this.config.trading.mode,
      recentTradingSignals: [],
    };

    this.exitMonitor.onExit((e) => this.onExitEvent(e));
  }

  // -------------------------------------------------------------------------
  // Public lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.log("info", `Starting orchestrator with broker ${this.broker.name}`);
    this.tradingEngine.refreshReadiness();
    await this.tradingEngine.warmSentimentModel();
    this.pushTradingState();
    await this.measurePing();

    await this.refreshAccount();
    await this.refreshOrders();

    this.exitMonitor.start();
    this.startPingLoop();
    this.scheduleTradingCycles();
    this.startOptimizationTimers();

    // `setInterval` does not run until the first delay elapses — without this, new
    // watchlist symbols would not be evaluated until `candidate_cycle_seconds` (often 30m).
    if (this.config.trading.enabled) {
      void this.runStartupCandidateCycle();
    }
  }

  /** One immediate watchlist pass so Insights / SQLite reflect every symbol without waiting on the candidate timer. */
  private async runStartupCandidateCycle(): Promise<void> {
    if (this.tradingCycleInFlight) return;
    this.tradingCycleInFlight = true;
    this.update({ tradingBusy: true });
    try {
      this.log("info", "Startup: running one candidate cycle for the full watchlist (timers fire later)…");
      await this.tradingEngine.runCandidateCycle();
      await this.refreshAccount();
    } catch (e) {
      this.log("error", `Startup candidate cycle: ${describe(e)}`);
    } finally {
      this.tradingCycleInFlight = false;
      this.update({ tradingBusy: false });
      this.pushTradingState();
    }
  }

  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearTradingTimers();
    this.clearOptimizationTimers();
    this.tradingEngine.close();
    this.exitMonitor.stop();
    this.persistSessionSnapshot();
    this.log("info", "Orchestrator stopped.");
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clearTradingTimers();
    this.clearOptimizationTimers();
    this.exitMonitor.stop();
    this.update({ status: "paused" });
    this.log("info", "Orchestrator paused.");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.exitMonitor.start();
    this.scheduleTradingCycles();
    this.startOptimizationTimers();
    this.update({ status: "running" });
    this.log("info", "Orchestrator resumed.");
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  // -------------------------------------------------------------------------
  // State subscription
  // -------------------------------------------------------------------------

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): OrchestratorState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Commands (called from TUI)
  // -------------------------------------------------------------------------

  setAutotrade(enabled: boolean): void {
    this.config.autotrade.enabled = enabled;
    writeConfig(this.config);
    this.update({ autotrade: enabled });
    this.log("info", `Autotrade ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Persist `agent.sentiment_weight` (0 = technical-heavy, 1 = sentiment-heavy).
   * Used from Config → Models (strategy blend between technical and FinBERT sentiment).
   */
  setSentimentWeight(weight: number): void {
    if (!Number.isFinite(weight)) {
      this.log("warn", `Ignoring invalid sentiment_weight: ${weight}`);
      return;
    }
    const w = Math.max(0, Math.min(1, weight));
    this.config.agent.sentiment_weight = w;
    writeConfig(this.config);
    this.log("info", `Sentiment vs technical blend set to ${(w * 100).toFixed(0)}% sentiment / ${((1 - w) * 100).toFixed(0)}% technical.`);
  }

  setWatchlist(symbols: string[]): void {
    const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    if (unique.length === 0) {
      this.log("warn", "Watchlist must include at least one symbol — change ignored.");
      return;
    }
    this.config.watchlist.symbols = unique;
    writeConfig(this.config);
    this.update({ watchlist: unique });
    this.log("info", `Watchlist updated: ${unique.join(", ")}`);
  }

  /** Generic numeric field setter for risk thresholds — used by the Settings editor. */
  setRiskField(
    field: "max_position_pct" | "min_confidence_to_trade" | "stop_loss_pct" | "take_profit_pct",
    value: number,
  ): void {
    if (!Number.isFinite(value) || value < 0) {
      this.log("warn", `Ignoring invalid risk.${field}: ${value}`);
      return;
    }
    this.config.risk[field] = value;
    writeConfig(this.config);
    this.log("info", `risk.${field} set to ${value}.`);
    this.notify();
  }

  /** Manual ping — Insights footer hint binds this. */
  async pingNow(): Promise<void> {
    await this.measurePing();
  }

  /**
   * Run one **ReAct LLM** cycle (tools + causal model → Final JSON decision) for a symbol.
   * This is **not** the deterministic simple-strategy engine — use {@link runTradingNow} for that.
   * Post-decision path: validated `submitOrder` + optional `summarizeToMemory` (same boundary as docs).
   */
  async runNow(symbol?: string): Promise<void> {
    if (this.agentCycleInFlight) {
      this.log("warn", "Agent cycle already running.");
      return;
    }
    const raw = symbol?.trim();
    const sym = (raw && raw.length > 0 ? raw : this.state.watchlist[0])?.toUpperCase();
    if (!sym) {
      this.log("warn", "runNow: no symbol (watchlist empty).");
      return;
    }

    this.agentCycleInFlight = true;
    const startedAt = new Date().toISOString();
    this.log("info", `Manual agent cycle starting for ${sym}…`);

    let memory: WorkingMemoryStore = new DisabledMemoryStore();
    if (this.config.features.memory_enabled) {
      const geminiKey = this.secrets.GEMINI_API_KEY;
      const hfTok = this.secrets.HF_TOKEN;
      if (geminiKey && hfTok) {
        try {
          const bucket = new HfBucket({
            bucketName: this.config.huggingface.bucket_name,
            endpoint: this.config.huggingface.endpoint,
            region: this.config.huggingface.region,
            token: hfTok,
          });
          const embedder = new GeminiEmbedder({
            apiKey: geminiKey,
            model: this.config.gemini.embedding_model,
          });
          const store = new MemoryStore({ bucket, embedder });
          await store.sync();
          memory = store;
        } catch (e) {
          this.log("warn", `Memory sync failed (${describe(e)}); continuing without RAG for this cycle.`);
        }
      } else {
        this.log("warn", "Memory enabled but credentials incomplete; continuing without RAG for this cycle.");
      }
    }

    try {
      const ctx = { broker: this.broker, secrets: this.secrets };
      const { decision, toolCalls } = await runCycle({
        symbol: sym,
        config: this.config,
        secrets: this.secrets,
        ctx,
        memory,
        onStep: (step) => {
          if (step.kind === "decision") {
            this.log(
              "agent",
              `${step.decision.action.toUpperCase()} ${step.decision.symbol} conf=${step.decision.confidence.toFixed(2)}`,
            );
          }
        },
      });
      const finishedAt = new Date().toISOString();
      this.log(
        "info",
        `Agent cycle complete: ${decision.action.toUpperCase()} ${decision.symbol} qty=${decision.qty} conf=${decision.confidence.toFixed(2)}`,
      );

      const submit = await submitOrder(decision, this.config, this.broker);
      if (submit.submitted && submit.order) {
        this.log("info", `Order submitted (${submit.order.id ?? "ok"}).`);
        await this.refreshOrders();
        this.recomputePerformance();
      } else if (decision.action === "buy" || decision.action === "sell" || decision.action === "close") {
        this.log("info", `Order not submitted: ${submit.reason ?? "unknown"}`);
      }

      if (memory instanceof MemoryStore) {
        try {
          await summarizeToMemory(
            { symbol: sym, decision, toolCalls, startedAt, finishedAt },
            memory,
          );
        } catch (e) {
          this.log("warn", `Memory write failed: ${describe(e)}`);
        }
      }

      await this.refreshAccount();
    } catch (e) {
      this.log("error", `Agent cycle: ${describe(e)}`);
    } finally {
      this.agentCycleInFlight = false;
    }
  }

  /**
   * Alpaca Market Data news: pages at 50/request until the feed ends; tickers use
   * `symbols=`; phrases match keywords across the full fetched set.
   */
  async searchAlpacaNews(
    query: string,
  ): Promise<{ ok: true; items: NewsItem[] } | { ok: false; error: string }> {
    const q = query.trim();
    if (!q) {
      return { ok: false, error: "Enter a symbol or keywords to search." };
    }
    if (!this.broker.searchNews) {
      return { ok: false, error: "News search requires an Alpaca broker (paper or live)." };
    }
    try {
      const items = await this.broker.searchNews(q);
      return { ok: true, items };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // -------------------------------------------------------------------------
  // Trading engine (simple strategy + FinBERT)
  // -------------------------------------------------------------------------

  setTradingMode(mode: TradingMode): void {
    this.config.trading.mode = mode;
    if (this.config.broker.platform === "alpaca_paper" || this.config.broker.platform === "alpaca_live") {
      this.config.broker.platform = mode === "live" ? "alpaca_live" : "alpaca_paper";
    }
    writeConfig(this.config);
    if (this.config.broker.platform === "alpaca_paper" || this.config.broker.platform === "alpaca_live") {
      const next = createBrokerAdapter(this.config.broker.platform, this.secrets);
      this.broker = next;
      this.tradingEngine.setBroker(next);
      this.exitMonitor.stop();
      this.exitMonitor = new ExitMonitor(next, this.config);
      this.exitMonitor.onExit((e) => this.onExitEvent(e));
      if (!this.paused) this.exitMonitor.start();
      void this.measurePing();
    }
    this.update({ tradingMode: mode, brokerName: this.broker.name, trading: this.tradingEngine.getStatus() });
    this.log("info", `Trading mode: ${mode} (broker: ${this.config.broker.platform})`);
  }

  setTradingEnabled(enabled: boolean): void {
    this.config.trading.enabled = enabled;
    writeConfig(this.config);
    this.tradingEngine.refreshReadiness();
    this.pushTradingState();
    this.log("info", `Trading engine ${enabled ? "enabled" : "disabled"}.`);
  }

  setSimpleStrategyEnabled(enabled: boolean): void {
    this.config.strategy.simple.enabled = enabled;
    writeConfig(this.config);
    this.pushTradingState();
  }

  setSimpleStrategyNumeric(
    field:
      | "technical_weight"
      | "sentiment_weight"
      | "buy_threshold"
      | "sell_threshold"
      | "sma_neutral_band",
    value: number,
  ): void {
    if (!Number.isFinite(value)) return;
    this.config.strategy.simple[field] = value;
    writeConfig(this.config);
    this.pushTradingState();
  }

  setSimpleStrategyInt(
    field: "sma_fast_period" | "sma_slow_period" | "rsi_period",
    value: number,
  ): void {
    if (!Number.isFinite(value) || value < 1) return;
    this.config.strategy.simple[field] = Math.floor(value);
    writeConfig(this.config);
    this.pushTradingState();
  }

  /**
   * Enable/disable a technical indicator.
   * @param indicatorId - The indicator ID (sma, ema, rsi, macd, bollinger, stochastic, atr, obv, fibonacci, ichimoku)
   * @param enabled - Whether to enable the indicator
   */
  setIndicatorEnabled(indicatorId: keyof Config["indicators"], enabled: boolean): void {
    const indicator = this.config.indicators[indicatorId];
    if (!indicator) return;
    indicator.enabled = enabled;
    writeConfig(this.config);
    this.log("info", `Indicator ${indicatorId} ${enabled ? "enabled" : "disabled"}.`);
    this.pushTradingState();
  }

  /**
   * Set the weight for a technical indicator.
   * @param indicatorId - The indicator ID
   * @param weight - The weight (0-1) for this indicator in the composite score
   */
  setIndicatorWeight(indicatorId: keyof Config["indicators"], weight: number): void {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) return;
    const indicator = this.config.indicators[indicatorId];
    if (!indicator) return;
    indicator.weight = weight;
    writeConfig(this.config);
    this.log("info", `Indicator ${indicatorId} weight set to ${(weight * 100).toFixed(0)}%.`);
    this.pushTradingState();
  }

  /**
   * Set an integer parameter for an indicator.
   * @param indicatorId - The indicator ID
   * @param field - The field name (period, fast_period, slow_period, etc.)
   * @param value - The integer value
   */
  setIndicatorInt(
    indicatorId: keyof Config["indicators"],
    field: string,
    value: number,
  ): void {
    if (!Number.isFinite(value) || value < 1) return;
    const indicator = this.config.indicators[indicatorId];
    if (!indicator) return;
    // Type-safe assignment to the indicator config
    (indicator as Record<string, number | boolean>)[field] = Math.floor(value);
    writeConfig(this.config);
    this.log("info", `Indicator ${indicatorId} ${field} set to ${Math.floor(value)}.`);
    this.pushTradingState();
  }

  /**
   * Set a numeric parameter for an indicator.
   * @param indicatorId - The indicator ID
   * @param field - The field name (std_dev, proximity_threshold, etc.)
   * @param value - The numeric value
   */
  setIndicatorNumeric(
    indicatorId: keyof Config["indicators"],
    field: string,
    value: number,
  ): void {
    if (!Number.isFinite(value)) return;
    const indicator = this.config.indicators[indicatorId];
    if (!indicator) return;
    (indicator as Record<string, number | boolean>)[field] = value;
    writeConfig(this.config);
    this.log("info", `Indicator ${indicatorId} ${field} set to ${value.toFixed(4)}.`);
    this.pushTradingState();
  }

  /**
   * Reset all indicator weights to their default values.
   */
  resetIndicatorWeights(): void {
    const defaults = {
      sma: 0.15,
      ema: 0.10,
      rsi: 0.12,
      macd: 0.10,
      bollinger: 0.08,
      stochastic: 0.08,
      atr: 0.05,
      obv: 0.12,
      fibonacci: 0.10,
      ichimoku: 0.10,
    };
    for (const [id, weight] of Object.entries(defaults)) {
      const indicator = this.config.indicators[id as keyof Config["indicators"]];
      if (indicator) {
        indicator.weight = weight;
        indicator.enabled = true;
      }
    }
    writeConfig(this.config);
    this.log("info", "All indicator weights reset to defaults.");
    this.pushTradingState();
  }

  setTradingPositioningScalar(value: number): void {
    if (!Number.isFinite(value)) return;
    this.config.trading.positioning_scalar = Math.max(0, Math.min(10, value));
    writeConfig(this.config);
    this.pushTradingState();
  }

  setTradingDatabasePath(p: string): void {
    this.config.trading.database_path = p.trim();
    writeConfig(this.config);
    this.tradingEngine.close();
    this.tradingEngine.refreshReadiness();
    this.pushTradingState();
  }

  setSentimentConfig(patch: {
    provider: Config["sentiment"]["provider"];
    modelId?: string;
    cacheTtlHours?: number;
    hfApiRunsNumerator?: number;
    hfApiRunsDenominator?: number;
  }): void {
    const prevP = this.config.sentiment.provider;
    const prevM = this.config.sentiment.model_id;
    this.config.sentiment.provider = patch.provider;
    if (patch.modelId != null) this.config.sentiment.model_id = patch.modelId.trim();
    if (patch.cacheTtlHours != null && Number.isFinite(patch.cacheTtlHours) && patch.cacheTtlHours > 0) {
      this.config.sentiment.cache_ttl_hours = patch.cacheTtlHours;
    }
    if (patch.hfApiRunsNumerator != null && Number.isFinite(patch.hfApiRunsNumerator)) {
      this.config.sentiment.hf_api_runs_numerator = Math.max(0, Math.min(20, Math.floor(patch.hfApiRunsNumerator)));
    }
    if (patch.hfApiRunsDenominator != null && Number.isFinite(patch.hfApiRunsDenominator)) {
      this.config.sentiment.hf_api_runs_denominator = Math.max(1, Math.min(20, Math.floor(patch.hfApiRunsDenominator)));
    }
    const den = Math.max(1, this.config.sentiment.hf_api_runs_denominator);
    if (this.config.sentiment.hf_api_runs_numerator > den) {
      this.config.sentiment.hf_api_runs_numerator = den;
    }
    writeConfig(this.config);
    const rewarm = patch.provider !== prevP || (patch.modelId != null && patch.modelId.trim() !== prevM);
    if (rewarm) {
      void this.warmSentimentModel();
    } else {
      this.pushTradingState();
    }
  }

  async warmSentimentModel(): Promise<void> {
    await this.tradingEngine.warmSentimentModel();
    this.pushTradingState();
  }

  /**
   * Pull FinBERT classification files into the local cache, set official `model_id`, and warm.
   * Does not change `sentiment.provider` (e.g. stays `hybrid_finbert` if already selected).
   */
  async installSentimentFinbert(opts?: {
    onProgress?: (p: SentimentInstallProgress) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const { onProgress, signal } = opts ?? {};
    await installLocalSentimentWeights(this.config, onProgress, signal, this.secrets);
    if (signal?.aborted) {
      throw new DOMException("Install cancelled", "AbortError");
    }
    this.config.sentiment.model_id = SUPPORTED_SENTIMENT_REPO_ID;
    writeConfig(this.config);
    await this.tradingEngine.warmSentimentModel();
    this.pushTradingState();
  }

  /**
   * Deletes the on-disk Transformers.js cache folder for the current local
   * sentiment repo (see `localSentimentPipelineModelId`). Hub is not involved;
   * re-install pulls from the Hub again.
   */
  async removeSentimentFinbertLocal(): Promise<{ path: string; removed: boolean }> {
    const r = await removeLocalSentimentArtifacts(this.config);
    await this.tradingEngine.warmSentimentModel();
    this.pushTradingState();
    return r;
  }

  setTradingCycleInterval(field: "portfolio" | "candidate", seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    const s = Math.floor(seconds);
    if (field === "portfolio") {
      this.config.schedule.portfolio_cycle_seconds = s;
      this.update({ portfolioCycleSeconds: s });
    } else {
      this.config.schedule.candidate_cycle_seconds = s;
      this.update({ candidateCycleSeconds: s });
    }
    writeConfig(this.config);
    if (!this.paused) {
      this.clearTradingTimers();
      this.scheduleTradingCycles();
    }
  }

  /** Exit monitor re-reads interval on restart — keeps timer aligned with config. */
  setExitMonitorIntervalSeconds(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    const s = Math.floor(seconds);
    this.config.schedule.exit_monitor_interval_seconds = s;
    writeConfig(this.config);
    if (!this.paused) {
      this.exitMonitor.stop();
      this.exitMonitor.start();
    }
    this.log("info", `Exit monitor interval set to ${s}s`);
  }

  /** Persisted `[schedule].agent_interval_seconds` (ReAct / agent cadence when scheduled). */
  setAgentIntervalSeconds(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    const s = Math.floor(seconds);
    this.config.schedule.agent_interval_seconds = s;
    writeConfig(this.config);
    this.log("info", `Agent cycle interval set to ${s}s`);
  }

  setOptimizationEnabled(enabled: boolean): void {
    this.config.optimization.enabled = enabled;
    writeConfig(this.config);
    if (!this.paused) {
      this.clearOptimizationTimers();
      this.startOptimizationTimers();
    }
    this.pushTradingState();
    this.log("info", `Autonomous optimizer ${enabled ? "enabled" : "disabled"}.`);
  }

  setOptimizationScheduleDay(
    day: "daily" | "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday",
  ): void {
    this.config.optimization.schedule_day = day;
    writeConfig(this.config);
    this.pushTradingState();
  }

  setOptimizationScheduleHour(hour: number): void {
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
    this.config.optimization.schedule_hour = Math.floor(hour);
    writeConfig(this.config);
    this.pushTradingState();
  }

  setOptimizationNumeric(
    field:
      | "lookback_days"
      | "challenger_count"
      | "learning_rate"
      | "improvement_threshold"
      | "max_single_weight"
      | "exit_window_hours"
      | "shadow_capture_range"
      | "mutation_rate"
      | "min_snapshots"
      | "outcome_monitor_interval_minutes",
    value: number,
  ): void {
    if (!Number.isFinite(value)) return;
    const o = this.config.optimization;
    switch (field) {
      case "lookback_days":
        o.lookback_days = Math.max(1, Math.floor(value));
        break;
      case "challenger_count":
        o.challenger_count = Math.max(1, Math.min(500, Math.floor(value)));
        break;
      case "learning_rate":
        o.learning_rate = Math.max(0, Math.min(1, value));
        break;
      case "improvement_threshold":
        o.improvement_threshold = Math.max(0, Math.min(2, value));
        break;
      case "max_single_weight":
        o.max_single_weight = Math.max(0.05, Math.min(1, value));
        break;
      case "exit_window_hours":
        o.exit_window_hours = Math.max(1, Math.floor(value));
        break;
      case "shadow_capture_range":
        o.shadow_capture_range = Math.max(0, Math.min(1, value));
        break;
      case "mutation_rate":
        o.mutation_rate = Math.max(1e-6, Math.min(0.5, value));
        break;
      case "min_snapshots":
        o.min_snapshots = Math.max(1, Math.floor(value));
        break;
      case "outcome_monitor_interval_minutes":
        o.outcome_monitor_interval_minutes = Math.max(1, Math.floor(value));
        break;
    }
    writeConfig(this.config);
    if (field === "outcome_monitor_interval_minutes" && !this.paused) {
      this.clearOptimizationTimers();
      this.startOptimizationTimers();
    }
    this.pushTradingState();
  }

  setOptimizationStressTestEnabled(enabled: boolean): void {
    this.config.optimization.stress_test_enabled = enabled;
    writeConfig(this.config);
    this.pushTradingState();
  }

  /** Run walk-forward optimization once (Insights / testing). */
  async runOptimizationNow(): Promise<void> {
    if (this.optimizationInFlight) {
      this.log("warn", "Optimization already running.");
      return;
    }
    this.optimizationInFlight = true;
    try {
      this.log("info", "Manual optimization cycle starting…");
      const result = this.tradingEngine.runAutonomousOptimization((m) => this.log("info", m));
      this.log(
        "info",
        `Optimization: ${result.status}${result.weightsUpdated ? " — config updated" : ""} — ${result.notes}`,
      );
    } catch (e) {
      this.log("error", `Optimization: ${describe(e)}`);
    } finally {
      this.optimizationInFlight = false;
      this.pushTradingState();
    }
  }

  /** Run portfolio then candidate (watchlist) evaluation once. */
  async runTradingNow(): Promise<void> {
    if (this.tradingCycleInFlight) {
      this.log("warn", "Trading cycle already running.");
      return;
    }
    this.tradingCycleInFlight = true;
    this.update({ tradingBusy: true });
    try {
      await this.tradingEngine.runPortfolioCycle();
      await this.tradingEngine.runCandidateCycle();
      await this.refreshAccount();
    } catch (e) {
      this.log("error", `Trading cycle: ${describe(e)}`);
    } finally {
      this.tradingCycleInFlight = false;
      this.pushTradingState();
      this.update({ tradingBusy: false });
    }
  }

  private pushTradingState(): void {
    this.tradingEngine.refreshReadiness();
    this.update({
      trading: this.tradingEngine.getStatus(),
      tradingMode: this.config.trading.mode,
      recentTradingSignals: this.tradingEngine.listRecentSignals(60),
    });
  }

  private clearTradingTimers(): void {
    if (this.portfolioTimer) {
      clearInterval(this.portfolioTimer);
      this.portfolioTimer = null;
    }
    if (this.candidateTimer) {
      clearInterval(this.candidateTimer);
      this.candidateTimer = null;
    }
  }

  private clearOptimizationTimers(): void {
    if (this.outcomeMonitorTimer) {
      clearInterval(this.outcomeMonitorTimer);
      this.outcomeMonitorTimer = null;
    }
    if (this.optimizationScheduleTimer) {
      clearInterval(this.optimizationScheduleTimer);
      this.optimizationScheduleTimer = null;
    }
  }

  private startOptimizationTimers(): void {
    this.clearOptimizationTimers();
    const o = this.config.optimization;
    if (!o.enabled) return;

    const mins = o.outcome_monitor_interval_minutes ?? 30;
    this.outcomeMonitorTimer = setInterval(() => {
      if (this.paused) return;
      try {
        const n = this.tradingEngine.runOutcomeBackfill();
        if (n > 0) {
          this.log("info", `Optimizer: updated ${n} snapshot outcomes`);
          this.pushTradingState();
        }
      } catch (e) {
        this.log("warn", `Outcome backfill: ${describe(e)}`);
      }
    }, mins * 60_000);

    this.optimizationScheduleTimer = setInterval(() => {
      if (this.paused || this.optimizationInFlight) return;
      const { run, dayKey } = shouldRunOptimizationSchedule(
        this.config,
        new Date(),
        this.lastOptimizationLocalDayKey,
      );
      if (!run || !this.config.trading.enabled) return;
      this.optimizationInFlight = true;
      this.lastOptimizationLocalDayKey = dayKey;
      void (async () => {
        try {
          this.log("info", "Scheduled autonomous optimization starting…");
          const result = this.tradingEngine.runAutonomousOptimization((m) => this.log("info", m));
          this.log(
            "info",
            `Optimization: ${result.status}${result.weightsUpdated ? " — config updated" : ""} — ${result.notes}`,
          );
        } catch (e) {
          this.log("error", `Optimization: ${describe(e)}`);
        } finally {
          this.optimizationInFlight = false;
          this.pushTradingState();
        }
      })();
    }, 60_000);
  }

  private scheduleTradingCycles(): void {
    this.clearTradingTimers();
    if (this.paused || !this.config.trading.enabled) {
      this.pushTradingState();
      return;
    }
    this.portfolioTimer = setInterval(() => {
      if (this.paused || this.tradingCycleInFlight) return;
      this.tradingCycleInFlight = true;
      this.update({ tradingBusy: true });
      void (async () => {
        try {
          await this.tradingEngine.runPortfolioCycle();
          await this.refreshAccount();
        } catch (e) {
          this.log("error", `Portfolio trading: ${describe(e)}`);
        } finally {
          this.tradingCycleInFlight = false;
          this.pushTradingState();
          this.update({ tradingBusy: false });
        }
      })();
    }, this.config.schedule.portfolio_cycle_seconds * 1000);

    this.candidateTimer = setInterval(() => {
      if (this.paused || this.tradingCycleInFlight) return;
      this.tradingCycleInFlight = true;
      this.update({ tradingBusy: true });
      void (async () => {
        try {
          await this.tradingEngine.runCandidateCycle();
          await this.refreshAccount();
        } catch (e) {
          this.log("error", `Candidate trading: ${describe(e)}`);
        } finally {
          this.tradingCycleInFlight = false;
          this.pushTradingState();
          this.update({ tradingBusy: false });
        }
      })();
    }, this.config.schedule.candidate_cycle_seconds * 1000);

    this.pushTradingState();
  }

  // -------------------------------------------------------------------------
  // Cycle execution
  // -------------------------------------------------------------------------

  private startPingLoop(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      void this.measurePing();
    }, PING_INTERVAL_MS);
  }

  private async measurePing(): Promise<void> {
    const start = Date.now();
    let ok = false;
    try {
      ok = await this.broker.ping();
    } catch {
      ok = false;
    }
    const elapsed = Date.now() - start;
    const wasConnected = this.state.connected;
    this.update({
      connected: ok,
      pingMs: ok ? elapsed : null,
      status: this.paused ? "paused" : ok ? "running" : "error",
    });
    if (ok && !wasConnected) this.log("info", `Broker reachable (${elapsed}ms).`);
    if (!ok && wasConnected) this.log("warn", "Broker unreachable.");
  }

  private onExitEvent(event: ExitEvent): void {
    this.log(
      "warn",
      `Exit monitor closed ${event.symbol} on ${event.reason} (pnl ${event.pnlPct.toFixed(2)}%)`,
    );
    void this.refreshAccount();
  }

  private async refreshAccount(): Promise<void> {
    try {
      const [account, positions] = await Promise.all([
        this.broker.getAccount(),
        this.broker.listPositions(),
      ]);
      const sample: EquitySample = { ts: new Date().toISOString(), equity: account.equity };
      const equityHistory = [...this.state.equityHistory, sample].slice(-EQUITY_HISTORY_MAX);
      this.update({
        account,
        positions,
        equityHistory,
        recentTradingSignals: this.tradingEngine.listRecentSignals(60),
      });
    } catch (err) {
      this.log("warn", `Account refresh failed: ${describe(err)}`);
    }
  }

  private async refreshOrders(): Promise<void> {
    try {
      const orders = await this.broker.listOrders({ limit: ORDER_HISTORY_MAX });
      this.update({ recentOrders: orders });
    } catch {
      // Non-fatal — older orders just stay shown until the next successful poll.
    }
  }

  private recomputePerformance(): void {
    const performance = computePerformance(this.state.equityHistory, this.state.recentOrders);
    this.update({ performance });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private persistSessionSnapshot(): void {
    try {
      const root = resolvePaths().root;
      writeSessionSnapshot(root, {
        endedAt: new Date().toISOString(),
        startedAt: this.state.startedAt,
      });
    } catch {
      // Ignore disk errors on exit.
    }
  }

  private log(level: LogEntry["level"], message: string): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, message };
    const logs = [entry, ...this.state.logs].slice(0, LOG_BUFFER_MAX);
    this.update({ logs });
    // Mirror to the real-time log service so the Debugging screen can stream it.
    this.logService?.push("system", level, message);
  }

  private update(patch: Partial<OrchestratorState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptyPerformance(): PerformanceMetrics {
  return {
    dailyPnlAbs: null,
    dailyPnlPct: null,
    maxDrawdownPct: null,
    sharpe: null,
    profitFactor: null,
    winRatePct: null,
    avgTradeDurationMs: null,
    closedTrades: 0,
  };
}
