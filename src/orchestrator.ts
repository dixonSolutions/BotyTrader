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
import type { AccountSummary, BrokerAdapter, Order, Position } from "./execution/broker.js";
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
  readonly broker: BrokerAdapter;
  readonly memory: WorkingMemoryStore;
  readonly models: ModelManager;
  readonly exitMonitor: ExitMonitor;

  private readonly ctx: ToolContext;
  private readonly listeners = new Set<StateListener>();
  private state: OrchestratorState;
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private rotationIndex = 0;
  private cycleInFlight = false;
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
    };

    this.exitMonitor.onExit((e) => this.onExitEvent(e));
  }

  // -------------------------------------------------------------------------
  // Public lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.log("info", `Starting orchestrator with broker ${this.broker.name}`);
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
    this.exitMonitor.stop();
    this.update({ status: "paused", nextScheduledCycleAt: null });
    this.log("info", "Orchestrator paused.");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.exitMonitor.start();
    this.scheduleNext();
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
        `No local model selected. Open the Models screen (m from Home) to install one.`,
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
      this.update({ account, positions, equityHistory });
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
