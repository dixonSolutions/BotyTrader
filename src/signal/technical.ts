/**
 * Technical indicators — pure functions over arrays of closing prices.
 *
 * Kept dependency-free and side-effect-free so the same module can be reused
 * by the MCP `market` tool, the orchestrator, and any future backtester.
 */

import type { OhlcBar } from "./types.js";

/** Simple Moving Average over the last `period` values. Returns null if not enough data. */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

/** Exponential Moving Average — gives more weight to recent prices. */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const multiplier = 2 / (period + 1);
  // Start with SMA as initial EMA value
  let emaVal = sma(values.slice(0, period), period);
  if (emaVal === null) return null;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * multiplier + emaVal * (1 - multiplier);
  }
  return emaVal;
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
 * MACD (Moving Average Convergence Divergence).
 * Returns the MACD line, signal line, and histogram values.
 */
export interface MacdResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function macd(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (values.length < slowPeriod + signalPeriod) {
    return { macd: null, signal: null, histogram: null };
  }

  // Calculate EMAs for the full series
  const fastEma = calculateEmaSeries(values, fastPeriod);
  const slowEma = calculateEmaSeries(values, slowPeriod);

  if (fastEma.length === 0 || slowEma.length === 0) {
    return { macd: null, signal: null, histogram: null };
  }

  // MACD line = Fast EMA - Slow EMA (aligned to slow period)
  const macdLine: number[] = [];
  const offset = slowPeriod - fastPeriod;
  for (let i = 0; i < slowEma.length; i++) {
    if (i + offset < fastEma.length) {
      macdLine.push(fastEma[i + offset] - slowEma[i]);
    }
  }

  if (macdLine.length < signalPeriod) {
    return { macd: null, signal: null, histogram: null };
  }

  // Signal line = EMA of MACD line
  const signalLine = calculateEmaSeries(macdLine, signalPeriod);

  const currentMacd = macdLine[macdLine.length - 1];
  const currentSignal = signalLine[signalLine.length - 1] ?? null;

  return {
    macd: currentMacd,
    signal: currentSignal,
    histogram: currentSignal !== null ? currentMacd - currentSignal : null,
  };
}

/** Calculate full EMA series for MACD computation */
function calculateEmaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Start with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  result.push(ema);

  // Calculate subsequent EMAs
  for (let i = period; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
    result.push(ema);
  }

  return result;
}

/**
 * Bollinger Bands — volatility bands placed above and below a moving average.
 */
export interface BollingerResult {
  middle: number | null;
  upper: number | null;
  lower: number | null;
  bandwidth: number | null;
  percentB: number | null;
}

export function bollingerBands(
  values: number[],
  period = 20,
  stdDev = 2,
): BollingerResult {
  if (values.length < period) {
    return { middle: null, upper: null, lower: null, bandwidth: null, percentB: null };
  }

  const middle = sma(values, period);
  if (middle === null) {
    return { middle: null, upper: null, lower: null, bandwidth: null, percentB: null };
  }

  // Calculate standard deviation
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + stdDev * std;
  const lower = middle - stdDev * std;
  const bandwidth = ((upper - lower) / middle) * 100;

  // %B = (Price - Lower) / (Upper - Lower)
  const lastPrice = values[values.length - 1];
  const percentB = upper !== lower ? (lastPrice - lower) / (upper - lower) : null;

  return { middle, upper, lower, bandwidth, percentB };
}

/**
 * Stochastic Oscillator — compares closing price to price range over time.
 */
export interface StochasticResult {
  k: number | null; // %K (fast)
  d: number | null; // %D (slow/signal)
}

export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  if (highs.length < kPeriod || lows.length < kPeriod || closes.length < kPeriod) {
    return { k: null, d: null };
  }

  // Calculate %K values
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - kPeriod + 1, i + 1);
    const periodLows = lows.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...periodHighs);
    const lowest = Math.min(...periodLows);
    const close = closes[i];

    if (highest === lowest) {
      kValues.push(50); // Neutral when no range
    } else {
      kValues.push(((close - lowest) / (highest - lowest)) * 100);
    }
  }

  if (kValues.length < dPeriod) {
    return { k: kValues[kValues.length - 1] ?? null, d: null };
  }

  // Calculate %D (SMA of %K)
  const currentK = kValues[kValues.length - 1];
  const dSlice = kValues.slice(-dPeriod);
  const currentD = dSlice.reduce((a, b) => a + b, 0) / dPeriod;

  return { k: currentK, d: currentD };
}

