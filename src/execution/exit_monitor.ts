/**
 * Exit monitor — deterministic stop-loss / take-profit loop.
 *
 * Runs independently of the LLM: scans open positions on a fixed interval,
 * compares unrealised PnL against `risk.stop_loss_pct` / `risk.take_profit_pct`
 * from config.toml, and submits a market close via the broker adapter when
 * either threshold is breached.
 *
 * Hard stops are intentionally NOT routed through the agent: latency and
 * model variance make that unsafe (see docs/broker-adapters.md "Exit monitor").
 */

import type { BrokerAdapter } from "./broker.js";
import type { Config } from "../config.js";

export interface ExitEvent {
  symbol: string;
  reason: "stop_loss" | "take_profit";
  pnlPct: number;
  qty: number;
}

export type ExitListener = (event: ExitEvent) => void;

export class ExitMonitor {
  private readonly broker: BrokerAdapter;
  private readonly config: Config;
  private readonly listeners = new Set<ExitListener>();
  private timer: NodeJS.Timeout | null = null;

  constructor(broker: BrokerAdapter, config: Config) {
    this.broker = broker;
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.config.schedule.exit_monitor_interval_seconds * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onExit(listener: ExitListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Single sweep — exposed for manual triggering from the TUI. */
  async tick(): Promise<void> {
    if (!this.config.autotrade.enabled) return;

    let positions;
    try {
      positions = await this.broker.listPositions();
    } catch {
      // Network blips are non-fatal; the next tick retries.
      return;
    }

    const stopLoss = this.config.risk.stop_loss_pct;
    const takeProfit = this.config.risk.take_profit_pct;

    for (const pos of positions) {
      const cost = pos.avgEntryPrice * pos.qty;
      if (cost === 0) continue;
      const pnlPct = (pos.unrealizedPnl / Math.abs(cost)) * 100;

      let reason: ExitEvent["reason"] | null = null;
      if (pnlPct <= -Math.abs(stopLoss)) reason = "stop_loss";
      else if (pnlPct >= Math.abs(takeProfit)) reason = "take_profit";
      if (!reason) continue;

      try {
        await this.broker.submitOrder({
          symbol: pos.symbol,
          side: pos.qty > 0 ? "sell" : "buy",
          qty: Math.abs(pos.qty),
          type: "market",
          timeInForce: "day",
        });
        const event: ExitEvent = { symbol: pos.symbol, reason, pnlPct, qty: pos.qty };
        for (const listener of this.listeners) listener(event);
      } catch {
        // Surfacing errors is the orchestrator's job via the agent log; the
        // monitor itself stays quiet so a single failure doesn't spam logs.
      }
    }
  }
}
