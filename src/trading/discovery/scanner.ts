/**
 * Stock Discovery Scanner — finds and ranks new investment opportunities.
 * Uses news, market data, and technical signals to identify promising stocks.
 */

import type { Config, Secrets } from "../../config.js";
import type { BrokerAdapter, NewsItem } from "../../execution/broker.js";
import { aggregateNewsSentiment } from "../sentiment/finbert.js";
import { computeSimpleStrategy } from "../strategy/simple.js";
import type { TradingRepositories } from "../storage/repositories.js";

export interface DiscoveryCandidate {
  symbol: string;
  source: "news" | "trending" | "volume" | "momentum";
  technicalScore: number;
  sentimentScore: number;
  hybridScore: number;
  price: number;
  volume24h: number;
  newsCount: number;
  smaFast: number | null;
  smaSlow: number | null;
  rsi: number | null;
  rankScore: number;
  reason: string;
}

export interface ScanResult {
  candidates: DiscoveryCandidate[];
  scanned: number;
  errors: string[];
}

const POPULAR_ETFS = [
  "SPY", "QQQ", "IWM", "VTI", "VOO", "VEA", "VWO", "AGG", "BND", "GLD",
  "XLF", "XLK", "XLE", "XLI", "XLP", "XLU", "XLV", "XLY", "XLB", "XRT",
];

const TECH_STOCKS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "NFLX", "AMD", "INTC",
  "CRM", "ORCL", "ADBE", "CSCO", "IBM", "UBER", "ABNB", "PYPL", "SHOP", "SQ",
];

/**
 * Extract unique symbols from news items that mention multiple tickers.
 */
function extractSymbolsFromNews(news: NewsItem[]): string[] {
  const symbols = new Set<string>();
  for (const item of news) {
    if (item.symbols) {
      for (const s of item.symbols) {
        symbols.add(s.toUpperCase());
      }
    }
  }
  return Array.from(symbols);
}

/**
 * Screen a symbol for basic eligibility:
 * - Must have price history
 * - Must have sufficient bars for technical analysis
 * - Price must be > $1 (avoid penny stocks)
 */