/**
 * Average True Range (Wilder smoothing) over `period` bars.
 * Requires high/low/close — a richer signal than just closes.
 * Returns null if not enough data.
 */
export function atr(bars: OhlcBar[], period = 14): number | null {
  if (bars.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
  }
  return avg;
}

/**
 * On-Balance Volume — cumulative volume based on price direction.
 * Requires volume data alongside prices.
 */
export function obv(closes: number[], volumes: number[]): number | null {
  if (closes.length < 2 || volumes.length !== closes.length) return null;

  let obvValue = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      obvValue = volumes[i];
    } else {
      if (closes[i] > closes[i - 1]) {
        obvValue += volumes[i];
      } else if (closes[i] < closes[i - 1]) {
        obvValue -= volumes[i];
      }
      // If equal, OBV stays the same
    }
  }

  return obvValue;
}

/**
 * OBV trend confirmation — checks if OBV direction aligns with price direction.
 * Returns a score from -1 to 1 indicating divergence/convergence.
 */
export function obvTrendScore(closes: number[], volumes: number[], lookback = 10): number | null {
  if (closes.length < lookback + 1 || volumes.length !== closes.length) return null;

  const priceChange = closes[closes.length - 1] - closes[closes.length - lookback];
  const currentObv = obv(closes.slice(-lookback), volumes.slice(-lookback));
  const prevObv = obv(closes.slice(-lookback - 1, -1), volumes.slice(-lookback - 1, -1));

  if (currentObv === null || prevObv === null) return null;
  const obvChange = currentObv - prevObv;

  // Bullish: both price and OBV rising
  if (priceChange > 0 && obvChange > 0) return 1;
  // Bearish: both price and OBV falling
  if (priceChange < 0 && obvChange < 0) return -1;
  // Divergence signals weakness
  if (priceChange > 0 && obvChange < 0) return -0.5;
  if (priceChange < 0 && obvChange > 0) return 0.5;
  return 0;
}

/**
 * Fibonacci Retracement levels.
 * Calculates retracement levels based on a swing high and low.
 */
export interface FibonacciLevels {
  high: number;
  low: number;
  levels: Array<{ ratio: number; price: number }>;
}

export function calculateFibonacciLevels(
  values: number[],
  customLevels?: number[],
): FibonacciLevels | null {
  if (values.length < 2) return null;

  const high = Math.max(...values);
  const low = Math.min(...values);
  const diff = high - low;

  const defaultLevels = [0.236, 0.382, 0.5, 0.618, 0.786];
  const ratios = customLevels ?? defaultLevels;

  return {
    high,
    low,
    levels: ratios.map((ratio) => ({
      ratio,
      price: high - diff * ratio,
    })),
  };
}

/**
 * Check if price is near a Fibonacci level within threshold.
 * Returns the nearest level and its significance score.
 */
export function checkFibonacciProximity(
  currentPrice: number,
  fibonacciLevels: FibonacciLevels,
  threshold = 0.02,
): { nearLevel: number | null; score: number; isSupport: boolean } {
  let nearestDistance = Infinity;
  let nearestLevel: { ratio: number; price: number } | null = null;

  for (const level of fibonacciLevels.levels) {
    const distance = Math.abs(currentPrice - level.price) / currentPrice;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLevel = level;
    }
  }

  if (nearestLevel === null || nearestDistance > threshold) {
    return { nearLevel: null, score: 0, isSupport: false };
  }

  // Golden pocket (0.618) and 0.5 get higher scores
  const significance = nearestLevel.ratio === 0.618 ? 1.5 : nearestLevel.ratio === 0.5 ? 1.2 : 1.0;
  const proximityScore = (1 - nearestDistance / threshold) * significance;

  // Determine if acting as support (price above level) or resistance (price below)
  const isSupport = currentPrice > nearestLevel.price;

  return {
    nearLevel: nearestLevel.ratio,
    score: proximityScore,
    isSupport,
  };
}

/**
 * Ichimoku Cloud — comprehensive trend, support, and resistance indicator.
 */
