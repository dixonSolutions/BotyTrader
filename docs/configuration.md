# Configuration

BotyTrader splits configuration into:

- **`config.toml`** — Behaviour, models, broker choice, risk, watchlist. **Safe to commit** (no secrets).
- **`.env`** — API keys and tokens. **Never commit** (use `.env.example` as a template).

## `config.toml` (intended schema)

Comments below illustrate purpose; exact keys may be adjusted in code — keep this doc in sync when the schema changes.

```toml
# BotyTrader — non-secret behaviour settings

[gemini]
# Gemini model used for embeddings (via Gemini Embedding API)
embedding_model = "text-embedding-004"

[huggingface]
# HF Storage Bucket name for the vector index (not a secret — safe to commit)
bucket_name = "your-username/botytrader-memory"

[broker]
# One of: alpaca_paper | alpaca_live | coinbase | binance
platform = "alpaca_paper"

[schedule]
# Cron-like or interval seconds — implementation-specific
agent_interval_seconds = 300

[risk]
# Example thresholds; tune per user
max_position_pct = 10.0
min_confidence_to_trade = 0.6
stop_loss_pct = 2.0
take_profit_pct = 5.0

[watchlist]
symbols = ["SPY", "QQQ"]

[autotrade]
# When false, orchestrator logs decisions but does not submit orders
enabled = false
```

### Sections summary

| Section | Purpose |
|---------|---------|
| `gemini` | Gemini embedding model id (not the chat LLM — DeepSeek is used for that). |
| `huggingface` | HF Storage Bucket name for the vector index. |
| `broker` | Which `BrokerAdapter` to instantiate. |
| `schedule` | How often the agent cycle runs. |
| `risk` | Gates for position size, confidence, stops. |
| `watchlist` | Default symbols for cycles and TUI. |
| `autotrade` | Master switch for real/paper order submission. |

## `.env` secrets

Copy from `.env.example` and fill values locally.

```bash
# .env.example — copy to .env and fill in values

# LLM (reasoning)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# Embeddings
GEMINI_API_KEY=AIzaxxxxxxxxxxxx

# Hugging Face (token only — bucket name is in config.toml)
HF_TOKEN=hf_xxxxxxxxxxxx

# Alpaca (required if broker.platform is alpaca_paper or alpaca_live)
ALPACA_API_KEY=PKxxxxxxxxxxxx
ALPACA_API_SECRET=xxxxxxxxxxxx

# Coinbase (required if broker.platform is coinbase)
COINBASE_API_KEY=
COINBASE_API_SECRET=

# Binance (required if broker.platform is binance)
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Brave Search
BRAVE_API_KEY=BSAxxxxxxxxxxxx
```

## `SecretsSchema` (Zod)

Validate `.env` at startup so misconfiguration fails fast:

```typescript
import { z } from "zod";

const SecretsSchema = z.object({
  DEEPSEEK_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  HF_TOKEN: z.string().min(1),
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_API_SECRET: z.string().optional(),
  COINBASE_API_KEY: z.string().optional(),
  COINBASE_API_SECRET: z.string().optional(),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BRAVE_API_KEY: z.string().min(1),
});

type Secrets = z.infer<typeof SecretsSchema>;
```

**Conditional validation:** After reading `config.toml`, require Alpaca keys when `broker.platform` is `alpaca_*`, Coinbase keys when `coinbase`, etc. Optional fields in the schema become **required** at runtime when that broker is active.

## Safe vs secret

| Item | Commit? | Location |
|------|---------|----------|
| Gemini embedding model name | Yes | `config.toml` → `[gemini]` |
| HF Storage Bucket name | Yes | `config.toml` → `[huggingface]` |
| Risk thresholds, watchlist | Yes | `config.toml` |
| Broker platform choice | Yes | `config.toml` |
| `DEEPSEEK_API_KEY` | **No** | `.env` |
| `GEMINI_API_KEY` | **No** | `.env` |
| `HF_TOKEN` | **No** | `.env` |
| Broker API keys / secrets | **No** | `.env` |
| `BRAVE_API_KEY` | **No** | `.env` |

There are no locally stored vector files to gitignore — the vector index lives in the HF Storage Bucket.

## Related docs

- [Development](development.md) — first-time setup.
- [Memory](memory.md) — `huggingface.bucket_name`, `GEMINI_API_KEY`, embedding lifecycle.
