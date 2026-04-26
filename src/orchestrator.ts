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

import { runCycle, type AgentStep } from "./agent/loop.js";
import { submitOrder, type SubmitOrderResult } from "./actions/alpaca.js";
import { summarizeToMemory } from "./actions/memory.js";
import type { Decision } from "./actions/types.js";
import { resolvePaths, writeConfig, type Config, type Secrets } from "./config.js";
import type { TradingMode } from "./config.js";
import { createBrokerAdapter } from "./execution/adapters/index.js";
import { TradingEngine, type TradingEngineStatus } from "./trading/engine.js";
import type { SignalRow } from "./trading/types.js";
import {
  installLocalSentimentWeights,
  removeLocalSentimentArtifacts,
  SUPPORTED_SENTIMENT_REPO_ID,
  type SentimentInstallProgress,
} from "./trading/sentiment/finbert.js";
import type { AccountSummary, BrokerAdapter, NewsItem, Order, Position } from "./execution/broker.js";
import { ExitMonitor, type ExitEvent } from "./execution/exit_monitor.js";
import type { WorkingMemoryStore } from "./memory/disabled_store.js";
import { MemoryStore } from "./memory/store.js";
import type { ModelManager } from "./llm/model_manager.js";
import type { ToolContext } from "./mcp/tools/index.js";
import {
  computePerformance,
  type EquitySample,
  type PerformanceMetrics,
} from "./metrics.js";
import {
  clipReasoning,
  readSessionSnapshot,
  writeSessionSnapshot,
} from "./runtime/session_snapshot.js";
import type { PreviousSessionSummary } from "./runtime/session_snapshot.js";

export type { PreviousSessionSummary } from "./runtime/session_snapshot.js";

/** Live agent step surfaced to the TUI while a cycle is in flight. */
export interface AgentLiveState {
  symbol: string;
  phase: string;
  detail?: string;
}

export interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "agent";
  message: string;
}

export interface CycleRecord {
  ts: string;
  symbol: string;
  decision: Decision;
  submission?: SubmitOrderResult;
}

export type BotStatus = "running" | "paused" | "error";

export interface OrchestratorState {
  brokerName: string;
  connected: boolean;
  cycling: boolean;
  status: BotStatus;
  startedAt: string;
  lastCycleAt: string | null;
  pingMs: number | null;
  agentIntervalSeconds: number;
  account: AccountSummary | null;
  positions: Position[];
  recentCycles: CycleRecord[];
  logs: LogEntry[];
  watchlist: string[];
  autotrade: boolean;
  equityHistory: EquitySample[];
  recentOrders: Order[];
  performance: PerformanceMetrics;
  /** Summary written when the app last exited cleanly (see `session_snapshot.ts`). */
  previousSession: PreviousSessionSummary | null;
  /** ISO time when the next automatic cycle is scheduled (null if paused or not yet armed). */
  nextScheduledCycleAt: string | null;
  /** Non-null while the LLM loop is progressing for a symbol. */
  agentLive: AgentLiveState | null;
  /** Reasoning text from the most recently completed cycle (cleared on new cycle start). */
  lastCompletedReasoning: string | null;
  /** Deterministic simple-strategy engine status (FinBERT, DB, Alpaca). */
  trading: TradingEngineStatus;
  /** True while a trading engine cycle (portfolio/candidate) is in flight. */
  tradingBusy: boolean;
  portfolioCycleSeconds: number;
  candidateCycleSeconds: number;
  discoveryCycleSeconds: number;
  tradingMode: TradingMode;
  /** Latest rows from `signals` table (simple strategy audit). */
  recentTradingSignals: SignalRow[];
}

export type StateListener = (state: OrchestratorState) => void;

const LOG_BUFFER_MAX = 500;
const CYCLE_BUFFER_MAX = 50;
const EQUITY_HISTORY_MAX = 1024;
const ORDER_HISTORY_MAX = 200;
const PING_INTERVAL_MS = 15_000;

export interface OrchestratorOptions {
  config: Config;
  secrets: Secrets;
  broker: BrokerAdapter;
  memory: WorkingMemoryStore;
  models: ModelManager;
}

export class Orchestrator {
  readonly config: Config;
  readonly secrets: Secrets;
  /** Swapped at runtime when paper/live (Alpaca) changes — do not hold stale references. */
  broker: BrokerAdapter;
  readonly memory: WorkingMemoryStore;
  readonly models: ModelManager;
  exitMonitor: ExitMonitor;
  readonly tradingEngine: TradingEngine;

