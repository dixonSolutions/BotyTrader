# BotyTrader

**BotyTrader** is a terminal-based AI trading assistant. It combines an **Ink** TUI (with **[@zenobius/ink-mouse](https://github.com/zenobi-us/ink-mouse)** for pointer hit-testing; use a modern terminal with mouse support), a TypeScript **orchestrator** (watchlist + schedules + risk gates), a **local Hugging Face ReAct agent** (`@huggingface/transformers` + MCP tools — no remote LLM API key required), broker-agnostic **adapters** (Alpaca paper/live, Coinbase, Binance scaffolds), and an optional **memory** stack (Gemini Embedding API → Hugging Face Storage Bucket). Text input fields (search, secrets, ids) still use the keyboard to type. See [docs/tui.md](docs/tui.md).

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy non-secret config (safe to commit later if you customise)
cp config.example.toml config.toml

# 3. Run — the TUI Setup wizard opens automatically if any required .env key is missing
npm run dev

# 4. Optional: keep scheduled trading running after the dashboard is closed
npm run start -- service install
```

You do **not** need to copy `.env.example` manually; the wizard will collect each missing credential and write `.env` (mode 0600) for you.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Launch Ink TUI + orchestrator (no watcher — recommended for using the TUI). |
| `npm run start -- run` | Run the scheduler/orchestrator without opening the TUI. |
| `npm run start -- service install` | Install, enable, and start the user-level background service. |
| `npm run dev:watch` | Same as `dev` but restarts on source changes. **Avoid if you want to use the TUI** — `tsx watch` and Ink both read stdin and arrow keys can collide with the watcher. |
| `npm run start` | Run the built bundle from `dist/`. |
| `npm run build` | Bundle TypeScript with `tsup` (ESM + CJS). |
| `npm run compile` | Compile to a single Linux x64 binary with `@yao-pkg/pkg`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint over `src/`. |
| `npm run mcp` | Run the standalone MCP server over stdio. |

## Project layout

```
src/
├── agent/loop.ts              ← RAG → ReAct (local or HF Inference API) → tool loop → decision JSON
├── llm/inference.ts           ← routes generateAgentTurn to local or API
├── llm/local_model.ts         ← @huggingface/transformers wrapper (one pipeline / process)
├── llm/hf_api_model.ts        ← @huggingface/inference (serverless chat / text-generation)
├── llm/hub_models.ts          ← Hub JSON search (ModelManager; no Hub tab in TUI)
├── llm/model_manager.ts       ← list / pull / select / delete; provider + remote id
├── actions/                   ← Orchestrator-only side effects (orders, memory)
├── execution/
│   ├── broker.ts              ← BrokerAdapter interface
│   ├── exit_monitor.ts        ← Deterministic stop-loss / take-profit
│   └── adapters/{alpaca,coinbase,binance}.ts
├── mcp/
│   ├── server.ts              ← Standalone MCP entry + in-process dispatcher
│   └── tools/                 ← market, news, web_search, portfolio
├── memory/
│   ├── embedder.ts            ← Gemini Embedding API
│   ├── store.ts               ← Vector index + cosine search
│   └── hf.ts                  ← Hugging Face Storage Bucket (S3-compatible)
├── signal/technical.ts        ← SMA, RSI
├── tui/                       ← Ink app, screens, layout primitives
├── config.ts                  ← Zod-validated config + secrets loader
├── orchestrator.ts            ← State owner + cycle scheduler + risk gates
└── index.ts                   ← Startup sequence
```

## Documentation

Full architecture, agent cycle, MCP tools, memory, brokers, TUI, configuration, and packaging:

**[docs/index.md](docs/index.md)**

| Doc | Description |
|-----|-------------|
| [docs/architecture.md](docs/architecture.md) | System diagram, components, source layout |
| [docs/agent-cycle.md](docs/agent-cycle.md) | RAG, reasoning, decision JSON, post-decision actions |
| [docs/background-service.md](docs/background-service.md) | Headless scheduler mode and systemd user service |
| [docs/memory.md](docs/memory.md) | Embedder, store, Hugging Face sync |
| [docs/mcp-server.md](docs/mcp-server.md) | MCP tools vs orchestrator actions |
| [docs/broker-adapters.md](docs/broker-adapters.md) | BrokerAdapter, adapters, exit monitor |
| [docs/tui.md](docs/tui.md) | Ink screens and state flow |
| [docs/configuration.md](docs/configuration.md) | `config.toml`, `.env`, secrets schema |
| [docs/development.md](docs/development.md) | Setup and conventions |
| [docs/publishing.md](docs/publishing.md) | APT repo, `.deb` packaging, npm, release pipeline |

## APT install (unofficial repo)

Releases publish a signed APT tree on **GitHub Pages** from the release workflow. After [enabling Pages and secrets](docs/publishing.md), install on Debian/Ubuntu (replace `OWNER/REPO`):

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sudo bash -s -- OWNER/REPO
```

Then use `sudo apt update && sudo apt upgrade botytrader` like any other package.

## Security

- **Order submission** and **memory writes** are **orchestrator actions**, never agent-callable tools — risk gates and the autotrade flag cannot be bypassed by the LLM.
- Broker-specific secrets are escalated to required at runtime based on `broker.platform`.
- `.env` is created with mode `0600` and never committed.
- Hard exits (stop-loss / take-profit) run in a deterministic loop independent of the LLM.

---

*Jiji*
