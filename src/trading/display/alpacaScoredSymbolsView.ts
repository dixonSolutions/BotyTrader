/**
 * Pre-shaped strings for the Alpaca Search scored-symbol table (TUI only renders).
 */

import type { AlpacaSearchScoredSymbol } from "../types.js";
import { formatSignedTwoDecimals } from "./technicalBreakdownView.js";

export const ALPACA_SCORED_COL = {
  symbol: 7,
  price: 9,
  sent: 7,
  tech: 7,
  final: 7,
  action: 9,
  rank: 5,
  news: 4,
} as const;

function padRight(s: string, w: number): string {
  const t = s.length > w ? s.slice(0, w) : s;
  return t + " ".repeat(Math.max(0, w - t.length));
}

export function hybridActionLabel(hybrid: number, buyThreshold: number, sellThreshold: number): string {
  if (hybrid > buyThreshold) return "▲ BUY";
  if (hybrid < sellThreshold) return "▼ SELL";
  return "◆ HOLD";
}

export interface AlpacaScoredSymbolRowView {
  symbol: string;
  padded: {
    symbol: string;
    price: string;
    sentiment: string;
    technical: string;
    final: string;
    action: string;
    rank: string;
    news: string;
  };
}

export function buildAlpacaScoredSymbolsTableHeader(): string {
  const c = ALPACA_SCORED_COL;
  return `${padRight("Symbol", c.symbol)} ${padRight("Price", c.price)} ${padRight("Sent", c.sent)} ${padRight("Tech", c.tech)} ${padRight("Final", c.final)} ${padRight("Action", c.action)} ${padRight("Rank", c.rank)} ${padRight("News", c.news)}`;
}

export function buildAlpacaScoredSymbolRowViews(
  candidates: AlpacaSearchScoredSymbol[],
  thresholds: { buy: number; sell: number },
): AlpacaScoredSymbolRowView[] {
  const c = ALPACA_SCORED_COL;
  return candidates.map((row) => ({
    symbol: row.symbol,
    padded: {
      symbol: padRight(row.symbol, c.symbol),
      price: padRight(`$${row.price.toFixed(2)}`, c.price),
      sentiment: padRight(formatSignedTwoDecimals(row.sentimentScore), c.sent),
      technical: padRight(formatSignedTwoDecimals(row.technicalScore), c.tech),
      final: padRight(formatSignedTwoDecimals(row.hybridScore), c.final),
      action: padRight(hybridActionLabel(row.hybridScore, thresholds.buy, thresholds.sell), c.action),
      rank: padRight(String(Math.round(row.rankScore)), c.rank),
      news: padRight(String(row.newsCount), c.news),
    },
  }));
}
