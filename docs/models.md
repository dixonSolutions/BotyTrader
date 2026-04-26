# Models & inference

This page describes how BotyTrader runs the **reasoning (“pilot”) LLM**, caches **local** ONNX / transformers.js weights, optionally uses the **Hugging Face Inference API**, and how **FinBERT** is used for **trading sentiment** (separate from the ReAct LLM).

## Reasoning LLM (`[model]` in `config.toml`)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `provider` | `local` \| `huggingface_api` | `local` | Where the ReAct loop runs its forward passes. |
| `id` | string | `""` | Active Hugging Face **model id** (`org/repo`). For `local`, must be loadable by `@huggingface/transformers` as a **text-generation** pipeline. For `huggingface_api`, use an Inference-supported chat/LM id. |
| `dtype` | enum | `q4` | Local only — forwarded to transformers.js. |
| `device` | enum | `auto` | Local only. |
| `max_new_tokens` | int | `512` | Cap per assistant turn. |
| `cache_dir` | string | `.cache/models` | Root directory for cached weights (relative → project root). |

**TUI:** Edit **Config → Settings → Active local model** (free-form Hugging Face `org/repo`). There is no Hub browser in the app; use the [Hugging Face Hub](https://huggingface.co/models) in a browser, then paste the id.

## FinBERT sentiment (`[sentiment]` — Config → **Models** tab)

Product default is [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) (three-class financial sentiment). **`huggingface_api`** uses that Hub id with the Inference API. **`local_finbert`** loads [Xenova/finbert](https://huggingface.co/Xenova/finbert) in-process — the ONNX / `tokenizer.json` bundle Transformers.js needs; the ProsusAI tree does not include those files for Node.

| Key | Purpose |
|-----|---------|
| `provider` | `local_finbert` \| `huggingface_api` \| `disabled` |
| `model_id` | Prefer `ProsusAI/finbert` (API + docs). Local pipeline resolves to `Xenova/finbert` when this is set (or empty). |
| `cache_ttl_hours` | Sentiment cache TTL. |

**TUI:** **Config → Models** — official model link, provider cycle, warm/reload, **agent prompt blend** (− / + for `agent.sentiment_weight`). When **local FinBERT** is selected and the engine reports sentiment not ready, use **Install / update FinBERT** in the download panel: **spinner**, **block progress bar** (bytes when Hub reports them), live **phase + file** lines, and **Cancel** (disposes the pipeline; a single in-flight download may still finish). This is a terminal-only layout inspired by dark **PrimeNG** progress patterns ([PrimeNG](https://github.com/primefaces/primeng) / [primeng.org](https://primeng.org)) — Angular components are not usable inside Ink. Strategy weights and paper/live trading stay under **Config → Trading**.

### `[agent].sentiment_weight`

| Range | Default | Purpose |
|-------|---------|---------|
| 0.0–1.0 | `0.35` | How much the **ReAct** agent’s cycle prompt favours qualitative sentiment vs technicals (`0` = technical-heavy). Distinct from `[strategy.simple]` technical/sentiment weights. |

## Secrets (`.env`)

| Variable | When required |
|----------|----------------|
| `HF_TOKEN` | `model.provider = huggingface_api`; gated local downloads; `sentiment.provider = huggingface_api`; and when `features.memory_enabled = true` (bucket). |

## Runtime code paths

| Component | Role |
|-----------|------|
| `src/llm/model_manager.ts` | Programmatic list / pull / select / delete for local cache (no dedicated Hub TUI). |
| `src/llm/local_model.ts` | Cached `text-generation` pipeline for `provider = local`. |
| `src/llm/hf_api_model.ts` | `HfInference` for remote chat/text generation. |
| `src/llm/inference.ts` | `generateAgentTurn` — entry used by `agent/loop.ts`. |
| `src/trading/sentiment/finbert.ts` | Local or API text-classification for FinBERT. |
| `src/tui/screens/config/FinbertModelsEditor.tsx` | Config → Models UI. |

## Related

- [Configuration](configuration.md) — full `config.toml` schema.
- [Agent cycle](agent-cycle.md) — ReAct loop and tool contracts.
- [TUI](tui.md) — navigation (Home → Config → Models).
