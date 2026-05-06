# Configuration

BotyTrader splits configuration into:

- **`config.toml`** — Behaviour, models, broker choice, risk, watchlist. **Safe to commit** (no secrets).
- **`.env`** — API keys and tokens. **Never commit** (use `.env.example` as a template).

## `config.toml` (intended schema)

Comments below illustrate purpose; exact keys may be adjusted in code — keep this doc in sync when the schema changes.

```toml
# BotyTrader — non-secret behaviour settings

[gemini]
# Gemini model used for embeddings (memory only — reasoning LLM is separate)
embedding_model = "text-embedding-004"

[model]
# local | huggingface_api — see docs/models.md
provider = "local"
# Active Hugging Face model id (local ONNX path or remote Inference id)
id = ""
# Quantisation: auto | fp32 | fp16 | q8 | q4 | q4f16
dtype = "q4"
# Inference device: auto | cpu | wasm | webgpu
device = "auto"
# Hard cap on completion tokens per ReAct turn
max_new_tokens = 512
# Where downloaded model files live (relative paths resolve under project root)
cache_dir = ".cache/models"

[huggingface]
# HF Storage Bucket name for the vector index (not a secret — safe to commit)
bucket_name = "your-username/botytrader-memory"

[broker]
# One of: alpaca_paper | alpaca_live | coinbase | binance
platform = "alpaca_paper"

[schedule]
agent_interval_seconds = 300
exit_monitor_interval_seconds = 30
portfolio_cycle_seconds = 300
candidate_cycle_seconds = 1800

[trading]
enabled = true
# paper | live — for Alpaca, matches broker platform; Config → Trading or broker enum both update this.
mode = "paper"
database_path = "~/.config/trading-cli/trades.db"
# Buy notional uses cash × conviction × positioning_scalar (see config.example.toml); default 1.0.
positioning_scalar = 1.0

[strategy.simple]
enabled = true
technical_weight = 0.6
sentiment_weight = 0.4
buy_threshold = 0.50
sell_threshold = -0.30
sma_fast_period = 20
sma_slow_period = 50
rsi_period = 14
sma_neutral_band = 0.001

[sentiment]
# local_finbert | hybrid_finbert | huggingface_api | disabled (HF_TOKEN in .env for API / hybrid API slots)
provider = "local_finbert"
model_id = "ProsusAI/finbert"
cache_ttl_hours = 24
hf_api_runs_numerator = 1
hf_api_runs_denominator = 2

[risk]
max_position_pct = 10.0
min_confidence_to_trade = 0.6
stop_loss_pct = 2.0
take_profit_pct = 5.0

# At least one symbol is required for the simple strategy candidate cycle.
[watchlist]
symbols = ["SPY", "QQQ"]

[autotrade]
enabled = false

[optimization]
enabled = false
exit_window_hours = 48
challenger_swap_threshold = 10
challenger_min_entry_score = 75

[features]
memory_enabled = true
web_search_enabled = false

[agent]
# Hard cap on ReAct iterations per cycle
max_iterations = 8
# Prompt blend: 0 = technical-heavy, 1 = sentiment/news-heavy
sentiment_weight = 0.35
# Optional — system prompt (default lives in code as DEFAULT_AGENT_SYSTEM_PROMPT)
# system_prompt = """..."""
```

### Sections summary

| Section | Purpose |
|---------|---------|
| `gemini` | Gemini embedding model id (memory only). |
| `model` | `provider`, active `id`, local dtype/device/token cap, and `cache_dir` for downloads. |
| `huggingface` | HF Storage Bucket name for the vector index. |
| `broker` | Which `BrokerAdapter` to instantiate. |
| `schedule` | Agent interval, exit monitor, and trading engine cycles (portfolio and watchlist candidate intervals). |
| `optimization` | Autonomous optimizer: schedule, snapshots, walk-forward challengers — includes `challenger_swap_threshold` and `challenger_min_entry_score` used when mutating bundles. |
| `trading` | Enable simple engine, paper/live, SQLite path — see [Simple strategy](simple-strategy.md). |
| `strategy.simple` | Technical + FinBERT signal weights, thresholds, and indicator periods. |
| `sentiment` | FinBERT (local or HF API) and headline cache TTL. |
| `risk` | Gates for position size, confidence, stops. |
| `watchlist` | **Required:** at least one ticker — the bot only evaluates and trades symbols you list here (no automatic universe scan). |
| `autotrade` | Master switch for real/paper order submission. |
| `features` | `memory_enabled` — RAG + HF writes (requires `GEMINI_API_KEY` + `HF_TOKEN`); `web_search_enabled` — register `brave_web_search` when a Brave key is set. Keys stay in `.env` when off. |
| `agent` | `system_prompt`, `max_iterations`, and `sentiment_weight` (ReAct prompt blend; see [Models](models.md)). |

## `.env` secrets

Copy from `.env.example` and fill values locally.

