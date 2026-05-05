/**
 * Builds {@link AlpacaSearchScoredSymbol} rows for Alpaca news search scoring.
 */

import type { AlpacaSearchScoredSymbol } from "../types.js";
import type { SimpleStrategyResult } from "../strategy/simple.js";

export function computeAlpacaNewsRankScore(
  hybridScore: number,
  smaFast: number | null,
  smaSlow: number | null,
  newsArticleCount: number,
): number {
  const momentum =
    smaFast != null && smaSlow != null && smaSlow !== 0 ? (smaFast - smaSlow) / smaSlow : 0;
  const newsBoost = Math.min(newsArticleCount / 5, 1) * 10;
  const momentumBoost = momentum > 0 ? momentum * 20 : 0;
  const rankScore = ((hybridScore + 1) / 2) * 70 + newsBoost + momentumBoost;
  return Math.max(0, Math.min(100, rankScore));
}

export function buildAlpacaNewsSearchReason(technicalScore: number, sentimentScore: number): string {
  return `tech=${technicalScore.toFixed(2)} sent=${sentimentScore.toFixed(2)}`;
}

export function buildAlpacaNewsSearchScoredSymbol(opts: {
  symbol: string;
  strat: SimpleStrategyResult;
  sentimentScore: number;
  price: number;
  volume24h: number;
  newsCount: number;
}): AlpacaSearchScoredSymbol {
  const { symbol, strat, sentimentScore, price, volume24h, newsCount } = opts;
  const rankScore = computeAlpacaNewsRankScore(strat.hybridScore, strat.smaFast, strat.smaSlow, newsCount);
  return {
    symbol: symbol.toUpperCase(),
    source: "news",
    technicalScore: strat.technicalScore,
    sentimentScore,
    hybridScore: strat.hybridScore,
    price,
    volume24h,
    newsCount,
    smaFast: strat.smaFast,
    smaSlow: strat.smaSlow,
    rsi: strat.rsiValue,
    rankScore,
    reason: buildAlpacaNewsSearchReason(strat.technicalScore, sentimentScore),
    technicalBreakdown: strat.technicalBreakdown,
  };
}
