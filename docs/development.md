# Development

How to set up and work on **BotyTrader** once the repository contains application code (`package.json`, `src/`).

## Prerequisites

- **Node.js** — LTS recommended (check repo `engines` when added).
- **Package manager** — `pnpm`, `npm`, or `yarn` (project preference TBD in root `package.json`).
- **Git**
- Accounts / keys as needed: DeepSeek, Google (Gemini API), Hugging Face, Alpaca (paper), Brave Search.

## First-time setup

1. Clone the repository.
2. Copy **`.env.example`** → **`.env`** and fill secrets (see [Configuration](configuration.md)).
3. Copy or create **`config.toml`** from the example in [Configuration](configuration.md).
4. Install dependencies: e.g. `pnpm install` or `npm install`.
5. Verify HF Storage Bucket access: the bucket named in `config.toml → [huggingface] bucket_name` must exist (create via the Hugging Face dashboard) and `HF_TOKEN` in `.env` must have write permission.

## Running (intended)

Commands will be defined in `package.json`. Typical targets:

| Script | Purpose |
|--------|---------|
| `dev` / `start` | Launch Ink TUI + orchestrator. |
| `mcp` | Run standalone MCP server (`tradr-mcp`) if split. |
| `build` | Typecheck + bundle for production. |
| `lint` | ESLint / TypeScript check. |

Until `package.json` exists, treat this as the **target** developer experience.

## Project layout conventions

- **`src/agent/`** — LLM loop only; no direct `.env` in hot paths (inject config).
- **`src/mcp/tools/`** — Read-only / analysis tools for the model.
- **`src/actions/`** — Side effects (orders, memory write) called by orchestrator after validation.
- **`src/memory/`** — Embedder (Gemini API), vector store (HF Storage Bucket), bucket helpers.
- **`src/execution/`** — Broker adapters and exit monitor.
- **`docs/`** — Architecture and operational docs (this folder).

## Documentation

When changing behaviour, update the relevant file under **`docs/`** and link from [index.md](index.md) if you add new topics.

## Linting and CI

- Run **lint** and **typecheck** before merging (see root scripts when available).
- Fix errors locally to keep the main branch sustainable.

## Security checklist

- Never commit **`.env`** or tokens.
- Enforce **broker-specific** secrets when that broker is selected.
- Keep **order submission** and **HF bucket writes** in orchestrator/actions, not as unrestricted agent tools (see [MCP server](mcp-server.md)).

## Related docs

- [Configuration](configuration.md) — `config.toml` and `SecretsSchema`.
- [Architecture](architecture.md) — full system overview.