async function screenSymbol(
  broker: BrokerAdapter,
  symbol: string,
  minBars: number = 55,
): Promise<{ eligible: boolean; price: number; bars: number; error?: string }> {
  try {
    const bars = await broker.getPriceHistory(symbol, 120);
    if (bars.length < minBars) {
      return { eligible: false, price: 0, bars: bars.length, error: "Insufficient history" };
    }
    const lastClose = bars[bars.length - 1]?.c ?? 0;
    if (lastClose < 1.0) {
      return { eligible: false, price: lastClose, bars: bars.length, error: "Price below $1" };
    }
    const volume24h = bars.slice(-1)[0]?.v ?? 0;
    if (volume24h < 100000) {
      return { eligible: false, price: lastClose, bars: bars.length, error: "Low volume" };
    }
    return { eligible: true, price: lastClose, bars: bars.length };
  } catch (e) {
    return {
      eligible: false,
      price: 0,
      bars: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Score a candidate using the simple strategy + news sentiment.
 */
async function scoreCandidate(
  config: Config,
  secrets: Secrets,
  broker: BrokerAdapter,
  repo: TradingRepositories,
  symbol: string,
  source: DiscoveryCandidate["source"],
): Promise<DiscoveryCandidate | null> {
  try {
    // Get price history
    const bars = await broker.getPriceHistory(symbol, 120);
    const closes = bars.map((b) => b.c);
    const lastClose = closes[closes.length - 1] ?? 0;
    const volume24h = bars[bars.length - 1]?.v ?? 0;

    // Get news and sentiment
    let news: NewsItem[] = [];
    if (broker.getNews) {
      try {
        news = await broker.getNews(symbol, 12);
      } catch {
        // Ignore news errors
      }
    }

    const { sentimentScore, scored: newsCount } = await aggregateNewsSentiment(
      config,
      secrets,
      repo,
      news.map((n) => ({ title: n.title, publishedAt: n.publishedAt })),
    );

    // Compute technical strategy
    const strat = computeSimpleStrategy(config, { closes, sentimentScore });

    // Calculate rank score (0-100)
    // Higher hybrid = better, but also consider momentum and news volume
    const momentum = strat.smaFast && strat.smaSlow
      ? (strat.smaFast - strat.smaSlow) / strat.smaSlow
      : 0;
    const newsBoost = Math.min(newsCount / 5, 1) * 10; // Up to 10 points for news activity
    const momentumBoost = momentum > 0 ? momentum * 20 : 0; // Up to 20 points for positive momentum

    const rankScore = ((strat.hybridScore + 1) / 2) * 70 + newsBoost + momentumBoost;

    // Build reason string
    let reason = `hybrid=${strat.hybridScore.toFixed(2)}`;
    if (strat.rsiValue !== null) reason += ` rsi=${strat.rsiValue.toFixed(1)}`;
    if (momentum > 0) reason += ` momentum=+${(momentum * 100).toFixed(1)}%`;
    if (newsCount > 0) reason += ` news=${newsCount}`;

    return {
      symbol: symbol.toUpperCase(),
      source,
      technicalScore: strat.technicalScore,
      sentimentScore,
      hybridScore: strat.hybridScore,
      price: lastClose,
      volume24h,
      newsCount,
      smaFast: strat.smaFast,
      smaSlow: strat.smaSlow,
      rsi: strat.rsiValue,
      rankScore: Math.max(0, Math.min(100, rankScore)),
      reason,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Main discovery scan — finds and ranks candidates from multiple sources.
 */
export async function runDiscoveryScan(
  config: Config,
  secrets: Secrets,
  broker: BrokerAdapter,
  repo: TradingRepositories,
  opts: {
    maxCandidates?: number;
    minRankScore?: number;
    includePopularETFs?: boolean;
    includeTechStocks?: boolean;
    newsQuery?: string;
  } = {},
): Promise<ScanResult> {
  const candidates: DiscoveryCandidate[] = [];
  const errors: string[] = [];
  const scanned = new Set<string>();

  const maxCandidates = opts.maxCandidates ?? 20;
  const minRankScore = opts.minRankScore ?? 40;

  // Helper to add unique candidates
  async function tryAddSymbol(symbol: string, source: DiscoveryCandidate["source"]) {
    if (scanned.has(symbol.toUpperCase())) return;
    scanned.add(symbol.toUpperCase());

    // Quick screen first
    const screen = await screenSymbol(broker, symbol);
    if (!screen.eligible) {
      if (screen.error) errors.push(`${symbol}: ${screen.error}`);
      return;
    }

    // Full scoring
    const candidate = await scoreCandidate(config, secrets, broker, repo, symbol, source);
    if (candidate && candidate.rankScore >= minRankScore) {
      candidates.push(candidate);
    }
  }

  // 1. Scan popular ETFs
  if (opts.includePopularETFs !== false) {
    for (const symbol of POPULAR_ETFS) {
      if (candidates.length >= maxCandidates) break;
      await tryAddSymbol(symbol, "trending");
    }
  }

  // 2. Scan tech stocks
  if (opts.includeTechStocks !== false) {
    for (const symbol of TECH_STOCKS) {
      if (candidates.length >= maxCandidates) break;
      await tryAddSymbol(symbol, "momentum");
    }
  }

  // 3. Discover from news
  if (broker.searchNews) {
    try {
      const news = await broker.searchNews(opts.newsQuery ?? "stocks earnings", { maxArticles: 50 });
      const newsSymbols = extractSymbolsFromNews(news);
      for (const symbol of newsSymbols.slice(0, 15)) {
        if (candidates.length >= maxCandidates) break;
        await tryAddSymbol(symbol, "news");
      }
    } catch (e) {
      errors.push(`News scan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Sort by rank score descending
  candidates.sort((a, b) => b.rankScore - a.rankScore);

  return {
    candidates: candidates.slice(0, maxCandidates),
    scanned: scanned.size,
    errors,
  };
}

/**
 * Select top N candidates for auto-investment.
 * Considers: rank score, diversification, and position limits.
 */
export function selectTopCandidates(
  candidates: DiscoveryCandidate[],
  currentPositions: string[],
  maxNewPositions: number = 3,
): DiscoveryCandidate[] {
  // Filter out symbols we already hold
  const newCandidates = candidates.filter((c) => !currentPositions.includes(c.symbol));

  // Prioritize candidates with strong buy signals
  const buyCandidates = newCandidates.filter((c) => c.hybridScore > 0.3);

  // Sort by rank score and take top N
  return buyCandidates.slice(0, maxNewPositions);
}
