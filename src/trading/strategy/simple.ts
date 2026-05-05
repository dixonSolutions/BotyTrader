/**
 * Simple hybrid strategy: comprehensive technical score + sentiment
 *
 * The technical score now incorporates 10 professional indicators:
 * - SMA (15%): Simple Moving Average trend
 * - EMA (10%): Exponential Moving Average trend
 * - RSI (12%): Momentum oscillator (mean reversion)
 * - MACD (10%): Trend momentum
 * - Bollinger Bands (8%): Volatility-based support/resistance
 * - Stochastic (8%): Momentum oscillator
 * - ATR (5%): Volatility dampener
 * - OBV (12%): Volume confirmation
 * - Fibonacci (10%): Support/resistance levels
 * - Ichimoku (10%): Comprehensive trend/cloud
 *
 * Formula: hybrid = w_t * technical + w_s * sentiment
 * Where technical is the composite score from calculateTechnicalScore()
 */

import { calculateTechnicalScore, type TechnicalScoreResult } from "../../signal/technicalScore.js";
import { sma, rsi } from "../../signal/technical.js";
import type { Config } from "../../config.js";
import type { OhlcBar } from "../../signal/types.js";

/** Legacy input format for backward compatibility */
export interface SimpleStrategyInputs {
  /** Closing prices (oldest to newest) - required for legacy calculation */
  closes?: number[];
  /** Full OHLCV bars (preferred for comprehensive technical score) */
  bars?: OhlcBar[];
  /** Sentiment score -1..1, or 0 if unavailable */
  sentimentScore: number;
}

