/**
 * Simple hybrid: technical (SMA crossover + RSI) + sentiment in [-1,1];
 * hybrid = w_t * technical + w_s * sentiment.
 */

import { rsi, sma } from "../../signal/technical.js";
import type { Config } from "../../config.js";

export interface SimpleStrategyInputs {
  closes: number[];
  sentimentScore: number; // -1..1, or 0 if unavailable
}

export interface SimpleStrategyResult {
  technicalScore: number;
  hybridScore: number;
  action: "buy" | "sell" | "hold";
  rsiValue: number | null;
  smaFast: number | null;
  smaSlow: number | null;
  smaCrossoverScore: number;
  rsiComponent: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map SMA20 vs SMA50 to [-1,0,1] with a neutral band (fraction of last close).
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
 */
export function computeRsiComponent(rsiValue: number | null): number {
  if (rsiValue === null) return 0;
  return clamp((50 - rsiValue) / 20, -1, 1);
}

export function computeSimpleStrategy(
  config: Config,
  input: SimpleStrategyInputs,
): SimpleStrategyResult {
  const s = config.strategy.simple;
  const periodFast = s.sma_fast_period;
  const periodSlow = s.sma_slow_period;
  const periodRsi = s.rsi_period;

  const fast = sma(input.closes, periodFast);
  const slow = sma(input.closes, periodSlow);
  const rsiVal = rsi(input.closes, periodRsi);

  const lastClose = input.closes[input.closes.length - 1] ?? 0;
  const smaCross =
    fast != null && slow != null
      ? computeSmaCrossoverScore(lastClose, fast, slow, s.sma_neutral_band)
      : 0;
  const rsiComp = computeRsiComponent(rsiVal);
  const technical = 0.5 * smaCross + 0.5 * rsiComp;

  const wT = s.technical_weight;
  const wS = s.sentiment_weight;
  const hybrid = wT * technical + wS * input.sentimentScore;

  let action: "buy" | "sell" | "hold" = "hold";
  if (hybrid > s.buy_threshold) action = "buy";
  else if (hybrid < s.sell_threshold) action = "sell";

  return {
    technicalScore: technical,
    hybridScore: hybrid,
    action,
    rsiValue: rsiVal,
    smaFast: fast,
    smaSlow: slow,
    smaCrossoverScore: smaCross,
    rsiComponent: rsiComp,
  };
}