  private ctx: ToolContext;
  private readonly listeners = new Set<StateListener>();
  private state: OrchestratorState;
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private portfolioTimer: NodeJS.Timeout | null = null;
  private candidateTimer: NodeJS.Timeout | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private rotationIndex = 0;
  private cycleInFlight = false;
  private tradingCycleInFlight = false;
  private paused = false;
  /** Completed agent cycles this process (used for session snapshot on stop). */
  private sessionCycleCount = 0;

  constructor(opts: OrchestratorOptions) {
    this.config = opts.config;
    this.secrets = opts.secrets;
    this.broker = opts.broker;
    this.memory = opts.memory;
    this.models = opts.models;
    this.ctx = { broker: opts.broker, secrets: opts.secrets };
    this.exitMonitor = new ExitMonitor(opts.broker, opts.config);
    this.tradingEngine = new TradingEngine(opts.config, opts.secrets, opts.broker);

    const paths = resolvePaths();
    this.state = {
      brokerName: this.broker.name,
      connected: false,
      cycling: false,
      status: "running",
      startedAt: new Date().toISOString(),
      lastCycleAt: null,
      pingMs: null,
      agentIntervalSeconds: this.config.schedule.agent_interval_seconds,
      account: null,
      positions: [],
      recentCycles: [],
      logs: [],
      watchlist: [...this.config.watchlist.symbols],
      autotrade: this.config.autotrade.enabled,
      equityHistory: [],
      recentOrders: [],
      performance: emptyPerformance(),
      previousSession: readSessionSnapshot(paths.root),
      nextScheduledCycleAt: null,
      agentLive: null,
      lastCompletedReasoning: null,
      trading: this.tradingEngine.getStatus(),
      tradingBusy: false,
      portfolioCycleSeconds: this.config.schedule.portfolio_cycle_seconds,
      candidateCycleSeconds: this.config.schedule.candidate_cycle_seconds,
      discoveryCycleSeconds: this.config.schedule.discovery_cycle_seconds,
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

    if (this.config.features.memory_enabled) {
      await this.memory.sync().catch((err) => {
        this.log("warn", `Memory sync failed: ${describe(err)}`);
      });
    }
    await this.refreshAccount();
    await this.refreshOrders();

    this.exitMonitor.start();
    this.startPingLoop();
    this.scheduleNext();
    this.scheduleTradingCycles();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearTradingTimers();
    this.tradingEngine.close();
    this.exitMonitor.stop();
    this.persistSessionSnapshot();
    this.update({ cycling: false, nextScheduledCycleAt: null, agentLive: null });
    this.log("info", "Orchestrator stopped.");
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearTradingTimers();
    this.exitMonitor.stop();
    this.update({ status: "paused", nextScheduledCycleAt: null });
    this.log("info", "Orchestrator paused.");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.exitMonitor.start();
    this.scheduleNext();
    this.scheduleTradingCycles();
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

  /** Trigger a cycle for the next watchlist symbol immediately. */
  async runNow(symbol?: string): Promise<void> {
    const target = symbol ?? this.nextSymbol();
    if (!target) {
      this.log("warn", "Watchlist is empty.");
      return;
    }
    await this.runCycleFor(target);
  }

  setAutotrade(enabled: boolean): void {
    this.config.autotrade.enabled = enabled;
    writeConfig(this.config);
    this.update({ autotrade: enabled });
    this.log("info", `Autotrade ${enabled ? "enabled" : "disabled"}`);
  }

  setMemoryEnabled(enabled: boolean): void {
    this.config.features.memory_enabled = enabled;
    writeConfig(this.config);
    if (enabled) {
      this.log(
        "info",
        "Memory enabled — restart BotyTrader once if you started with memory off so the Gemini embedder attaches correctly.",
      );
    } else {
      this.log("info", "Memory disabled — RAG search and memory writes are skipped (keys stay in .env).");
    }
  }

  setWebSearchEnabled(enabled: boolean): void {
    this.config.features.web_search_enabled = enabled;
    writeConfig(this.config);
    if (enabled && !this.secrets.BRAVE_API_KEY?.trim()) {
      this.log("warn", "Web search enabled but BRAVE_API_KEY is empty — set it in .env to use brave_web_search.");
    } else {
      this.log("info", `Web search ${enabled ? "enabled" : "disabled"} (keys stay in .env).`);
    }
  }

  /**
   * Persist `agent.sentiment_weight` (0 = technical-heavy, 1 = sentiment-heavy).
   * Used from Config → Models (agent blend ±).
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
    this.config.watchlist.symbols = unique;
    this.rotationIndex = 0;
    this.update({ watchlist: unique });
    this.log("info", `Watchlist updated: ${unique.join(", ") || "(empty)"}`);
  }

  /** Update the cycle interval and reschedule immediately. Persists to config.toml. */
  setAgentInterval(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 1) {
      this.log("warn", `Ignoring invalid agent interval: ${seconds}`);
      return;
    }
    const rounded = Math.floor(seconds);
    this.config.schedule.agent_interval_seconds = rounded;
    this.update({ agentIntervalSeconds: rounded });
    if (!this.paused) this.scheduleNext();
    writeConfig(this.config);
    this.log("info", `Agent interval set to ${rounded}s.`);
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
      this.ctx = { broker: next, secrets: this.secrets };
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

  setTradingDatabasePath(p: string): void {
    this.config.trading.database_path = p.trim();
    writeConfig(this.config);
    this.tradingEngine.close();
    this.tradingEngine.refreshReadiness();
    this.pushTradingState();
  }

  setSentimentConfig(patch: { provider: Config["sentiment"]["provider"]; modelId?: string; cacheTtlHours?: number }): void {
    const prevP = this.config.sentiment.provider;
    const prevM = this.config.sentiment.model_id;
    this.config.sentiment.provider = patch.provider;
    if (patch.modelId != null) this.config.sentiment.model_id = patch.modelId.trim();
    if (patch.cacheTtlHours != null && Number.isFinite(patch.cacheTtlHours) && patch.cacheTtlHours > 0) {
      this.config.sentiment.cache_ttl_hours = patch.cacheTtlHours;
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
   * Pull FinBERT classification files into the local cache, then set
   * `local_finbert` + official repo id and warm. Use when the engine reports
   * sentiment not ready under local FinBERT.
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
    this.config.sentiment.provider = "local_finbert";
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

  setTradingCycleInterval(
    field: "portfolio" | "candidate" | "discovery",
    seconds: number,
  ): void {
    if (!Number.isFinite(seconds) || seconds < 1) return;
    const s = Math.floor(seconds);
    if (field === "portfolio") {
      this.config.schedule.portfolio_cycle_seconds = s;
      this.update({ portfolioCycleSeconds: s });
    } else if (field === "candidate") {
      this.config.schedule.candidate_cycle_seconds = s;
      this.update({ candidateCycleSeconds: s });
    } else {
      this.config.schedule.discovery_cycle_seconds = s;
      this.update({ discoveryCycleSeconds: s });
    }
    writeConfig(this.config);
    if (!this.paused) {
      this.clearTradingTimers();
      this.scheduleTradingCycles();
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
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
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

    this.discoveryTimer = setInterval(() => {
      if (this.paused) return;
      void (async () => {
        try {
          await this.tradingEngine.runDiscoveryCycle();
        } catch (e) {
          this.log("error", `Discovery: ${describe(e)}`);
        } finally {
          this.pushTradingState();
        }
      })();
    }, this.config.schedule.discovery_cycle_seconds * 1000);

    this.pushTradingState();
  }

  // -------------------------------------------------------------------------
  // Cycle execution
  // -------------------------------------------------------------------------

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.paused) {
      this.update({ nextScheduledCycleAt: null });
      return;
    }
    const intervalMs = this.config.schedule.agent_interval_seconds * 1000;
    const nextAt = new Date(Date.now() + intervalMs).toISOString();
    this.update({ nextScheduledCycleAt: nextAt });
    this.timer = setTimeout(() => {
      const symbol = this.nextSymbol();
      if (symbol) {
        void this.runCycleFor(symbol).finally(() => this.scheduleNext());
      } else {
        this.scheduleNext();
      }
    }, intervalMs);
  }

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

  private nextSymbol(): string | null {
    const list = this.config.watchlist.symbols;
    if (list.length === 0) return null;
    const symbol = list[this.rotationIndex % list.length];
    this.rotationIndex++;
    return symbol;
  }

  private async runCycleFor(symbol: string): Promise<void> {
    if (this.cycleInFlight) {
      this.log("warn", `Skipping cycle for ${symbol} — previous cycle still running.`);
      return;
    }
    if (!this.models.activeId) {
      this.log(
        "warn",
        `No reasoning model selected. Set Config → Settings → Active local model, or [model] id in config.toml (and HF Inference API + id if using remote).`,
      );
      return;
    }
    this.cycleInFlight = true;
    this.update({
      cycling: true,
      nextScheduledCycleAt: null,
      agentLive: { symbol, phase: "Starting", detail: "Invoking LLM and tools…" },
      lastCompletedReasoning: null,
    });
    const startedAt = new Date().toISOString();
    this.log("info", `Cycle start: ${symbol}`);

    try {
      const result = await runCycle({
        symbol,
        config: this.config,
        secrets: this.secrets,
        ctx: this.ctx,
        memory: this.memory,
        onStep: (step) => this.handleAgentStep(symbol, step),
      });

      let submission: SubmitOrderResult | undefined;
      try {
        submission = await submitOrder(result.decision, this.config, this.broker);
        if (submission.submitted && submission.order) {
          const o = submission.order;
          this.log(
            "info",
            `Order placed ${o.symbol} ${o.side} qty=${o.qty} status=${o.status} id=${o.id} (Alpaca may fill after this response — positions refresh shortly)`,
          );
          // POST /orders often returns before the position exists; brief wait so the TUI matches Alpaca.
          await sleepMs(750);
          await this.refreshAccount();
        } else if (submission.submitted) {
          this.log("info", "Order submitted (broker returned no order body).");
        } else {
          this.log("info", `No order submitted: ${submission.reason}`);
        }
      } catch (err) {
        this.log("error", `submitOrder failed: ${describe(err)}`);
      }

      if (this.config.features.memory_enabled && this.memory instanceof MemoryStore) {
        try {
          await summarizeToMemory(
            {
              symbol,
              decision: result.decision,
              toolCalls: result.toolCalls,
              startedAt,
              finishedAt: new Date().toISOString(),
            },
            this.memory,
          );
        } catch (err) {
          this.log("warn", `Memory write failed: ${describe(err)}`);
        }
      }

      const record: CycleRecord = { ts: new Date().toISOString(), symbol, decision: result.decision, submission };
      this.update({
        lastCycleAt: record.ts,
        recentCycles: [record, ...this.state.recentCycles].slice(0, CYCLE_BUFFER_MAX),
        lastCompletedReasoning: result.decision.reasoning,
      });
      await this.refreshAccount();
      await this.refreshOrders();
      this.recomputePerformance();
    } catch (err) {
      this.log("error", `Cycle failed for ${symbol}: ${describe(err)}`);
    } finally {
      this.sessionCycleCount += 1;
      this.cycleInFlight = false;
      this.update({ cycling: false, agentLive: null });
    }
  }

  private handleAgentStep(symbol: string, step: AgentStep): void {
    switch (step.kind) {
      case "rag":
        this.update({
          agentLive: { symbol, phase: "RAG", detail: `${step.hits} memory snippets` },
        });
        this.log("agent", `[${symbol}] RAG injected ${step.hits} memories`);
        break;
      case "tool_call":
        this.update({
          agentLive: { symbol, phase: "Tool call", detail: step.name },
        });
        this.log("agent", `[${symbol}] tool: ${step.name}`);
        break;
      case "tool_result":
        this.update({
          agentLive: {
            symbol,
            phase: "Tool result",
            detail: `${step.name} ${step.ok ? "ok" : "failed"}`,
          },
        });
        if (!step.ok) this.log("warn", `[${symbol}] tool failed: ${step.name}`);
        break;
      case "decision": {
        const r = clipReasoning(step.decision.reasoning, 160);
        this.update({
          agentLive: {
            symbol,
            phase: "Decision",
            detail: `${step.decision.action} qty=${step.decision.qty} conf=${step.decision.confidence.toFixed(2)}${r ? ` · ${r}` : ""}`,
          },
        });
        this.log("agent", `[${symbol}] decision: ${step.decision.action} qty=${step.decision.qty} conf=${step.decision.confidence}`);
        break;
      }
      case "model_response":
        this.update({
          agentLive: { symbol, phase: "Model", detail: "Reading model output…" },
        });
        break;
    }
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
      const last = this.state.recentCycles[0];
      writeSessionSnapshot(root, {
        endedAt: new Date().toISOString(),
        startedAt: this.state.startedAt,
        cyclesCompleted: this.sessionCycleCount,
        lastSymbol: last?.symbol ?? null,
        lastAction: last?.decision.action ?? null,
        lastReasoningSnippet: clipReasoning(last?.decision.reasoning ?? null),
      });
    } catch {
      // Ignore disk errors on exit.
    }
  }

  private log(level: LogEntry["level"], message: string): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, message };
    const logs = [entry, ...this.state.logs].slice(0, LOG_BUFFER_MAX);
    this.update({ logs });
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
