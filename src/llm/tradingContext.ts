/**
 * LLM Trading Context Builder
 *
 * Gathers rich data for LLM-powered trading decisions:
 * - Price history (120 days)
 * - Recent news (12 articles)
 * - Account balance & positions
 * - Technical indicators
 * - Sentiment analysis
 */

import type { Config, Secrets } from "../config.js";
import type { BrokerAdapter, NewsItem, Position, PriceBar } from "../execution/broker.js";
import { aggregateNewsSentiment } from "../trading/sentiment/finbert.js";
import { newsItemsForSymbol } from "../trading/storage/repositories.js";
import type { TradingRepositories } from "../trading/storage/repositories.js";
import { computeSimpleStrategy } from "../trading/strategy/simple.js";

export interface TradingContext {
  symbol: string;
  timestamp: string;
  account: {
    equity: number;
    cash: number;
    buyingPower: number;
    currency: string;
  };
  positions: Position[];
  priceHistory: {
    days: number;
    bars: PriceBar[];
    currentPrice: number;
    dayChange: number;
    dayChangePct: number;
  };
  technical: {
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    technicalScore: number;
  };
  sentiment: {
    score: number;
    newsCount: number;
    recentHeadlines: string[];
  };
  hybrid: {
    score: number;
    action: "buy" | "sell" | "hold";
    confidence: number;
  };
  market: {
    trend: "up" | "down" | "sideways";
    volatility: "low" | "medium" | "high";
  };
}

export interface AllocationContext {
  timestamp: string;
  account: {
    equity: number;
    cash: number;
    buyingPower: number;
  };
  currentPositions: Position[];
  availableSymbols: Array<{
    symbol: string;
    price: number;
    technicalScore: number;
    sentimentScore: number;
    hybridScore: number;
    rankScore: number;
    newsCount: number;
  }>;
  riskProfile: {
    maxPositionPct: number;
    minConfidence: number;
    /** `[trading].positioning_scalar` — scales conviction-sized simple-engine buys. */
    positioningScalar: number;
  };
}

/**
 * Build rich trading context for a single symbol.
 */
export async function buildTradingContext(
  symbol: string,
  config: Config,
  secrets: Secrets,
  broker: BrokerAdapter,
  repo: TradingRepositories,
): Promise<TradingContext | null> {
  try {
    // Get account info
    const account = await broker.getAccount();
    const positions = await broker.listPositions();

    // Get price history (120 days)
    const bars = await broker.getPriceHistory(symbol, 120);
    if (bars.length < 20) {
      return null;
    }

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1] ?? 0;
    const prevPrice = closes[closes.length - 2] ?? currentPrice;
    const dayChange = currentPrice - prevPrice;
    const dayChangePct = prevPrice > 0 ? (dayChange / prevPrice) * 100 : 0;

    // Get news and sentiment
    let news: NewsItem[] = [];
    if (broker.getNews) {
      try {
        news = await broker.getNews(symbol, 12);
      } catch {
        // ignore
      }
    }

    const { sentimentScore, scored: newsCount } = await aggregateNewsSentiment(
      config,
      secrets,
      repo,
      newsItemsForSymbol(news),
    );

    // Compute technical strategy
    const strat = computeSimpleStrategy(config, { closes, sentimentScore });

    // Determine trend
    const trend = strat.smaFast && strat.smaSlow
      ? strat.smaFast > strat.smaSlow
        ? "up"
        : strat.smaFast < strat.smaSlow * 0.98
          ? "down"
          : "sideways"
      : "sideways";

    // Calculate volatility
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const volatility = returns.length > 0
      ? Math.sqrt(returns.reduce((a, b) => a + b * b, 0) / returns.length)
      : 0;
    const volLevel = volatility > 0.03 ? "high" : volatility > 0.015 ? "medium" : "low";

    // Recent headlines (last 5)
    const recentHeadlines = news.slice(0, 5).map((n) => n.title);

    const hybrid01 = (strat.hybridScore + 1) / 2;

    return {
      symbol,
      timestamp: new Date().toISOString(),
      account: {
        equity: account.equity,
        cash: account.cash,
        buyingPower: account.buyingPower,
        currency: account.currency,
      },
      positions,
      priceHistory: {
        days: bars.length,
        bars: bars.slice(-30), // Last 30 days only for LLM
        currentPrice,
        dayChange,
        dayChangePct,
      },
      technical: {
        sma20: strat.smaFast,
        sma50: strat.smaSlow,
        rsi14: strat.rsiValue,
        technicalScore: strat.technicalScore,
      },
      sentiment: {
        score: sentimentScore,
        newsCount,
        recentHeadlines,
      },
      hybrid: {
        score: strat.hybridScore,
        action: strat.action,
        confidence: Math.max(0, Math.min(1, hybrid01)),
      },
      market: {
        trend,
        volatility: volLevel,
      },
    };
  } catch (e) {
    console.error(`Failed to build trading context for ${symbol}:`, e);
    return null;
  }
}

/**
 * Build context for portfolio allocation decisions.
 */
