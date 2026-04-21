# BotyTrader — Documentation

**BotyTrader** is a terminal-based trading assistant that combines a **TUI** (Ink), an **orchestrator** (watchlist, schedules, routing), an **agent loop** (DeepSeek LLM + MCP tools), **broker adapters** (Alpaca paper/live, Coinbase, Binance), and a **memory system** (Gemini Embedding API + Hugging Face Storage Buckets).

This documentation describes the intended architecture and configuration. Implementation may evolve; treat these pages as the source of truth for design decisions.

## Documentation map

| Document | Contents |
|----------|----------|
| [Architecture](architecture.md) | System diagram, components, data flow, source tree layout |
| [Agent cycle](agent-cycle.md) | RAG injection, reasoning loop, tool contracts, decision JSON |
| [Memory](memory.md) | Gemini embedder, Hugging Face Storage Buckets |
| [MCP server](mcp-server.md) | MCP entry, tool registry, tools vs orchestrator actions |
| [Broker adapters](broker-adapters.md) | `BrokerAdapter`, adapters, exit monitor |
| [TUI](tui.md) | Ink screens, navigation, state and commands |
| [Configuration](configuration.md) | `config.toml`, `.env` / secrets schema, safe vs secret |
| [Development](development.md) | Setup, run commands, conventions |

## Tech stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| TUI | Ink (React for CLI) |
| LLM | DeepSeek (API) |
| Agent protocol | MCP (Model Context Protocol) |
| Embeddings (API) | Gemini Embedding API (e.g. `text-embedding-004`) |
| Vector store | Hugging Face Storage Buckets |
| Market data & execution | Broker adapters (Alpaca, Coinbase, Binance) |
| Web search (tools) | Brave Search API |
| News (tools) | Alpaca News / NewsAPI (as implemented) |

## Naming

The official project name is **BotyTrader**. Use this name in READMEs, docs, and user-facing strings unless a package or repo slug requires a different identifier (e.g. `botytrader` on npm).
