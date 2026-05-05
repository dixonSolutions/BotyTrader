# Simple Algorithmic Strategy

This document defines the first BotyTrader strategy layer: a deterministic technical + FinBERT sentiment trader with local state in SQLite. The goal is to build a clear, auditable baseline before adding any broader LLM context reasoning.

## Scope

The simple strategy does three things:

1. Maintains a local database of prices, signals, sentiment scores, watchlist state, and executed trades.
2. Generates a numeric hybrid signal from technical indicators and news sentiment.
3. Buys, sells, or holds only when deterministic thresholds and risk gates pass.

This strategy does **not** require embeddings or vector memory. It also does not require an LLM for reasoning. A reasoning LLM can be added later as a bounded context evaluator, but it should not be part of the first baseline.

## Strategy Formula

```text
hybrid_signal = 0.6 * technical_score + 0.4 * sentiment_score
```

| Component | Calculation |
|-----------|-------------|
| `technical_score` | `0.5 * sma_crossover_score + 0.5 * rsi_score` |
| `sentiment_score` | FinBERT weighted average across latest relevant news |
| `BUY` | `hybrid_signal > +0.50` |
| `SELL` | `hybrid_signal < -0.30` |
| `HOLD` | otherwise |

Scores should be normalized to `[-1.0, +1.0]` before blending:

- `-1.0` means strongly bearish.
- `0.0` means neutral or unavailable.
- `+1.0` means strongly bullish.

## Technical Score

```text
technical_score = 0.5 * sma_crossover_score + 0.5 * rsi_score
```

### SMA Crossover

Use SMA(20) and SMA(50):

```text
sma_crossover_score = +1.0 when SMA20 is meaningfully above SMA50
sma_crossover_score = -1.0 when SMA20 is meaningfully below SMA50
sma_crossover_score =  0.0 when the spread is too small to trust
```

The implementation should avoid treating tiny floating-point differences as real trend changes. A small neutral band around zero is preferred.

### RSI

Use RSI(14), normalized into a directional score:

```text
RSI <= 30 -> bullish oversold signal
RSI >= 70 -> bearish overbought signal
RSI around 50 -> neutral
```

A simple first mapping can be:

```text
rsi_score = clamp((50 - RSI14) / 20, -1.0, +1.0)
```

This makes oversold conditions positive and overbought conditions negative. If later strategies prefer momentum continuation instead of mean reversion, this mapping should become strategy-specific.

## Sentiment Score

Sentiment is produced by a dedicated FinBERT-style classifier, not by the reasoning LLM.

For each headline or news item:

```text
headline_score = positive_probability - negative_probability
```

Then combine recent news with weights:

```text
sentiment_score =
  weighted_average(headline_score * recency_weight * source_weight)
```

Recommended behavior:

- Use `0.0` when no relevant news is available.
- Cache repeated headlines by content hash.
- Store the FinBERT model id with each cached result.
- Expire old sentiment results so stale news does not dominate current signals.

## Local FinBERT

FinBERT should be local by default because it may run often and does not need a generative LLM interface.

Preferred providers:

| Provider | Use |
|----------|-----|
| `local_finbert` | Default. Local classifier via ONNX, Transformers.js, or another supported local runtime. |
| `huggingface_api` | Optional fallback when local runtime is unavailable. |
| `disabled` | Treat sentiment as neutral. |

Ollama can be supported experimentally if a compatible classifier model is available and returns stable structured output, but FinBERT should be managed as a **sentiment model**, not as the primary reasoning model.

Failure behavior must be conservative:

```text
sentiment_score = 0.0
sentiment_status = "unavailable"
```

The bot should never invent sentiment when the sentiment model fails.

## SQLite State

Use a local SQLite database:

```text
~/.config/trading-cli/trades.db
```

The database is the trader's source of truth for auditability, backtesting, caching, and avoiding repeated work.

### `trades`

Every executed order, including broker identifiers.

| Column | Purpose |
|--------|---------|
| `id` | Local trade id |
| `signal_id` | Signal that caused this trade |
| `alpaca_order_id` | Broker order id |
| `symbol` | Traded symbol |
| `side` | `buy` or `sell` |
| `qty` | Submitted quantity |
| `status` | Broker order status |
| `submitted_at` | Submission timestamp |
| `filled_at` | Fill timestamp, if filled |
| `filled_avg_price` | Broker-reported fill price |

