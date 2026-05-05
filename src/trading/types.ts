/**
 * Public types for the trading engine and persistence.
 */

import type { TechnicalScoreResult } from "../signal/technicalScore.js";

export type TradeAction = "buy" | "sell" | "hold";

export interface SignalRow {
  id: string;
  symbol: string;
  createdAt: string;
  technicalScore: number | null;
  sentimentScore: number | null;
  hybridScore: number | null;
  action: TradeAction;
  executed: boolean;
  rejectionReason: string | null;
  strategyVersion: string;
}

export interface TradeRow {
  id: string;
  signalId: string | null;
  brokerOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  status: string;
  submittedAt: string;
  filledAt: string | null;
  filledAvgPrice: number | null;
}

export interface WatchlistRow {
  symbol: string;
  status: string;
  source: string;
  rankScore: number | null;
  lastScannedAt: string | null;
  cooldownUntil: string | null;
  notes: string | null;
}

export interface SentimentCacheRow {
  headlineHash: string;
  headline: string;
  modelId: string;
  label: "positive" | "neutral" | "negative" | null;
  score: number;
  confidence: number | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface PriceBarRow {
  symbol: string;
  timeframe: string;
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Scored symbol row for Alpaca news search UI (computed in the TUI, not a discovery pipeline).
 */
export interface AlpacaSearchScoredSymbol {
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
  technicalBreakdown?: TechnicalScoreResult;
}
