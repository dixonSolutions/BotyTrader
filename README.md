# BotyTrader

**BotyTrader** is a terminal-based trading assistant: an **Ink** TUI, an **orchestrator** (watchlist, schedules, routing), an **agent loop** (DeepSeek LLM + MCP tools), **broker adapters** (Alpaca paper/live, Coinbase, Binance), and a **memory** stack (Gemini Embedding API + Hugging Face Storage Buckets).

## Documentation

Full architecture, agent cycle, MCP tools, memory, brokers, TUI, and configuration are documented here:

**[docs/index.md](docs/index.md)**

| Doc | Description |
|-----|-------------|
| [docs/architecture.md](docs/architecture.md) | System diagram, components, source layout |
| [docs/agent-cycle.md](docs/agent-cycle.md) | RAG, reasoning, decision JSON, post-decision actions |
| [docs/memory.md](docs/memory.md) | Embedder, LanceDB, Hugging Face sync |
| [docs/mcp-server.md](docs/mcp-server.md) | MCP tools vs orchestrator actions |
| [docs/broker-adapters.md](docs/broker-adapters.md) | BrokerAdapter, adapters, exit monitor |
| [docs/tui.md](docs/tui.md) | Ink screens and state flow |
| [docs/configuration.md](docs/configuration.md) | `config.toml`, `.env`, secrets schema |
| [docs/development.md](docs/development.md) | Setup and conventions |

## Status

Application source (`package.json`, `src/`) is not yet in this tree; the **docs** folder describes the intended design for implementation.

---

*Jiji*