```bash
# .env.example — copy to .env and fill in values

# Hugging Face token — required when model.provider = huggingface_api; with memory; gated local pulls
# HF_TOKEN=hf_xxxxxxxxxxxx

# Embeddings (required only when features.memory_enabled = true)
# GEMINI_API_KEY=AIzaxxxxxxxxxxxx

# Alpaca (required if broker.platform is alpaca_paper or alpaca_live)
ALPACA_API_KEY=PKxxxxxxxxxxxx
ALPACA_API_SECRET=xxxxxxxxxxxx

# Coinbase (required if broker.platform is coinbase)
COINBASE_API_KEY=
COINBASE_API_SECRET=

# Binance (required if broker.platform is binance)
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Brave Search — required in .env only when features.web_search_enabled = true
# BRAVE_API_KEY=BSAxxxxxxxxxxxx
```

## `SecretsSchema` (Zod)

Validate `.env` at startup so misconfiguration is caught early:

```typescript
import { z } from "zod";

const optionalEnvKey = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const SecretsSchema = z.object({
  HF_TOKEN: optionalEnvKey,
  GEMINI_API_KEY: optionalEnvKey,
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_API_SECRET: z.string().optional(),
  COINBASE_API_KEY: z.string().optional(),
  COINBASE_API_SECRET: z.string().optional(),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BRAVE_API_KEY: optionalEnvKey,
});

type Secrets = z.infer<typeof SecretsSchema>;
```

**Conditional validation:** After reading `config.toml`, require broker keys for the selected platform; require `GEMINI_API_KEY` and `HF_TOKEN` when `features.memory_enabled` is true; require `BRAVE_API_KEY` when `features.web_search_enabled` is true. Turning features off does not remove keys from `.env` — the app simply skips those integrations. **There is no LLM API key** — set the reasoning model id under **Config → Settings** or `[model] id` in `config.toml`. FinBERT sentiment is **Config → Models** ([ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) only).

## Startup validation flow

On launch the orchestrator runs `SecretsSchema` against the loaded environment. Rather than crashing on missing keys, it communicates the missing set to the TUI:

```
Startup
  │
  ├─ Load config.toml
  ├─ Load .env (if it exists)
  ├─ Run SecretsSchema.safeParse()
  │
  ├─ PASS → launch normally (Dashboard)
  │
  └─ FAIL → open TUI Setup screen
              │
              ├─ Show each missing key with description
              ├─ Collect values via masked input
              ├─ Write to .env
              └─ Re-run SecretsSchema → PASS → launch normally
```

The `.env` file is created automatically if it does not exist. Already-set keys are never overwritten unless the user explicitly edits them in the **Secrets** screen.

## Resetting secrets via the TUI

If a credential becomes invalid after launch (key rotated, wrong value, expired token) you do **not** need to edit `.env` manually:

1. From **Home**, click **Config**, then the **Secrets** tab.
2. All `.env` keys are listed with their set/unset status (values masked).
3. Click a key, type the new value in the masked field, then **Save**.
4. The orchestrator writes the new value to `.env` and reloads secrets without restarting.

This is the recommended recovery path for any authentication error surfaced in the Agent Log or Dashboard.

## Managing local models

The reasoning LLM is a Hugging Face `org/repo` id loaded via `@huggingface/transformers` (local) or the Inference API (remote). In the TUI, set **Config → Settings → Active local model** (or edit `[model]` in `config.toml`). Weights cache under `config.model.cache_dir` (default `./.cache/models`). Use the [Hub](https://huggingface.co/models) in a browser to pick a compatible **text-generation** model id, then paste it into Settings.

FinBERT for trading sentiment is configured only under **Config → Models**; supported classifier repo is [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) — see [Models](models.md).

## Safe vs secret

| Item | Commit? | Location |
|------|---------|----------|
| Gemini embedding model name | Yes | `config.toml` → `[gemini]` |
| Active local model id, dtype, device | Yes | `config.toml` → `[model]` |
| HF Storage Bucket name | Yes | `config.toml` → `[huggingface]` |
| Risk thresholds, watchlist | Yes | `config.toml` |
| Broker platform choice | Yes | `config.toml` |
| `GEMINI_API_KEY` | **No** | `.env` — required only when `features.memory_enabled` |
| `HF_TOKEN` | **No** | `.env` — required only when `features.memory_enabled` (or for gated model repos) |
| Broker API keys / secrets | **No** | `.env` |
| `BRAVE_API_KEY` | **No** | `.env` — required only when `features.web_search_enabled` |

There are no locally stored vector files to gitignore — the vector index lives in the HF Storage Bucket. Local model weights live under `cache_dir` (already covered by `.gitignore`).

## Related docs

- [Development](development.md) — first-time setup.
- [Memory](memory.md) — `huggingface.bucket_name`, `GEMINI_API_KEY`, embedding lifecycle.