### `signals`

Every generated signal, including signals that were not executed.

| Column | Purpose |
|--------|---------|
| `id` | Local signal id |
| `symbol` | Symbol evaluated |
| `created_at` | Signal timestamp |
| `technical_score` | Normalized technical score |
| `sentiment_score` | Normalized FinBERT sentiment score |
| `hybrid_score` | Final blended score |
| `action` | `buy`, `sell`, or `hold` |
| `executed` | Whether the signal became an order |
| `rejection_reason` | Why execution was blocked, if applicable |
| `strategy_version` | Version of the formula/config used |

### `watchlist`

Symbols currently monitored by the bot.

| Column | Purpose |
|--------|---------|
| `symbol` | Symbol being watched |
| `status` | `watching`, `eligible`, `held`, `cooldown`, or `blocked` |
| `source` | Typically `config` (synced from `watchlist.symbols`) or `manual` |
| `rank_score` | Optional ranking score when present |
| `last_scanned_at` | Last broad scan or refresh |
| `cooldown_until` | Re-entry block after exit |
| `notes` | Human-readable reason/context |

### `sentiment_cache`

Cached FinBERT results keyed by headline content.

| Column | Purpose |
|--------|---------|
| `headline_hash` | MD5 or equivalent content hash |
| `headline` | Original headline text |
| `model_id` | Sentiment model used |
| `label` | `positive`, `neutral`, or `negative` |
| `score` | Normalized score in `[-1.0, +1.0]` |
| `confidence` | Classifier confidence |
| `created_at` | Cache creation timestamp |
| `expires_at` | Cache expiry timestamp |

### `price_history`

OHLCV bars used for indicators and backtesting.

| Column | Purpose |
|--------|---------|
| `symbol` | Symbol |
| `timeframe` | Bar timeframe, such as `1Min`, `5Min`, or `1Day` |
| `timestamp` | Bar timestamp |
| `open` | Open price |
| `high` | High price |
| `low` | Low price |
| `close` | Close price |
| `volume` | Volume |

Use a unique key on `(symbol, timeframe, timestamp)` so market data refreshes can upsert bars safely.

## Cycles

The bot does not scan the entire market. It evaluates **open positions** on the portfolio cycle and **symbols you list in `watchlist.symbols`** on the candidate cycle (at least one ticker is required in config).

```text
Portfolio cycle:
  manage held positions
  check exits, stops, take-profit, and sell signals

Candidate cycle:
  sync watchlist rows from config
  generate new signals for each configured symbol
```

Example schedule:

| Cycle | Interval | Purpose |
|-------|----------|---------|
| Portfolio management | 5 minutes (typical) | Protect and manage existing positions |
| Candidate evaluation | 30 minutes (typical) | Re-score every symbol in `watchlist.symbols` |

Signals and orders still must pass the same risk gates (`autotrade`, `min_confidence_to_trade`, sizing).

## Execution Policy

The strategy can propose an action, but execution must pass deterministic gates:

```text
BUY only if:
  hybrid_signal > +0.50
  risk limits pass
  account allocation is available
  symbol is tradable
  spread/liquidity checks pass
  autotrade is enabled

SELL only if:
  hybrid_signal < -0.30
  position exists
  symbol is tradable
  autotrade is enabled
```

When a signal is rejected, the system must still write it to `signals` with `executed = false` and a clear `rejection_reason`.

## Safety Rules

The first strategy should reject unsafe trades before scoring or execution:

- Missing price history.
- Missing or stale market data.
- Illiquid symbols.
- Excessive spread.
- Halted or non-tradable symbols.
- Position size above configured risk limits.
- Daily trade limit exceeded.
- Symbol in cooldown.

Security and safety must be enforced in the orchestrator/execution layer, not only hidden or disabled in the TUI.

## Future LLM Context Layer

A later LLM context evaluator can be added after this baseline is measurable. It should not replace the formula above. It should only provide bounded, structured context such as:

```json
{
  "context_class": "temporary_overreaction",
  "signal_adjustment": 0.12,
  "hard_block_buy": false,
  "confidence": 0.71
}
```

If introduced, the adjustment must be clamped and recorded in `signals`. The deterministic risk engine still makes the final execution decision.
