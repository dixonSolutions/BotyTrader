/**
 * Professional Technical Score Calculator — 10 Indicators
 *
 * Combines 10 industry-standard technical indicators into a weighted composite
 * score ranging from -1 (strong sell) to +1 (strong buy).
 *
 * Indicators and Weights (per user specification):
 * ┌────┬───────────────────┬────────┬────────────┬──────────────────────────────────────────────┐
 * │ #  │ Indicator         │ Weight │ Category   │ Score Logic for "Buy"                        │
 * ├────┼───────────────────┼────────┼────────────┼──────────────────────────────────────────────┤
 * │ 1  │ SMA               │ 15%    │ Trend      │ Price > SMA (Long-term trend is up)          │
 * │ 2  │ EMA               │ 10%    │ Trend      │ Short EMA > Long EMA (Golden Cross)            │
 * │ 3  │ RSI               │ 12%    │ Momentum   │ RSI < 30 (Oversold) or RSI crossing above 50 │
 * │ 4  │ MACD              │ 10%    │ Momentum   │ MACD line crosses above Signal line          │
 * │ 5  │ Bollinger Bands   │ 8%     │ Volatility │ Price touches Lower Band + bounces           │
 * │ 6  │ Stochastic        │ 8%     │ Momentum   │ %K line crosses above %D line below 20       │
 * │ 7  │ ATR               │ 5%     │ Risk/Vol   │ Lower weight; used to "dampen" other scores  │
 * │ 8  │ OBV               │ 12%    │ Volume     │ OBV trending up while price is stable/up     │
 * │ 9  │ Fibonacci         │ 10%    │ Support    │ Price within 2% of 0.618 "Golden Pocket"     │
 * │ 10 │ Ichimoku          │ 10%    │ Complex    │ Price is above the "Kumo Cloud"              │
 * └────┴───────────────────┴────────┴────────────┴──────────────────────────────────────────────┘
 *
 * All formulas follow industry standards:
 * - SMA: Simple arithmetic mean
 * - EMA: Exponential smoothing with multiplier = 2/(period+1)
 * - RSI: Wilder smoothing method (industry standard)
 * - MACD: EMA(12) - EMA(26), Signal = EMA(9) of MACD line
 * - Bollinger: SMA ± (2 × σ) using population standard deviation
 * - Stochastic: %K = (Close - Low) / (High - Low) × 100
 * - ATR: Wilder smoothing of True Range (max of high-low, |high-prevClose|, |low-prevClose|)
 * - OBV: Cumulative volume with +/- based on price direction
 * - Fibonacci: 0.236, 0.382, 0.5, 0.618, 0.786 retracement levels
 * - Ichimoku: Tenkan-sen, Kijun-sen, Senkou spans per Japanese standard
 */

import type { Config } from "../config.js";
import type { OhlcBar } from "./types.js";
import {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  stochastic,
  atr,
  obv,
  obvTrendScore,
  calculateFibonacciLevels,
  checkFibonacciProximity,
  ichimoku,
  calculateVolatilityDampener,
  type MacdResult,
  type BollingerResult,
  type StochasticResult,
  type FibonacciLevels,
  type IchimokuResult,
} from "./technical.js";

/** Input data for technical score calculation */
export interface TechnicalScoreInput {
  /** OHLCV bars (oldest to newest) - need sufficient history for all indicators */
  bars: OhlcBar[];
  /** Optional pre-computed indicators (for caching/optimization) */
  precomputed?: Partial<IndicatorValues>;
}

/** Individual indicator values and their contributions */
export interface IndicatorValues {
  // Price data
  currentPrice: number;

  // Trend indicators
  sma: { value: number | null; score: number; weight: number };
  ema: { fast: number | null; slow: number | null; score: number; weight: number };

  // Momentum indicators
  rsi: { value: number | null; score: number; weight: number };
  macd: { macd: number | null; signal: number | null; histogram: number | null; score: number; weight: number };
  stochastic: { k: number | null; d: number | null; score: number; weight: number };

  // Volatility indicators
  bollinger: {
    middle: number | null;
    upper: number | null;
    lower: number | null;
    percentB: number | null;
    score: number;
    weight: number;
  };
  atr: { value: number | null; percent: number | null; dampener: number; weight: number };