export interface IchimokuResult {
  tenkanSen: number | null; // Conversion line
  kijunSen: number | null; // Base line
  senkouSpanA: number | null; // Leading span A
  senkouSpanB: number | null; // Leading span B (cloud boundary)
  chikouSpan: number | null; // Lagging span (close displaced back)
  cloudTop: number | null;
  cloudBottom: number | null;
  isAboveCloud: boolean | null;
  isBelowCloud: boolean | null;
  isInCloud: boolean | null;
}

export function ichimoku(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26,
): IchimokuResult {
  const minLength = Math.max(tenkanPeriod, kijunPeriod, senkouBPeriod) + displacement;
  if (highs.length < minLength || lows.length < minLength || closes.length < minLength) {
    return {
      tenkanSen: null,
      kijunSen: null,
      senkouSpanA: null,
      senkouSpanB: null,
      chikouSpan: null,
      cloudTop: null,
      cloudBottom: null,
      isAboveCloud: null,
      isBelowCloud: null,
      isInCloud: null,
    };
  }

  // Tenkan-sen (Conversion line): (Highest High + Lowest Low) / 2 for last tenkanPeriod
  const tenkanHigh = Math.max(...highs.slice(-tenkanPeriod));
  const tenkanLow = Math.min(...lows.slice(-tenkanPeriod));
  const tenkanSen = (tenkanHigh + tenkanLow) / 2;

  // Kijun-sen (Base line): (Highest High + Lowest Low) / 2 for last kijunPeriod
  const kijunHigh = Math.max(...highs.slice(-kijunPeriod));
  const kijunLow = Math.min(...lows.slice(-kijunPeriod));
  const kijunSen = (kijunHigh + kijunLow) / 2;

  // Senkou Span A (Leading span A): (Tenkan + Kijun) / 2, projected forward
  const senkouSpanA = (tenkanSen + kijunSen) / 2;

  // Senkou Span B (Leading span B): (Highest High + Lowest Low) / 2 for last senkouBPeriod, projected forward
  const senkouBHigh = Math.max(...highs.slice(-senkouBPeriod));
  const senkouBLow = Math.min(...lows.slice(-senkouBPeriod));
  const senkouSpanB = (senkouBHigh + senkouBLow) / 2;

  // Chikou Span (Lagging span): Current close displaced back by displacement
  const chikouSpan = closes[closes.length - 1 - displacement] ?? null;

  // Cloud boundaries
  const cloudTop = Math.max(senkouSpanA, senkouSpanB);
  const cloudBottom = Math.min(senkouSpanA, senkouSpanB);

  // Current price relative to cloud (using projected cloud values)
  const currentPrice = closes[closes.length - 1];
  const isAboveCloud = currentPrice > cloudTop;
  const isBelowCloud = currentPrice < cloudBottom;
  const isInCloud = !isAboveCloud && !isBelowCloud;

  return {
    tenkanSen,
    kijunSen,
    senkouSpanA,
    senkouSpanB,
    chikouSpan,
    cloudTop,
    cloudBottom,
    isAboveCloud,
    isBelowCloud,
    isInCloud,
  };
}

/** Human-readable RSI interpretation for the TUI. */
export function rsiSignal(value: number | null): "oversold" | "neutral" | "overbought" | "—" {
  if (value === null) return "—";
  if (value <= 30) return "oversold";
  if (value >= 70) return "overbought";
  return "neutral";
}

/**
 * Calculate volatility dampener based on ATR.
 * Returns a factor to reduce signal strength when volatility is extreme.
 */
export function calculateVolatilityDampener(
  atrValue: number,
  currentPrice: number,
  threshold = 0.05,
): number {
  const atrPercent = atrValue / currentPrice;
  if (atrPercent > threshold) {
    // High volatility — dampen signals (0.5 to 1.0 range)
    return Math.max(0.5, 1 - (atrPercent - threshold) * 2);
  }
  return 1.0;
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
    } else if (id.startsWith("ema")) {
      const period = Number(id.slice(3)) || 20;
      out[id] = ema(closes, period);
    } else if (id.startsWith("rsi")) {
      const period = Number(id.slice(3)) || 14;
      out[id] = rsi(closes, period);
    }
  }
  return out;
}