export async function buildAllocationContext(
  config: Config,
  broker: BrokerAdapter,
  availableSymbols: Array<{
    symbol: string;
    price: number;
    technicalScore: number;
    sentimentScore: number;
    hybridScore: number;
    rankScore: number;
    newsCount: number;
  }>,
): Promise<AllocationContext> {
  const account = await broker.getAccount();
  const positions = await broker.listPositions();

  return {
    timestamp: new Date().toISOString(),
    account: {
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buyingPower,
    },
    currentPositions: positions,
    availableSymbols,
    riskProfile: {
      maxPositionPct: config.risk.max_position_pct,
      minConfidence: config.risk.min_confidence_to_trade,
      positioningScalar: config.trading.positioning_scalar,
    },
  };
}

/**
 * Format trading context for LLM prompt.
 */
export function formatContextForLLM(context: TradingContext): string {
  const { symbol, account, positions, priceHistory, technical, sentiment, hybrid, market } = context;

  const position = positions.find((p) => p.symbol === symbol);

  return `
=== TRADING DECISION CONTEXT ===
Symbol: ${symbol}
Time: ${context.timestamp}

--- ACCOUNT ---
Equity: $${account.equity.toFixed(2)} ${account.currency}
Cash: $${account.cash.toFixed(2)}
Buying Power: $${account.buyingPower.toFixed(2)}
Current Position in ${symbol}: ${position ? `${position.qty} shares @ $${position.avgEntryPrice.toFixed(2)}` : "None"}

--- PRICE ACTION ---
Current Price: $${priceHistory.currentPrice.toFixed(2)}
Day Change: ${priceHistory.dayChange >= 0 ? "+" : ""}${priceHistory.dayChange.toFixed(2)} (${priceHistory.dayChangePct >= 0 ? "+" : ""}${priceHistory.dayChangePct.toFixed(2)}%)
Trend: ${market.trend.toUpperCase()}
Volatility: ${market.volatility.toUpperCase()}

--- TECHNICAL INDICATORS ---
SMA 20: ${technical.sma20 ? `$${technical.sma20.toFixed(2)}` : "N/A"}
SMA 50: ${technical.sma50 ? `$${technical.sma50.toFixed(2)}` : "N/A"}
RSI 14: ${technical.rsi14 ? technical.rsi14.toFixed(1) : "N/A"}
Technical Score: ${technical.technicalScore >= 0 ? "+" : ""}${technical.technicalScore.toFixed(2)} (-1 to +1)

--- SENTIMENT ---
News Articles Analyzed: ${sentiment.newsCount}
Sentiment Score: ${sentiment.score >= 0 ? "+" : ""}${sentiment.score.toFixed(2)} (-1 negative to +1 positive)
Recent Headlines:
${sentiment.recentHeadlines.map((h) => `  • ${h}`).join("\n") || "  (No recent news)"}

--- CURRENT SIGNAL ---
Hybrid Score: ${hybrid.score >= 0 ? "+" : ""}${hybrid.score.toFixed(2)} (tech + sentiment weighted)
Current Action: ${hybrid.action.toUpperCase()}
Confidence: ${(hybrid.confidence * 100).toFixed(0)}%

--- YOUR TASK ---
Based on the above data, should we:
1. BUY (enter/add position)
2. SELL (exit/reduce position)
3. HOLD (maintain current position)

Consider: Technical momentum, news sentiment, position sizing, risk management.
Respond with ONLY: BUY, SELL, or HOLD followed by a brief reason (1 sentence).
`.trim();
}

/**
 * Format allocation context for LLM prompt.
 */
export function formatAllocationForLLM(context: AllocationContext): string {
  const { account, currentPositions, availableSymbols, riskProfile } = context;

  const positionValue = currentPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const positionPct = account.equity > 0 ? (positionValue / account.equity) * 100 : 0;

  return `
=== PORTFOLIO ALLOCATION CONTEXT ===
Time: ${context.timestamp}

--- ACCOUNT STATUS ---
Total Equity: $${account.equity.toFixed(2)}
Cash Available: $${account.cash.toFixed(2)}
Buying Power: $${account.buyingPower.toFixed(2)}

--- CURRENT HOLDINGS ---
${currentPositions.length === 0 ? "No positions held." : currentPositions.map((p) => `  • ${p.symbol}: ${p.qty} shares, $${p.marketValue.toFixed(2)} ($${p.unrealizedPnl >= 0 ? "+" : ""}${p.unrealizedPnl.toFixed(2)} PnL)`).join("\n")}
Total Invested: $${positionValue.toFixed(2)} (${positionPct.toFixed(1)}% of equity)

--- AVAILABLE OPPORTUNITIES ---
${availableSymbols.map((s) => `  • ${s.symbol}: $${s.price.toFixed(2)} | Hybrid: ${s.hybridScore >= 0 ? "+" : ""}${s.hybridScore.toFixed(2)} | Rank: ${s.rankScore.toFixed(0)}/100 | News: ${s.newsCount}`).join("\n")}

--- CONSTRAINTS ---
Max Position Size: ${riskProfile.maxPositionPct}% of equity per stock (hard cap on simple-engine buy notional)
Buy sizing scalar: ${riskProfile.positioningScalar}× (multiplies cash × conviction for deterministic buys)
Min Confidence: ${(riskProfile.minConfidence * 100).toFixed(0)}%

--- YOUR TASK ---
Select 3-5 stocks from Available Opportunities to build a diversified starter portfolio.
Consider: Score quality, diversification, risk management.

Respond with a comma-separated list of symbols (e.g., "AAPL,MSFT,SPY").
`.trim();
}