/** Extended result with comprehensive technical indicator breakdown */
export interface SimpleStrategyResult {
  /** Final technical composite score from 10 indicators (-1 to +1) */
  technicalScore: number;
  /** Hybrid score combining technical and sentiment */
  hybridScore: number;
  /** Recommended action */
  action: "buy" | "sell" | "hold";
  /** RSI value (for backward compatibility) */
  rsiValue: number | null;
  /** SMA fast value (for backward compatibility) */
  smaFast: number | null;
  /** SMA slow value (for backward compatibility) */
  smaSlow: number | null;
  /** Legacy SMA crossover score (for backward compatibility) */
  smaCrossoverScore: number;
  /** Legacy RSI component (for backward compatibility) */
  rsiComponent: number;
  /** Full technical score breakdown with all 10 indicators */
  technicalBreakdown?: TechnicalScoreResult;
  /** Signal classification */
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  /** Confidence in the signal (0-1) */
  confidence: number;
  /** Human-readable summary of active signals */
  summary: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map SMA20 vs SMA50 to [-1,0,1] with a neutral band (fraction of last close).
 * @deprecated Use comprehensive technical score instead
 */
export function computeSmaCrossoverScore(
  lastClose: number,
  smaFast: number,
  smaSlow: number,
  neutralBand: number,
): number {
  if (lastClose <= 0) return 0;
  const spread = (smaFast - smaSlow) / lastClose;
  if (Math.abs(spread) < neutralBand) return 0;
  return spread > 0 ? 1 : -1;
}

/**
 * RSI (14) mapped to mean-reversion style [-1,1]: oversold -> positive.
 * @deprecated Use comprehensive technical score instead
 */
export function computeRsiComponent(rsiValue: number | null): number {
  if (rsiValue === null) return 0;
  return clamp((50 - rsiValue) / 20, -1, 1);
}

/**
 * Compute the simple strategy using the comprehensive 10-indicator technical score.
 *
 * @param config - Bot configuration with indicator settings
 * @param input - Strategy inputs (either bars for full analysis or closes for legacy)
 * @returns Strategy result with action recommendation and full indicator breakdown
 */
export function computeSimpleStrategy(
  config: Config,
  input: SimpleStrategyInputs,
): SimpleStrategyResult {
  const s = config.strategy.simple;

  // Calculate legacy SMA/RSI for backward compatibility
  const closes = input.closes ?? input.bars?.map((b) => b.c) ?? [];
  const periodFast = s.sma_fast_period;
  const periodSlow = s.sma_slow_period;
  const periodRsi = s.rsi_period;

  const fast = closes.length >= periodFast ? sma(closes, periodFast) : null;
  const slow = closes.length >= periodSlow ? sma(closes, periodSlow) : null;
  const rsiVal = closes.length >= periodRsi + 1 ? rsi(closes, periodRsi) : null;

  const lastClose = closes[closes.length - 1] ?? 0;
  const smaCross =
    fast != null && slow != null && lastClose > 0
      ? computeSmaCrossoverScore(lastClose, fast, slow, s.sma_neutral_band)
      : 0;
  const rsiComp = computeRsiComponent(rsiVal);

  // Calculate comprehensive technical score if we have full bars
  let technicalBreakdown: TechnicalScoreResult | undefined;
  let technicalScore: number;

  if (input.bars && input.bars.length >= 80) {
    // Use comprehensive 10-indicator technical score
    technicalBreakdown = calculateTechnicalScore({ bars: input.bars }, config);
    technicalScore = technicalBreakdown.score;
  } else {
    // Fallback to legacy simple calculation if insufficient data
    technicalScore = 0.5 * smaCross + 0.5 * rsiComp;
  }

  // Combine with sentiment
  const wT = s.technical_weight;
  const wS = s.sentiment_weight;
  const hybrid = wT * technicalScore + wS * input.sentimentScore;

  // Determine action
  let action: "buy" | "sell" | "hold" = "hold";
  if (hybrid > s.buy_threshold) action = "buy";
  else if (hybrid < s.sell_threshold) action = "sell";

  // Signal classification
  const signal = technicalBreakdown?.signal ?? (hybrid > 0.5 ? "buy" : hybrid < -0.3 ? "sell" : "neutral");
  const confidence = technicalBreakdown?.confidence ?? 0.5;
  const summary = technicalBreakdown?.summary ?? [
    `SMA Cross: ${smaCross > 0 ? "bullish" : smaCross < 0 ? "bearish" : "neutral"}`,
    `RSI: ${rsiVal?.toFixed(1) ?? "N/A"}`,
  ];

  return {
    technicalScore,
    hybridScore: hybrid,
    action,
    rsiValue: rsiVal,
    smaFast: fast,
    smaSlow: slow,
    smaCrossoverScore: smaCross,
    rsiComponent: rsiComp,
    technicalBreakdown,
    signal,
    confidence,
    summary,
  };
}

/**
 * Quick technical check using just the comprehensive score.
 * For use when sentiment is unavailable or disabled.
 *
 * @param bars - OHLCV bars (need 80+ for full analysis)
 * @param config - Bot configuration
 * @returns Technical score result or null if insufficient data
 */
export function computeTechnicalOnly(
  bars: OhlcBar[],
  config: Config,
): TechnicalScoreResult | null {
  if (bars.length < 80) return null;
  return calculateTechnicalScore({ bars }, config);
}

/**
 * Determine if the technical score is bullish enough to buy.
 *
 * @param result - Strategy result
 * @param config - Bot configuration with thresholds
 * @returns True if buy conditions are met
 */
export function shouldBuy(result: SimpleStrategyResult, config: Config): boolean {
  const s = config.strategy.simple;
  const hybrid = result.hybridScore;
  const confidence = result.confidence;
  const risk = config.risk;

  // Must exceed buy threshold and have reasonable confidence
  const aboveThreshold = hybrid >= s.buy_threshold;
  const confident = confidence >= risk.min_confidence_to_trade * 0.8; // Slightly lower threshold for technical

  return aboveThreshold && confident;
}

/**
 * Determine if the technical score is bearish enough to sell.
 *
 * @param result - Strategy result
 * @param config - Bot configuration with thresholds
 * @returns True if sell conditions are met
 */
export function shouldSell(result: SimpleStrategyResult, config: Config): boolean {
  const s = config.strategy.simple;
  const hybrid = result.hybridScore;

  // Must be below sell threshold
  return hybrid <= s.sell_threshold;
}
