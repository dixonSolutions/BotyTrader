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
  // Migration 5: Add discoveries table for auto-discovery feature
  `CREATE TABLE IF NOT EXISTS discoveries (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  source TEXT,
  technical_score REAL,
  sentiment_score REAL,
  hybrid_score REAL,
  rank_score REAL,
  price_at_discovery REAL,
  action TEXT,
  invested INTEGER NOT NULL DEFAULT 0,
  invested_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_discoveries_symbol ON discoveries(symbol);
CREATE INDEX IF NOT EXISTS idx_discoveries_rank ON discoveries(rank_score DESC);`,
  // Migration 6: Screener universe, history, slot ledger, discoveries audit columns
  `CREATE TABLE IF NOT EXISTS universe (
  symbol TEXT PRIMARY KEY NOT NULL,
  last_price REAL NOT NULL DEFAULT 0,
  volume_usd_24h REAL NOT NULL DEFAULT 0,
  sector TEXT,
  last_refreshed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS discovery_history (
  id TEXT PRIMARY KEY NOT NULL,
  cycle_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rank_score REAL,
  technical_score REAL,
  hybrid_score REAL,
  sentiment_score REAL,
  price_at_scan REAL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_history_symbol_ts ON discovery_history(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_history_cycle ON discovery_history(cycle_id);
CREATE TABLE IF NOT EXISTS active_trades (
  symbol TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  broker_order_id TEXT,
  current_score REAL,
  entry_price REAL,
  entry_ts TEXT,
  last_score_ts TEXT,
  pending_exit_reason TEXT,
  CHECK (status IN ('OPEN','EXIT_PENDING','LIQUIDATING','EMPTY'))
);
CREATE INDEX IF NOT EXISTS idx_active_trades_status ON active_trades(status);
ALTER TABLE discoveries ADD COLUMN cycle_id TEXT;
ALTER TABLE discoveries ADD COLUMN persistence_score REAL;
ALTER TABLE discoveries ADD COLUMN momentum_bonus REAL;`,
  // Migration 7: Autonomous optimizer — feature snapshots, run audit, weight history
  `CREATE TABLE IF NOT EXISTS feature_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  signal_id TEXT,
  score_sma REAL, score_ema REAL, score_rsi REAL, score_macd REAL, score_bollinger REAL,
  score_stochastic REAL, score_obv REAL, score_fibonacci REAL, score_ichimoku REAL,
  weight_sma REAL, weight_ema REAL, weight_rsi REAL, weight_macd REAL, weight_bollinger REAL,
  weight_stochastic REAL, weight_atr REAL, weight_obv REAL, weight_fibonacci REAL, weight_ichimoku REAL,
  volatility_dampener REAL NOT NULL DEFAULT 1,
  technical_weight REAL NOT NULL DEFAULT 0.6,
  sentiment_weight REAL NOT NULL DEFAULT 0.4,
  hybrid_score REAL NOT NULL,
  technical_score REAL NOT NULL,
  sentiment_score REAL NOT NULL,
  is_shadow INTEGER NOT NULL DEFAULT 0,
  price_at_snapshot REAL NOT NULL,
  action TEXT NOT NULL,
  outcome_pct_change REAL,
  outcome_recorded_at TEXT,
  exit_window_hours INTEGER NOT NULL,
  buy_threshold REAL NOT NULL,
  swap_threshold REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_snapshots_symbol_created ON feature_snapshots(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_snapshots_outcome ON feature_snapshots(outcome_recorded_at);
CREATE TABLE IF NOT EXISTS optimization_runs (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  challenger_count INTEGER,
  lookback_days INTEGER,
  champion_pnl REAL,
  winner_pnl REAL,
  improvement_pct REAL,
  passed_diversity_check INTEGER,
  passed_stress_test INTEGER,
  weights_updated INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_started ON optimization_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS weight_history (
  id TEXT PRIMARY KEY NOT NULL,
  optimization_run_id TEXT,
  recorded_at TEXT NOT NULL,
  weight_sma REAL, weight_ema REAL, weight_rsi REAL, weight_macd REAL, weight_bollinger REAL,
  weight_stochastic REAL, weight_atr REAL, weight_obv REAL, weight_fibonacci REAL, weight_ichimoku REAL,
  buy_threshold REAL,
  exit_window_hours INTEGER,
  swap_threshold REAL,
  min_entry_score REAL DEFAULT 75,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_weight_history_recorded ON weight_history(recorded_at DESC);`,
];
