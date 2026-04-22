/**
 * Performance metrics — pure functions over equity snapshots and order history.
 *
 * Kept side-effect-free so the same calculators serve both the live TUI and
 * any future backtest CLI. All metrics gracefully return `null` when there is
 * not enough data instead of producing misleading zeros.
 */

import type { Order } from "./execution/broker.js";

export interface EquitySample {
  ts: string;
  equity: number;
}

export interface ClosedTrade {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  durationMs: number;
}

export interface PerformanceMetrics {
  dailyPnlAbs: number | null;
  dailyPnlPct: number | null;
  maxDrawdownPct: number | null;
  sharpe: number | null;
  profitFactor: number | null;
  winRatePct: number | null;
  avgTradeDurationMs: number | null;
  closedTrades: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Daily PnL — equity now minus equity 24h ago (or earliest sample). */
export function computeDailyPnl(samples: EquitySample[]): {
  abs: number | null;
  pct: number | null;
} {
  if (samples.length === 0) return { abs: null, pct: null };
  const latest = samples[samples.length - 1];
  const cutoff = new Date(latest.ts).getTime() - DAY_MS;
  const baseline = [...samples].reverse().find((s) => new Date(s.ts).getTime() <= cutoff)
    ?? samples[0];
  if (baseline === latest) return { abs: 0, pct: 0 };
  const abs = latest.equity - baseline.equity;
  const pct = baseline.equity === 0 ? null : (abs / baseline.equity) * 100;
  return { abs, pct };
}

/** Maximum peak-to-trough decline as a percentage. */
export function computeMaxDrawdown(samples: EquitySample[]): number | null {
  if (samples.length < 2) return null;
  let peak = samples[0].equity;
  let maxDd = 0;
  for (const s of samples) {
    if (s.equity > peak) peak = s.equity;
    if (peak > 0) {
      const dd = (peak - s.equity) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd * 100;
}

/**
 * Annualised Sharpe ratio over the equity series.
 * Uses arithmetic returns and assumes equally-spaced samples (orchestrator
 * snapshots after each cycle). Risk-free rate assumed zero.
 */
export function computeSharpe(samples: EquitySample[]): number | null {
  if (samples.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].equity;
    if (prev === 0) continue;
    returns.push((samples[i].equity - prev) / prev);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  // Annualise assuming ~252 trading periods per year — a reasonable default
  // when interval is in minutes/hours; user-facing label says "Sharpe (ann.)".
  return (mean / std) * Math.sqrt(252);
}

/**
 * Reconstruct closed trades by FIFO-matching opposite-side filled orders per
 * symbol. This is best-effort but accurate when the bot only opens/closes
 * full positions (the default decision shape: buy → sell, or sell → buy).
 */
export function reconstructClosedTrades(orders: Order[]): ClosedTrade[] {
  const filled = orders
    .filter((o) => o.filledQty > 0 && o.filledAvgPrice !== undefined)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  const queues = new Map<string, { side: "buy" | "sell"; qty: number; price: number; ts: string }[]>();
  const trades: ClosedTrade[] = [];

  for (const order of filled) {
    const queue = queues.get(order.symbol) ?? [];
    let remaining = order.filledQty;
    while (remaining > 0 && queue.length > 0 && queue[0].side !== order.side) {
      const head = queue[0];
      const matched = Math.min(head.qty, remaining);
      const isLong = head.side === "buy";
      const entry = head.price;
      const exit = order.filledAvgPrice!;
      const pnl = (isLong ? exit - entry : entry - exit) * matched;
      const openedAt = head.ts;
      const closedAt = order.submittedAt;
      trades.push({
        symbol: order.symbol,
        side: isLong ? "long" : "short",
        qty: matched,
        entryPrice: entry,
        exitPrice: exit,
        pnl,
        openedAt,
        closedAt,
        durationMs: new Date(closedAt).getTime() - new Date(openedAt).getTime(),
      });
      head.qty -= matched;
      remaining -= matched;
      if (head.qty === 0) queue.shift();
    }
    if (remaining > 0) {
      queue.push({
        side: order.side,
        qty: remaining,
        price: order.filledAvgPrice!,
        ts: order.submittedAt,
      });
    }
    queues.set(order.symbol, queue);
  }
  return trades;
}

export function computeTradeStats(trades: ClosedTrade[]): {
  profitFactor: number | null;
  winRatePct: number | null;
  avgDurationMs: number | null;
} {
  if (trades.length === 0) {
    return { profitFactor: null, winRatePct: null, avgDurationMs: null };
  }
  let gross = 0;
  let loss = 0;
  let wins = 0;
  let totalDuration = 0;
  for (const t of trades) {
    if (t.pnl >= 0) {
      gross += t.pnl;
      wins++;
    } else {
      loss += -t.pnl;
    }
    totalDuration += t.durationMs;
  }
  const profitFactor = loss === 0 ? (gross > 0 ? Infinity : null) : gross / loss;
  const winRatePct = (wins / trades.length) * 100;
  const avgDurationMs = totalDuration / trades.length;
  return { profitFactor, winRatePct, avgDurationMs };
}

export function computePerformance(
  samples: EquitySample[],
  orders: Order[],
): PerformanceMetrics {
  const { abs, pct } = computeDailyPnl(samples);
  const trades = reconstructClosedTrades(orders);
  const { profitFactor, winRatePct, avgDurationMs } = computeTradeStats(trades);
  return {
    dailyPnlAbs: abs,
    dailyPnlPct: pct,
    maxDrawdownPct: computeMaxDrawdown(samples),
    sharpe: computeSharpe(samples),
    profitFactor,
    winRatePct,
    avgTradeDurationMs: avgDurationMs,
    closedTrades: trades.length,
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}
