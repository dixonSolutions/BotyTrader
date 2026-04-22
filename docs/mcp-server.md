# MCP server

The **Model Context Protocol (MCP)** server exposes **tools** the LLM can call during reasoning (market data, news, web search, portfolio read-only views). It does **not** expose unrestricted trading or Hugging Face push as agent-callable tools by default — those are **orchestrator actions** (see below).

## Entry point

- **In-app:** `tradr/src/mcp/server.ts`
- **Standalone package:** `tradr-mcp/src/server.ts`

Both register the same logical tool set and connect to the locally-loaded Hugging Face model owned by the orchestrator.

## Tool registry

Central registration (e.g. `tools/index.ts`) lists:

- Tool name
- Description (for the model)
- JSON Schema for inputs/outputs
- Handler wiring to `market.ts`, `news.ts`, `web_search.ts`, `portfolio.ts`

This keeps adding a new tool a **single-registry** change plus one file.

## Tool modules (intended)

| File | Responsibility |
|------|----------------|
| `web_search.ts` | Brave Search API — general intel (disabled if `BRAVE_API_KEY` unset). |
| `market.ts` | OHLCV + technical indicators (via broker or market data API). |
| `news.ts` | Headlines / articles (Alpaca News, NewsAPI, etc.). |
| `portfolio.ts` | Positions, balances, order history reads (via broker adapter). |

## Actions vs tools

| Kind | Location | Callable by agent? | Examples |
|------|----------|--------------------|----------|
| **MCP tools** | `src/mcp/tools/` | Yes | `get_price_history`, `brave_web_search`, … |
| **Actions** | `src/actions/` | No (orchestrator only) | `submit_order` (`alpaca.ts`), `summarize_to_memory` (`memory.ts`) |

**Why:** Prevents the model from bypassing risk checks, paper/live gates, and memory retention policy. The orchestrator validates the structured **decision JSON** and then calls actions with explicit parameters.

## Session flow (conceptual)

1. Orchestrator builds prompt (including RAG).
2. MCP client connects LLM to MCP server.
3. LLM issues tool calls → MCP executes → returns results → LLM continues until it emits **decision JSON**.

## Related docs

- [Agent cycle](agent-cycle.md) — tool names and post-decision flow.
- [Architecture](architecture.md) — diagram.
- [Broker adapters](broker-adapters.md) — data sources behind `market` / `portfolio`.