  // Volume indicators
  obv: { value: number | null; trend: number | null; score: number; weight: number };

  // Support/Resistance indicators
  fibonacci: { nearLevel: number | null; score: number; isSupport: boolean; weight: number };
  ichimoku: {
    tenkanSen: number | null;
    kijunSen: number | null;
    senkouSpanA: number | null;
    senkouSpanB: number | null;
    cloudTop: number | null;
    cloudBottom: number | null;
    isAboveCloud: boolean | null;
    isBelowCloud: boolean | null;
    isInCloud: boolean | null;
    score: number;
    weight: number;
  };
}

/** Result of technical score calculation */
export interface TechnicalScoreResult {
  /** Final composite score from -1 (strong sell) to +1 (strong buy) */
  score: number;
  /** Score before ATR dampening applied */
  rawScore: number;
  /** Volatility dampener factor (0.5 to 1.0) */
  volatilityDampener: number;
  /** Individual indicator breakdown */
  indicators: IndicatorValues;
  /** Signal interpretation */
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /** Confidence level based on indicator agreement */
  confidence: number;
  /** Human-readable summary of active signals */
  summary: string[];
}

/** Default weights matching user specification */
export const DEFAULT_INDICATOR_WEIGHTS = {
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
} as const;

/** Category weights sum */
export const WEIGHT_SUM = Object.values(DEFAULT_INDICATOR_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Calculate SMA score component.
 * Logic: Price > SMA = Bullish (+1), Price < SMA = Bearish (-1)
 * Uses configurable SMA period from config.
 */
function calculateSmaScore(
  closes: number[],
  currentPrice: number,
  period: number,
): { value: number | null; score: number } {
  const value = sma(closes, period);
  if (value === null) return { value: null, score: 0 };

  // Score: +1 if price above SMA, -1 if below (with normalization)
  const diff = (currentPrice - value) / value;
  const score = Math.max(-1, Math.min(1, diff * 10)); // Scale: 10% diff = full score

  return { value, score };
}

/**
 * Calculate EMA score component (Golden/Death Cross).
 * Logic: Short EMA > Long EMA = Bullish, Short < Long = Bearish
 */
function calculateEmaScore(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
): { fast: number | null; slow: number | null; score: number } {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  if (fast === null || slow === null) {
    return { fast, slow, score: 0 };
  }

  // Golden Cross (fast > slow) = +1, Death Cross = -1
  const diff = (fast - slow) / slow;
  const score = Math.max(-1, Math.min(1, diff * 20)); // Scale: 5% diff = full score

  return { fast, slow, score };
}

/**
 * Calculate RSI score component.
 * Logic:
 *   - RSI < 30 (oversold) = Strong buy signal (+1)
 *   - RSI > 70 (overbought) = Strong sell signal (-1)
 *   - RSI crossing 50 = Directional bias
 *   - Mean reversion: linear interpolation between extremes
 */
function calculateRsiScore(
  closes: number[],
  period: number,
  oversold: number,
  overbought: number,
): { value: number | null; score: number } {
  const value = rsi(closes, period);
  if (value === null) return { value: null, score: 0 };

  let score: number;

  if (value <= oversold) {
    // Oversold = bullish (buy opportunity)
    score = 1;
  } else if (value >= overbought) {
    // Overbought = bearish (sell opportunity)
    score = -1;
  } else if (value < 50) {
    // Between oversold and 50: linear from +1 to 0
    score = (50 - value) / (50 - oversold);
  } else {
    // Between 50 and overbought: linear from 0 to -1
    score = -(value - 50) / (overbought - 50);
  }

  return { value, score };
}

/**
 * Calculate MACD score component.
 * Logic:
 *   - MACD line crosses above Signal = Bullish momentum (+1)
 *   - MACD line crosses below Signal = Bearish momentum (-1)
 *   - Histogram strength adds conviction
 */
function calculateMacdScore(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): MacdResult & { score: number } {
  const result = macd(closes, fastPeriod, slowPeriod, signalPeriod);

  if (result.macd === null || result.signal === null) {
    return { ...result, score: 0 };
  }

  // Base score from MACD vs Signal line position
  const diff = result.macd - result.signal;
  const avgPrice = closes[closes.length - 1];
  const normalizedDiff = diff / avgPrice;

  // Score: +1 when MACD > Signal, -1 when MACD < Signal
  // Scale: 1% difference = full score saturation
  let score = Math.max(-1, Math.min(1, normalizedDiff * 100));

  // Boost score when histogram confirms direction
  if (result.histogram !== null) {
    const histBoost = Math.abs(result.histogram) / avgPrice * 50;
    if (result.histogram > 0 && score > 0) {
      score = Math.min(1, score + histBoost);
    } else if (result.histogram < 0 && score < 0) {
      score = Math.max(-1, score - histBoost);
    }
  }

  return { ...result, score };
}

/**
 * Calculate Bollinger Bands score component.
 * Logic:
 *   - Price at/below lower band = Potential buy (+1)
 *   - Price at/above upper band = Potential sell (-1)
 *   - %B indicator for precise positioning
 */
function calculateBollingerScore(
  closes: number[],
  period: number,
  stdDev: number,
): BollingerResult & { score: number } {
  const result = bollingerBands(closes, period, stdDev);

  if (result.percentB === null) {
    return { ...result, score: 0 };
  }

  // %B ranges from 0 (at lower band) to 1 (at upper band)
  // Transform: 0 -> +1 (buy at bottom), 0.5 -> 0 (neutral at middle), 1 -> -1 (sell at top)
  const score = (0.5 - result.percentB) * 2;

  // Clamp to [-1, 1]
  return { ...result, score: Math.max(-1, Math.min(1, score)) };
}

/**
 * Calculate Stochastic Oscillator score component.
 * Logic:
 *   - %K crosses above %D below 20 = Strong buy signal
 *   - %K crosses below %D above 80 = Strong sell signal
 *   - Values in between scaled proportionally
 */
function calculateStochasticScore(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number,
  dPeriod: number,
  oversold: number,
  overbought: number,
): StochasticResult & { score: number } {
  const result = stochastic(highs, lows, closes, kPeriod, dPeriod);

  if (result.k === null || result.d === null) {
    return { ...result, score: 0 };
  }

  let score: number;

  // Bullish: %K crosses above %D in oversold territory
  if (result.k > result.d && result.k < oversold + 20) {
    score = 1;
  }
  // Bearish: %K crosses below %D in overbought territory
  else if (result.k < result.d && result.k > overbought - 20) {
    score = -1;
  }
  // Score based on position and cross
  else {
    const crossComponent = (result.k - result.d) / 100; // -0.01 to +0.01 typically
    const levelComponent = (50 - result.k) / 50; // +1 at 0, -1 at 100
    score = Math.max(-1, Math.min(1, levelComponent + crossComponent * 5));
  }

  return { ...result, score };
}

/**
 * Calculate ATR (Average True Range) component.
 * Not directly scored, but used to dampen other scores during high volatility.
 */
function calculateAtrComponent(
  bars: OhlcBar[],
  period: number,
  highVolatilityThreshold: number,
): { value: number | null; percent: number | null; dampener: number } {
  const value = atr(bars, period);
  if (value === null) return { value: null, percent: null, dampener: 1 };

  const currentPrice = bars[bars.length - 1].c;
  const percent = value / currentPrice;
  const dampener = calculateVolatilityDampener(value, currentPrice, highVolatilityThreshold);

  return { value, percent, dampener };
}

/**
 * Calculate On-Balance Volume score component.
 * Logic:
 *   - OBV trending up with price = Confirmation (+1)
 *   - OBV trending down with price = Confirmation (-1)
 *   - Divergence = Warning signal (reversed sign, reduced magnitude)
 */
function calculateObvScore(
  closes: number[],
  volumes: number[],
): { value: number | null; trend: number | null; score: number } {
  const value = obv(closes, volumes);
  if (value === null) return { value: null, trend: null, score: 0 };

  const trend = obvTrendScore(closes, volumes, 10);
  if (trend === null) return { value, trend: null, score: 0 };

  // Score directly from trend alignment
  // 1 = bullish confirmation, -1 = bearish confirmation
  // -0.5 = bearish divergence (price up, OBV down), 0.5 = bullish divergence
  return { value, trend, score: trend };
}

/**
 * Calculate Fibonacci Retracement score component.
 * Logic:
 *   - Price near 0.618 (Golden Pocket) = Strong support/resistance significance
 *   - Price near 0.5 = Moderate significance
 *   - Price near 0.382 or 0.786 = Lesser significance
 *   - Above 0.618 = Potential support, Below = Potential resistance
 */
function calculateFibonacciScore(
  closes: number[],
  currentPrice: number,
  levels: number[],
  proximityThreshold: number,
): { levels: FibonacciLevels | null; nearLevel: number | null; score: number; isSupport: boolean } {
  const fibLevels = calculateFibonacciLevels(closes, levels);
  if (fibLevels === null) {
    return { levels: null, nearLevel: null, score: 0, isSupport: false };
  }

  const proximity = checkFibonacciProximity(currentPrice, fibLevels, proximityThreshold);

  // Score based on proximity significance
  let score = proximity.score * 0.67; // Scale so max is ~1.0

  // Boost score at golden pocket (0.618)
  if (proximity.nearLevel === 0.618) {
    score = proximity.isSupport ? 1 : -1;
  }

  return {
    levels: fibLevels,
    nearLevel: proximity.nearLevel,
    score: Math.max(-1, Math.min(1, score)),
    isSupport: proximity.isSupport,
  };
}

/**
 * Calculate Ichimoku Cloud score component.
 * Logic:
 *   - Price above cloud = Strong uptrend (+1)
 *   - Price below cloud = Strong downtrend (-1)
 *   - Price in cloud = Neutral/noise (0)
 *   - Tenkan/Kijun cross adds additional signal
 */
function calculateIchimokuScore(
  highs: number[],
  lows: number[],
  closes: number[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouBPeriod: number,
): IchimokuResult & { score: number } {
  const result = ichimoku(highs, lows, closes, tenkanPeriod, kijunPeriod, senkouBPeriod);

  if (result.isAboveCloud === null) {
    return { ...result, score: 0 };
  }

  let score = 0;

  // Primary signal: Price position relative to cloud
  if (result.isAboveCloud) {
    score = 1; // Strong bullish
  } else if (result.isBelowCloud) {
    score = -1; // Strong bearish
  } else if (result.isInCloud) {
    score = 0; // Neutral
  }

  // Secondary signal: Tenkan-sen vs Kijun-sen (TK Cross)
  if (result.tenkanSen !== null && result.kijunSen !== null) {
    if (result.tenkanSen > result.kijunSen) {
      score = Math.min(1, score + 0.3); // Bullish TK cross boost
    } else if (result.tenkanSen < result.kijunSen) {
      score = Math.max(-1, score - 0.3); // Bearish TK cross boost
    }
  }

  return { ...result, score };
}

/**
 * Calculate the complete technical score using all 10 indicators.
 *
 * @param input - OHLCV bars and optional precomputed values
 * @param config - Bot configuration with indicator settings
 * @returns Complete technical score result with breakdown
 */
export function calculateTechnicalScore(
  input: TechnicalScoreInput,
  config: Config,
): TechnicalScoreResult {
  const { bars } = input;
  const indicatorConfig = config.indicators;

  // Need minimum data for all indicators
  // Ichimoku needs the most: max(9,26,52) + 26 = 78 bars
  const MIN_REQUIRED_BARS = 80;
  if (bars.length < MIN_REQUIRED_BARS) {
    return createNeutralResult("Insufficient data (need 80+ bars for Ichimoku)");
  }

  // Extract price arrays
  const closes = bars.map((b) => b.c);
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const volumes = bars.map((b) => b.v);
  const currentPrice = closes[closes.length - 1];

  // Calculate individual indicator scores
  const indicators: IndicatorValues = {
    currentPrice,

    // 1. SMA (15% weight) - Trend
    sma: (() => {
      const enabled = indicatorConfig.sma.enabled;
      const weight = enabled ? indicatorConfig.sma.weight : 0;
      const { value, score } = enabled
        ? calculateSmaScore(closes, currentPrice, indicatorConfig.sma.period)
        : { value: null, score: 0 };
      return { value, score, weight };
    })(),

    // 2. EMA (10% weight) - Trend
    ema: (() => {
      const enabled = indicatorConfig.ema.enabled;
      const weight = enabled ? indicatorConfig.ema.weight : 0;
      const { fast, slow, score } = enabled
        ? calculateEmaScore(closes, indicatorConfig.ema.fast_period, indicatorConfig.ema.slow_period)
        : { fast: null, slow: null, score: 0 };
      return { fast, slow, score, weight };
    })(),

    // 3. RSI (12% weight) - Momentum
    rsi: (() => {
      const enabled = indicatorConfig.rsi.enabled;
      const weight = enabled ? indicatorConfig.rsi.weight : 0;
      const { value, score } = enabled
        ? calculateRsiScore(
            closes,
            indicatorConfig.rsi.period,
            indicatorConfig.rsi.oversold,
            indicatorConfig.rsi.overbought,
          )
        : { value: null, score: 0 };
      return { value, score, weight };
    })(),

    // 4. MACD (10% weight) - Momentum
    macd: (() => {
      const enabled = indicatorConfig.macd.enabled;
      const weight = enabled ? indicatorConfig.macd.weight : 0;
      const { macd: macdVal, signal, histogram, score } = enabled
        ? calculateMacdScore(
            closes,
            indicatorConfig.macd.fast_period,
            indicatorConfig.macd.slow_period,
            indicatorConfig.macd.signal_period,
          )
        : { macd: null, signal: null, histogram: null, score: 0 };
      return { macd: macdVal, signal, histogram, score, weight };
    })(),

    // 5. Bollinger Bands (8% weight) - Volatility
    bollinger: (() => {
      const enabled = indicatorConfig.bollinger.enabled;
      const weight = enabled ? indicatorConfig.bollinger.weight : 0;
      const { middle, upper, lower, percentB, score } = enabled
        ? calculateBollingerScore(closes, indicatorConfig.bollinger.period, indicatorConfig.bollinger.std_dev)
        : { middle: null, upper: null, lower: null, percentB: null, score: 0 };
      return { middle, upper, lower, percentB, score, weight };
    })(),

    // 6. Stochastic (8% weight) - Momentum
    stochastic: (() => {
      const enabled = indicatorConfig.stochastic.enabled;
      const weight = enabled ? indicatorConfig.stochastic.weight : 0;
      const { k, d, score } = enabled
        ? calculateStochasticScore(
            highs,
            lows,
            closes,
            indicatorConfig.stochastic.k_period,
            indicatorConfig.stochastic.d_period,
            indicatorConfig.stochastic.oversold,
            indicatorConfig.stochastic.overbought,
          )
        : { k: null, d: null, score: 0 };
      return { k, d, score, weight };
    })(),

    // 7. ATR (5% weight) - Risk/Volatility (dampener only)
    atr: (() => {
      const enabled = indicatorConfig.atr.enabled;
      const weight = enabled ? indicatorConfig.atr.weight : 0;
      const { value, percent, dampener } = enabled
        ? calculateAtrComponent(bars, indicatorConfig.atr.period, indicatorConfig.atr.high_volatility_threshold)
        : { value: null, percent: null, dampener: 1 };
      return { value, percent, dampener, weight };
    })(),

    // 8. OBV (12% weight) - Volume
    obv: (() => {
      const enabled = indicatorConfig.obv.enabled;
      const weight = enabled ? indicatorConfig.obv.weight : 0;
      const { value, trend, score } = enabled
        ? calculateObvScore(closes, volumes)
        : { value: null, trend: null, score: 0 };
      return { value, trend, score, weight };
    })(),

    // 9. Fibonacci (10% weight) - Support/Resistance
    fibonacci: (() => {
      const enabled = indicatorConfig.fibonacci.enabled;
      const weight = enabled ? indicatorConfig.fibonacci.weight : 0;
      const { nearLevel, score, isSupport } = enabled
        ? calculateFibonacciScore(
            closes,
            currentPrice,
            indicatorConfig.fibonacci.levels,
            indicatorConfig.fibonacci.proximity_threshold,
          )
        : { nearLevel: null, score: 0, isSupport: false };
      return { nearLevel, score, isSupport, weight };
    })(),

    // 10. Ichimoku (10% weight) - Complex Trend/Support/Resistance
    ichimoku: (() => {
      const enabled = indicatorConfig.ichimoku.enabled;
      const weight = enabled ? indicatorConfig.ichimoku.weight : 0;
      const result = enabled
        ? calculateIchimokuScore(
            highs,
            lows,
            closes,
            indicatorConfig.ichimoku.tenkan_period,
            indicatorConfig.ichimoku.kijun_period,
            indicatorConfig.ichimoku.senkou_b_period,
          )
        : {
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
            score: 0,
          };
      return {
        tenkanSen: result.tenkanSen,
        kijunSen: result.kijunSen,
        senkouSpanA: result.senkouSpanA,
        senkouSpanB: result.senkouSpanB,
        cloudTop: result.cloudTop,
        cloudBottom: result.cloudBottom,
        isAboveCloud: result.isAboveCloud,
        isBelowCloud: result.isBelowCloud,
        isInCloud: result.isInCloud,
        score: result.score,
        weight,
      };
    })(),
  };

  // Calculate weighted composite score (before dampening)
  let weightedSum = 0;
  let totalActiveWeight = 0;

  const addIndicator = (ind: { score: number; weight: number }) => {
    if (ind.weight > 0) {
      weightedSum += ind.score * ind.weight;
      totalActiveWeight += ind.weight;
    }
  };

  addIndicator(indicators.sma);
  addIndicator(indicators.ema);
  addIndicator(indicators.rsi);
  addIndicator(indicators.macd);
  addIndicator(indicators.bollinger);
  addIndicator(indicators.stochastic);
  addIndicator(indicators.obv);
  addIndicator(indicators.fibonacci);
  addIndicator(indicators.ichimoku);

  // Normalize by active weight (if all disabled, score is 0)
  const rawScore = totalActiveWeight > 0 ? weightedSum / totalActiveWeight : 0;

  // Apply ATR volatility dampener
  const dampener = indicators.atr.dampener;
  const score = rawScore * dampener;

  // Calculate confidence based on indicator agreement
  const scores = [
    indicators.sma.score,
    indicators.ema.score,
    indicators.rsi.score,
    indicators.macd.score,
    indicators.bollinger.score,
    indicators.stochastic.score,
    indicators.obv.score,
    indicators.fibonacci.score,
    indicators.ichimoku.score,
  ].filter((s) => s !== 0); // Exclude null/disabled

  const confidence = calculateConfidence(scores);

  // Generate summary
  const summary = generateSummary(indicators, score);

  // Determine signal
  const signal = scoreToSignal(score);

  return {
    score,
    rawScore,
    volatilityDampener: dampener,
    indicators,
    signal,
    confidence,
    summary,
  };
}

/**
 * Calculate confidence based on indicator agreement.
 * High confidence when indicators agree, low when they conflict.
 */
function calculateConfidence(scores: number[]): number {
  if (scores.length < 2) return 0.5;

  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // Lower stdDev = higher confidence (indicators agree)
  // Max stdDev is ~1.15 (when half are -1 and half are +1)
  const maxStdDev = 1.15;
  const agreementScore = 1 - Math.min(1, stdDev / maxStdDev);

  // Scale to 0.5-1.0 range
  return 0.5 + agreementScore * 0.5;
}

/**
 * Convert score to signal category.
 */
function scoreToSignal(score: number): TechnicalScoreResult["signal"] {
  if (score > 0.6) return "strong_buy";
  if (score > 0.2) return "buy";
  if (score < -0.6) return "strong_sell";
  if (score < -0.2) return "sell";
  return "neutral";
}

/**
 * Generate human-readable summary of active signals.
 */
function generateSummary(indicators: IndicatorValues, finalScore: number): string[] {
  const summary: string[] = [];

  // Trend signals
  if (indicators.sma.score > 0.5) summary.push("Price above SMA (bullish trend)");
  if (indicators.sma.score < -0.5) summary.push("Price below SMA (bearish trend)");
  if (indicators.ema.score > 0.5) summary.push("Golden Cross (EMA bullish)");
  if (indicators.ema.score < -0.5) summary.push("Death Cross (EMA bearish)");

  // Momentum signals
  if (indicators.rsi.value !== null) {
    if (indicators.rsi.value <= 30) summary.push(`RSI oversold (${indicators.rsi.value.toFixed(1)})`);
    else if (indicators.rsi.value >= 70) summary.push(`RSI overbought (${indicators.rsi.value.toFixed(1)})`);
  }
  if (indicators.macd.score > 0.5) summary.push("MACD bullish crossover");
  if (indicators.macd.score < -0.5) summary.push("MACD bearish crossover");
  if (indicators.stochastic.score > 0.5) summary.push("Stochastic bullish cross (oversold)");
  if (indicators.stochastic.score < -0.5) summary.push("Stochastic bearish cross (overbought)");

  // Volatility signals
  if (indicators.bollinger.percentB !== null) {
    if (indicators.bollinger.percentB <= 0.05) summary.push("Price at lower Bollinger Band");
    else if (indicators.bollinger.percentB >= 0.95) summary.push("Price at upper Bollinger Band");
  }

  // Volume signals
  if (indicators.obv.trend === 1) summary.push("OBV confirming uptrend (volume supports)");
  if (indicators.obv.trend === -1) summary.push("OBV confirming downtrend (volume supports)");
  if (indicators.obv.trend === -0.5) summary.push("OBV divergence (price up, volume down)");
  if (indicators.obv.trend === 0.5) summary.push("OBV divergence (price down, volume up)");

  // Support/Resistance signals
  if (indicators.fibonacci.nearLevel === 0.618 && indicators.fibonacci.isSupport) {
    summary.push("At Golden Pocket support (0.618)");
  }
  if (indicators.fibonacci.nearLevel === 0.618 && !indicators.fibonacci.isSupport) {
    summary.push("At Golden Pocket resistance (0.618)");
  }

  // Ichimoku signals
  if (indicators.ichimoku.isAboveCloud) summary.push("Above Ichimoku Cloud (strong uptrend)");
  if (indicators.ichimoku.isBelowCloud) summary.push("Below Ichimoku Cloud (strong downtrend)");
  if (indicators.ichimoku.isInCloud) summary.push("Inside Ichimoku Cloud (consolidation)");

  // Volatility warning
  if (indicators.atr.dampener < 0.8) {
    summary.push(`High volatility detected (dampener: ${(indicators.atr.dampener * 100).toFixed(0)}%)`);
  }

  // Final signal summary
  if (summary.length === 0) {
    if (finalScore > 0.1) summary.push("Mild bullish bias");
    else if (finalScore < -0.1) summary.push("Mild bearish bias");
    else summary.push("No strong signals");
  }

  return summary;
}

/**
 * Create a neutral result for insufficient data.
 */
function createNeutralResult(reason: string): TechnicalScoreResult {
  return {
    score: 0,
    rawScore: 0,
    volatilityDampener: 1,
    indicators: {
      currentPrice: 0,
      sma: { value: null, score: 0, weight: 0 },
      ema: { fast: null, slow: null, score: 0, weight: 0 },
      rsi: { value: null, score: 0, weight: 0 },
      macd: { macd: null, signal: null, histogram: null, score: 0, weight: 0 },
      bollinger: { middle: null, upper: null, lower: null, percentB: null, score: 0, weight: 0 },
      stochastic: { k: null, d: null, score: 0, weight: 0 },
      atr: { value: null, percent: null, dampener: 1, weight: 0 },
      obv: { value: null, trend: null, score: 0, weight: 0 },
      fibonacci: { nearLevel: null, score: 0, isSupport: false, weight: 0 },
      ichimoku: {
        tenkanSen: null,
        kijunSen: null,
        senkouSpanA: null,
        senkouSpanB: null,
        cloudTop: null,
        cloudBottom: null,
        isAboveCloud: null,
        isBelowCloud: null,
        isInCloud: null,
        score: 0,
        weight: 0,
      },
    },
    signal: "neutral",
    confidence: 0,
    summary: [reason],
  };
}

/** Check if technical score is bullish enough for a buy signal */
export function isBullishSignal(result: TechnicalScoreResult, threshold = 0.5): boolean {
  return result.score >= threshold && result.confidence >= 0.6;
}

/** Check if technical score is bearish enough for a sell signal */
export function isBearishSignal(result: TechnicalScoreResult, threshold = -0.3): boolean {
  return result.score <= threshold && result.confidence >= 0.6;
}

/** Format score for display */
export function formatTechnicalScore(score: number): string {
  const pct = (score * 100).toFixed(1);
  if (score > 0.6) return `+${pct}% (Strong Buy)`;
  if (score > 0.2) return `+${pct}% (Buy)`;
  if (score < -0.6) return `${pct}% (Strong Sell)`;
  if (score < -0.2) return `${pct}% (Sell)`;
  return `${pct}% (Neutral)`;
}
