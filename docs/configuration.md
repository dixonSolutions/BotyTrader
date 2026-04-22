# Configuration

BotyTrader splits configuration into:

- **`config.toml`** — Behaviour, models, broker choice, risk, watchlist. **Safe to commit** (no secrets).
- **`.env`** — API keys and tokens. **Never commit** (use `.env.example` as a template).

## `config.toml` (intended schema)

Comments below illustrate purpose; exact keys may be adjusted in code — keep this doc in sync when the schema changes.

```toml
# BotyTrader — non-secret behaviour settings

[gemini]
# Gemini model used for embeddings (memory only — the reasoning LLM is local)
embedding_model = "text-embedding-004"

[model]
# Active local Hugging Face model id (manage installs from the Models screen)
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
# Cron-like or interval seconds — implementation-specific
agent_interval_seconds = 300

[risk]
max_position_pct = 10.0
min_confidence_to_trade = 0.6
stop_loss_pct = 2.0
take_profit_pct = 5.0

[watchlist]
symbols = ["SPY", "QQQ"]

[autotrade]
enabled = false

[features]
memory_enabled = true
web_search_enabled = false

[agent]
# Hard cap on ReAct iterations per cycle
max_iterations = 8
# Optional — system prompt (default lives in code as DEFAULT_AGENT_SYSTEM_PROMPT)
# system_prompt = """..."""
```

### Sections summary

| Section | Purpose |
|---------|---------|
| `gemini` | Gemini embedding model id (memory only — the reasoning LLM is local). |
| `model` | Active local HF model + dtype, device, token budget, and on-disk cache directory. |
| `huggingface` | HF Storage Bucket name for the vector index. |
| `broker` | Which `BrokerAdapter` to instantiate. |
| `schedule` | How often the agent cycle runs. |
| `risk` | Gates for position size, confidence, stops. |
| `watchlist` | Default symbols for cycles and TUI. |
| `autotrade` | Master switch for real/paper order submission. |
| `features` | `memory_enabled` — RAG + HF writes (requires `GEMINI_API_KEY` + `HF_TOKEN`); `web_search_enabled` — register `brave_web_search` when a Brave key is set. Keys stay in `.env` when off. |
| `agent` | `system_prompt` for the local ReAct cycle (Final JSON contract must still parse) and `max_iterations` cap. |

## `.env` secrets

Copy from `.env.example` and fill values locally.

```bash
# .env.example — copy to .env and fill in values

# Hugging Face token (optional — only needed for gated repos and memory bucket writes)
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

**Conditional validation:** After reading `config.toml`, require broker keys for the selected platform; require `GEMINI_API_KEY` and `HF_TOKEN` when `features.memory_enabled` is true; require `BRAVE_API_KEY` when `features.web_search_enabled` is true. Turning features off does not remove keys from `.env` — the app simply skips those integrations. **There is no LLM API key** — the reasoning model is downloaded locally and managed from the Models screen.

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

1. Press `c` from Home to open **Config**, then `2` for the **Secrets** tab.
2. All `.env` keys are listed with their set/unset status (values masked).
3. Select a key and press `Enter` to re-enter it.
4. On confirmation the orchestrator writes the new value to `.env` and reloads secrets without restarting.

This is the recommended recovery path for any authentication error surfaced in the Agent Log or Dashboard.

## Managing local models

The reasoning LLM is a local Hugging Face model loaded via `@huggingface/transformers`. Manage it from the **Models** screen (press `m` from Home):

- **Installed** — list every model already on disk; press `Enter` to make one active, `d` then `Enter` to delete.
- **Install** — pick a curated suggestion (including `TigerTrading/TradingBot`) or press `t` to install any HF repo id. Progress is reported per file in real time.
- **Details** — read-only inspector for the focused model (size, mtime, path).

Every byte lives under `config.model.cache_dir` (default `./.cache/models`) so users can always audit, back up, or wipe their on-disk footprint.

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
