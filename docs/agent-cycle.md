# Agent cycle

Describes one **orchestrated agent cycle**: RAG injection, MCP-backed reasoning, structured decision, then post-decision actions (execution + memory). Security-sensitive operations (orders, persisting memory to remote storage) must remain **orchestrator-controlled** and validated server-side in any web/API future; the agent only receives tools that are safe for autonomous reasoning.

## Phases

### Cycle start — RAG (not a tool)

- **Memory injection is automatic:** The orchestrator (or memory layer) embeds the current context (e.g. watchlist, session summary, recent logs) via the Gemini Embedding API, searches the vector index in the HF Storage Bucket, and **stuffs the top-k results into the system prompt** (or a dedicated RAG section).
- The agent does **not** call a tool to “load memory” for this step; it receives already-injected text.

### During reasoning — MCP tools

The LLM may call MCP tools freely until it is ready to emit a final decision. Typical tools:

| Tool name (conceptual) | Purpose |
|------------------------|---------|
| `brave_web_search` | General web search (Brave Search API). |
| `get_price_history` | OHLCV for a symbol over N days. |
| `get_technical_indicators` | Derived indicators (e.g. SMA, RSI) for a symbol. |
| `search_news` | News headlines / articles for a symbol (Alpaca News, NewsAPI, etc.). |
| `get_portfolio_state` | Current positions, buying power, account summary. |
| `get_order_history` | Optional symbol filter; recent orders. |

Implementation names may differ (e.g. snake_case in MCP schema); keep contracts stable in the MCP server’s tool definitions.

### Decision point — structured output (not a tool)

The agent emits a **single structured JSON object** as the cycle outcome — **not** as an MCP tool call. The orchestrator parses and validates this before any execution.

**Suggested schema:**

```json
{
  "action": "buy | sell | hold | close",
  "symbol": "AAPL",
  "qty": 1,
  "reasoning": "Short rationale for logs and memory.",
  "confidence": 0.0
}
```

| Field | Type | Notes |
|-------|------|--------|
| `action` | string (enum) | Must match allowed set in config/policy. |
| `symbol` | string | Ticker or instrument id as used by the broker adapter. |
| `qty` | number | Integer or decimal per broker rules. |
| `reasoning` | string | Human-readable; fed into `summarize_to_memory`. |
| `confidence` | number | 0–1; can gate auto-trade if below threshold. |

Extend with optional fields (e.g. `time_in_force`, `limit_price`) only if the broker layer and risk policy support them.

### Post-decision — orchestrator only (not agent tools)

| Action | Responsibility |
|--------|----------------|
| `submit_order(symbol, side, qty, …)` | Broker execution via **Alpaca** (or selected adapter). |
| `summarize_to_memory(cycleData)` | Embed summary + metadata → LanceDB → optional push to Hugging Face. |

The agent **must not** directly submit orders or push to Hugging Face as unrestricted tools; those are **orchestrator actions** after validation (risk limits, auto-trade flag, paper vs live).

## Orchestrator sequence (detailed)

1. **Pull memory from HF** — Startup only (or on interval): sync local LanceDB / dataset with remote repo if configured.
2. **RAG:** Embed current context → retrieve top-5 (or k) memories → build system prompt with injected memories.
3. **Open MCP session** with DeepSeek (or configured LLM) and registered tools.
4. **Agent reasoning loop:** LLM → tool_call → MCP server → result → LLM, until the model returns a **final decision JSON**.
5. **Parse decision** — Validate schema and policy.
6. **If autoTrade:** `broker.submitOrder(...)` via adapter.
7. **Memory:** `memory.summarizeAndStore(cycleData)` (embed + LanceDB + optional HF push).

## Tool contracts (reference)

Exact JSON shapes belong in the MCP tool’s `inputSchema` / `outputSchema`. Below is a logical contract for implementers.

### `brave_web_search`

- **Input:** `{ "query": string, "count"?: number }`
- **Output:** `{ "results": [{ "title", "url", "snippet" }] }`

### `get_price_history`

- **Input:** `{ "symbol": string, "days": number }`
- **Output:** `{ "bars": [{ "t", "o", "h", "l", "c", "v" }] }` (or equivalent)

### `get_technical_indicators`

- **Input:** `{ "symbol": string, "indicators"?: string[] }`
- **Output:** `{ "values": { "sma20": number, "rsi14": number, ... } }`

### `search_news`

- **Input:** `{ "symbol": string, "limit"?: number }`
- **Output:** `{ "items": [{ "title", "source", "published_at", "url" }] }`

### `get_portfolio_state`

- **Input:** `{}` or `{ "account_id"?: string }`
- **Output:** `{ "equity", "cash", "positions": [...] }` (adapter-specific)

### `get_order_history`

- **Input:** `{ "symbol"?: string, "limit"?: number }`
- **Output:** `{ "orders": [...] }`

## Related docs

- [Architecture](architecture.md) — diagram and components.
- [MCP server](mcp-server.md) — registry and tools vs actions.
- [Memory](memory.md) — RAG storage and retrieval.
