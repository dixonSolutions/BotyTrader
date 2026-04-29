/**
 * Typed repositories — no raw SQL in TUI or strategy modules.
 */

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import type { SentimentCacheRow, SignalRow, WatchlistRow } from "../types.js";
import type { NewsItem, PriceBar } from "../../execution/broker.js";

const STRATEGY_VERSION = "simple-v1";

export function hashHeadline(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

export class TradingRepositories {
  constructor(private readonly db: Database.Database) {}

  insertSignal(row: {
    symbol: string;
    technicalScore: number | null;
    sentimentScore: number | null;
    hybridScore: number | null;
    action: SignalRow["action"];
    executed: boolean;
    rejectionReason: string | null;
  }): string {
    const id = newId("sig");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO signals (id, symbol, created_at, technical_score, sentiment_score, hybrid_score, action, executed, rejection_reason, strategy_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        row.symbol.toUpperCase(),
        now,
        row.technicalScore,
        row.sentimentScore,
        row.hybridScore,
        row.action,
        row.executed ? 1 : 0,
        row.rejectionReason,
        STRATEGY_VERSION,
      );
    return id;
  }

  updateSignal(
    id: string,
    patch: { executed: boolean; rejectionReason: string | null },
  ): void {
    this.db
      .prepare(`UPDATE signals SET executed = ?, rejection_reason = ? WHERE id = ?`)
      .run(patch.executed ? 1 : 0, patch.rejectionReason, id);
  }

  insertTrade(row: {
    signalId: string | null;
    brokerOrderId: string;
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    status: string;
    submittedAt: string;
    filledAt: string | null;
    filledAvgPrice: number | null;
  }): string {
    const id = newId("tr");
    this.db
      .prepare(
        `INSERT INTO trades (id, signal_id, broker_order_id, symbol, side, qty, status, submitted_at, filled_at, filled_avg_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        row.signalId,
        row.brokerOrderId,
        row.symbol.toUpperCase(),
        row.side,
        row.qty,
        row.status,
        row.submittedAt,
        row.filledAt,
        row.filledAvgPrice,
      );
    return id;
  }

  upsertWatchlistEntry(row: WatchlistRow): void {
    this.db
      .prepare(
        `INSERT INTO watchlist (symbol, status, source, rank_score, last_scanned_at, cooldown_until, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           status = excluded.status,
           source = excluded.source,
           rank_score = excluded.rank_score,
           last_scanned_at = excluded.last_scanned_at,
           cooldown_until = excluded.cooldown_until,
           notes = excluded.notes`,
      )
      .run(
        row.symbol.toUpperCase(),
        row.status,
        row.source,
        row.rankScore,
        row.lastScannedAt,
        row.cooldownUntil,
        row.notes,
      );
  }

  listWatchlist(): WatchlistRow[] {
    const rows = this.db.prepare("SELECT * FROM watchlist ORDER BY symbol").all() as {
      symbol: string;
      status: string;
      source: string;
      rank_score: number | null;
      last_scanned_at: string | null;
      cooldown_until: string | null;
      notes: string | null;
    }[];
    return rows.map((r) => ({
      symbol: r.symbol,
      status: r.status,
      source: r.source,
      rankScore: r.rank_score,
      lastScannedAt: r.last_scanned_at,
      cooldownUntil: r.cooldown_until,
      notes: r.notes,
    }));
  }

  getSentimentCache(hash: string): SentimentCacheRow | null {
    const row = this.db.prepare("SELECT * FROM sentiment_cache WHERE headline_hash = ?").get(hash) as
      | {
          headline_hash: string;
          headline: string;
          model_id: string;
          label: string;
          score: number;
          confidence: number | null;
          created_at: string;
          expires_at: string | null;
        }
      | undefined;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      this.db.prepare("DELETE FROM sentiment_cache WHERE headline_hash = ?").run(hash);
      return null;
    }
    return {
      headlineHash: row.headline_hash,
      headline: row.headline,
      modelId: row.model_id,
      label: row.label as SentimentCacheRow["label"],
      score: row.score,
      confidence: row.confidence,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  setSentimentCache(row: {
    headlineHash: string;
    headline: string;
    modelId: string;
    label: "positive" | "neutral" | "negative" | null;
    score: number;
    confidence: number | null;
    ttlMs: number;
  }): void {
    const now = new Date();
    const expires = new Date(now.getTime() + row.ttlMs);
    this.db
      .prepare(
        `INSERT INTO sentiment_cache (headline_hash, headline, model_id, label, score, confidence, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(headline_hash) DO UPDATE SET
           headline = excluded.headline,
           model_id = excluded.model_id,
           label = excluded.label,
           score = excluded.score,
           confidence = excluded.confidence,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        row.headlineHash,
        row.headline,
        row.modelId,
        row.label,
        row.score,
        row.confidence,
        now.toISOString(),
        expires.toISOString(),
      );
  }

  /** Upsert daily bars for backfill. */
  upsertPriceBars(timeframe: string, bars: PriceBar[], symbol: string): void {
    const sym = symbol.toUpperCase();
    const stmt = this.db.prepare(
      `INSERT INTO price_history (symbol, timeframe, ts, o, h, l, c, v)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, timeframe, ts) DO UPDATE SET
         o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v`,
    );
    const tx = this.db.transaction((items: PriceBar[]) => {
      for (const b of items) {
        stmt.run(sym, timeframe, b.t, b.o, b.h, b.l, b.c, b.v);
      }
    });
    tx(bars);
  }

  getPriceCloses(symbol: string, timeframe: string, limit: number): { ts: string; c: number }[] {
    const sym = symbol.toUpperCase();
    const rows = this.db
      .prepare(
        `SELECT ts, c FROM price_history WHERE symbol = ? AND timeframe = ? ORDER BY ts DESC LIMIT ?`,
      )
      .all(sym, timeframe, limit) as { ts: string; c: number }[];
    return rows.reverse();
  }

  /** Latest signals across all symbols (strategy audit trail). */
  recentSignalsAll(limit: number): SignalRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM signals ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as {
        id: string;
        symbol: string;
        created_at: string;
        technical_score: number | null;
        sentiment_score: number | null;
        hybrid_score: number | null;
        action: string;
        executed: number;
        rejection_reason: string | null;
        strategy_version: string;
      }[];
    return rows.map(mapSignalRow);
  }

  recentSignals(symbol: string, limit: number): SignalRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM signals WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(symbol.toUpperCase(), limit) as {
        id: string;
        symbol: string;
        created_at: string;
        technical_score: number | null;
        sentiment_score: number | null;
        hybrid_score: number | null;
        action: string;
        executed: number;
        rejection_reason: string | null;
        strategy_version: string;
      }[];
    return rows.map(mapSignalRow);
  }

  /** Insert a discovered stock candidate. */
  insertDiscovery(row: {
    symbol: string;
    source: string;
    technicalScore: number;
    sentimentScore: number;
    hybridScore: number;
    rankScore: number;
    priceAtDiscovery: number;
    action: string;
    notes?: string;
  }): string {
    const id = newId("disc");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO discoveries (id, symbol, discovered_at, source, technical_score, sentiment_score, hybrid_score, rank_score, price_at_discovery, action, invested, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        row.symbol.toUpperCase(),
        now,
        row.source,
        row.technicalScore,
        row.sentimentScore,
        row.hybridScore,
        row.rankScore,
        row.priceAtDiscovery,
        row.action,
        0,
        row.notes ?? null,
      );
    return id;
  }

  /** Mark a discovery as invested. */
  markDiscoveryInvested(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE discoveries SET invested = 1, invested_at = ? WHERE id = ?`)
      .run(now, id);
  }

  /** Get recent discoveries, optionally filtering by invested status. */
  listDiscoveries(opts: { limit?: number; invested?: boolean | null } = {}): DiscoveryRow[] {
    let sql = `SELECT * FROM discoveries`;
    const params: (number | string)[] = [];

    if (opts.invested !== null && opts.invested !== undefined) {
      sql += ` WHERE invested = ?`;
      params.push(opts.invested ? 1 : 0);
    }

    sql += ` ORDER BY discovered_at DESC`;

    if (opts.limit) {
      sql += ` LIMIT ?`;
      params.push(opts.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      symbol: string;
      discovered_at: string;
      source: string;
      technical_score: number;
      sentiment_score: number;
      hybrid_score: number;
      rank_score: number;
      price_at_discovery: number;
      action: string;
      invested: number;
      invested_at: string | null;
      notes: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      discoveredAt: r.discovered_at,
      source: r.source,
      technicalScore: r.technical_score,
      sentimentScore: r.sentiment_score,
      hybridScore: r.hybrid_score,
      rankScore: r.rank_score,
      priceAtDiscovery: r.price_at_discovery,
      action: r.action as DiscoveryRow["action"],
      invested: r.invested === 1,
      investedAt: r.invested_at,
      notes: r.notes,
    }));
  }

  /** Check if symbol was recently discovered (within cooldown hours). */
  isRecentlyDiscovered(symbol: string, cooldownHours: number): boolean {
    const cutoff = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
    const row = this.db
      .prepare(`SELECT 1 FROM discoveries WHERE symbol = ? AND discovered_at > ? LIMIT 1`)
      .get(symbol.toUpperCase(), cutoff) as { 1: number } | undefined;
    return row !== undefined;
  }

}

function mapSignalRow(r: {
  id: string;
  symbol: string;
  created_at: string;
  technical_score: number | null;
  sentiment_score: number | null;
  hybrid_score: number | null;
  action: string;
  executed: number;
  rejection_reason: string | null;
  strategy_version: string;
}): SignalRow {
  return {
    id: r.id,
    symbol: r.symbol,
    createdAt: r.created_at,
    technicalScore: r.technical_score,
    sentimentScore: r.sentiment_score,
    hybridScore: r.hybrid_score,
    action: r.action as SignalRow["action"],
    executed: r.executed === 1,
    rejectionReason: r.rejection_reason,
    strategyVersion: r.strategy_version,
  };
}

/**
 * Map broker NewsItem to scoring input.
 */
export function newsItemsForSymbol(items: NewsItem[]): { title: string; publishedAt: string }[] {
  return items.map((i) => ({ title: i.title, publishedAt: i.publishedAt }));
}
