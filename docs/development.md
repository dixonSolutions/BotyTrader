# Development

How to set up and work on **BotyTrader** once the repository contains application code (`package.json`, `src/`).

## Prerequisites

- **Node.js** — LTS recommended (check repo `engines` when added).
- **Package manager** — `pnpm`, `npm`, or `yarn` (project preference TBD in root `package.json`).
- **Git**
- Accounts / keys as needed: Alpaca (paper) for the broker; Google (Gemini API) + Hugging Face token are only required when `features.memory_enabled = true`; Brave Search is optional (web search tool only). The reasoning LLM runs entirely locally — no API key needed.

## First-time setup

1. Clone the repository.
2. Copy or create **`config.toml`** from the example in [Configuration](configuration.md).
3. Install dependencies: e.g. `npm install` or `pnpm install`.
   - The repo includes **`.npmrc`** with `legacy-peer-deps=true` so **Ink 5** installs cleanly alongside **@pppp606/ink-chart** (peer declares Ink 6; see [ink-chart](https://github.com/pppp606/ink-chart)).
4. Run the app: **`npm run dev`** (runs **`npm run build`** then **`node dist/index.js`**).
   - **`tsx` + `src/`** is not used for the main TUI: **`tsx`/`esbuild` cannot transform `yoga-layout`’s top-level await** the way Ink 5 pulls it. Use **`npm run dev:watch`** for **`tsup --watch`**, and **`npm run dev:run`** to launch the last build without rebuilding.
   - If **`.env`** is missing or any required key is absent, the TUI **Setup wizard** opens automatically and guides you through entering each credential.
   - Alternatively, copy **`.env.example`** → **`.env`** and fill values manually before running (see [Configuration](configuration.md) for the full secrets reference).
5. Verify HF Storage Bucket access: the bucket named in `config.toml → [huggingface] bucket_name` must exist (create via the Hugging Face dashboard) and `HF_TOKEN` must have write permission.

### Native SQLite (`better-sqlite3`)

If logs show **`was compiled against a different Node.js version`** for `better_sqlite3.node`, your `node_modules` binary does not match the Node you are running (common after upgrading Node or switching runtimes). From the repo root run:

```bash
npm run rebuild:native
```

Or reinstall: `rm -rf node_modules && npm install` (the **`postinstall`** script rebuilds `better-sqlite3` after install).

If you see **`Module did not self-register`** for `better_sqlite3.node`, the addon still does not match this Node process (or the install is incomplete). Use the same **`npm run rebuild:native`**, or a clean install with **`npm install --legacy-peer-deps`** (needed because of the Ink / `ink-chart` peer range).

> **Tip:** If a credential stops working after setup, open **Config → Secrets** in the TUI and re-enter the value without restarting.

## Running (intended)

Commands will be defined in `package.json`. Typical targets:

| Script | Purpose |
|--------|---------|
| `dev` | `build` then run **`node dist/index.js`** (recommended; avoids `tsx` + `yoga-layout` TLA issues). |
| `dev:run` | Run **`node dist/index.js`** only (use after `dev:watch` or `build`). |
| `dev:watch` | **`tsup --watch`** — rebuild `dist/` on source changes. |
| `start` | Production-style launch: **`node dist/index.js`** (run **`build`** first). |
| `mcp` | MCP server via **`tsx`** (separate entry; does not load Ink). |
| `build` | Bundle app to **`dist/`** with tsup. |
| `lint` / `typecheck` | ESLint / `tsc --noEmit`. |

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
