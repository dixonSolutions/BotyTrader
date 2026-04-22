/**
 * Technical indicators — pure functions over arrays of closing prices.
 *
 * Kept dependency-free and side-effect-free so the same module can be reused
 * by the MCP `market` tool, the orchestrator, and any future backtester.
 */

/** Simple Moving Average over the last `period` values. Returns null if not enough data. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

/**
 * Relative Strength Index (Wilder smoothing) over `period` (default 14).
 * Returns null if not enough data points.
 */
export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (Wilder smoothing) over `period` bars.
 * Requires high/low/close — a richer signal than just closes.
 * Returns null if not enough data.
 */
export interface OhlcBar {
  h: number;
  l: number;
  c: number;
}

export function atr(bars: OhlcBar[], period = 14): number | null {
  if (bars.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
  }
  return avg;
}

/** Human-readable RSI interpretation for the TUI. */
export function rsiSignal(value: number | null): "oversold" | "neutral" | "overbought" | "—" {
  if (value === null) return "—";
  if (value <= 30) return "oversold";
  if (value >= 70) return "overbought";
  return "neutral";
}

/** Convenience helper — returns the indicator values requested. */
export function computeIndicators(
  closes: number[],
  indicators: string[] = ["sma20", "rsi14"],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const id of indicators) {
    if (id.startsWith("sma")) {
      const period = Number(id.slice(3)) || 20;
      out[id] = sma(closes, period);
    } else if (id.startsWith("rsi")) {
      const period = Number(id.slice(3)) || 14;
      out[id] = rsi(closes, period);
    }
  }
  return out;
}
