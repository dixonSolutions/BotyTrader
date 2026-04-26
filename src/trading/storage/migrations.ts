/**
 * SQLite schema for the deterministic trading engine (v1).
 */

export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  technical_score REAL,
  sentiment_score REAL,
  hybrid_score REAL,
  action TEXT NOT NULL,
  executed INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  strategy_version TEXT
);`,
  `CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY NOT NULL,
  signal_id TEXT,
  broker_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty REAL NOT NULL,
  status TEXT,
  submitted_at TEXT,
  filled_at TEXT,
  filled_avg_price REAL
);`,
  `CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY NOT NULL,
  status TEXT,
  source TEXT,
  rank_score REAL,
  last_scanned_at TEXT,
  cooldown_until TEXT,
  notes TEXT
);`,
  `CREATE TABLE IF NOT EXISTS sentiment_cache (
  headline_hash TEXT PRIMARY KEY NOT NULL,
  headline TEXT,
  model_id TEXT,
  label TEXT,
  score REAL,
  confidence REAL,
  created_at TEXT,
  expires_at TEXT
);`,
  `CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ts TEXT NOT NULL,
  o REAL, h REAL, l REAL, c REAL, v REAL,
  PRIMARY KEY (symbol, timeframe, ts)
);`,
  `CREATE INDEX IF NOT EXISTS idx_signals_symbol_created ON signals(symbol, created_at);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_price_history_sym_tf ON price_history(symbol, timeframe);
`,
];
