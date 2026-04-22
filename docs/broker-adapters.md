# Broker adapters

All live trading and read-only account data go through a **`BrokerAdapter`** interface so the orchestrator, MCP tools, and execution layer stay **broker-agnostic**.

## Interface (conceptual)

Located at `src/execution/broker.ts`. Implementations must support at least:

- **Orders:** `submitOrder` (market/limit as policy allows), cancel where applicable.
- **Account / portfolio:** Positions, buying power, equity (for `get_portfolio_state` tools).
- **Market data (optional per broker):** Bars, quotes — or delegate to a dedicated market data client (e.g. Alpaca data API).

Exact method names and types are defined in code; documentation here describes responsibilities.

## Adapters

| Adapter | File | Typical use |
|---------|------|-------------|
| Alpaca | `adapters/alpaca.ts` | Paper and live US equities (keys in `.env`). Market data uses Alpaca’s **`feed=iex`** path so free/paper accounts are not charged for SIP-only bars/quotes. |
| Coinbase | `adapters/coinbase.ts` | Spot crypto (if implemented). |
| Binance | `adapters/binance.ts` | Spot/futures per scope (if implemented). |

**Configuration:** `broker.platform` in `config.toml` selects which adapter is constructed — see [Configuration](configuration.md).

## Environment variables

| Adapter | Required when active |
|---------|----------------------|
| Alpaca | `ALPACA_API_KEY`, `ALPACA_API_SECRET` |
| Coinbase | `COINBASE_API_KEY`, `COINBASE_API_SECRET` |
| Binance | `BINANCE_API_KEY`, `BINANCE_API_SECRET` |

Optional keys are ignored when that broker is not selected.

## Exit monitor

`src/execution/exit_monitor.ts` runs a **separate loop** (or scheduled task) from the main agent:

- Watch open positions for **stop-loss** / **take-profit** rules from `config.toml` (risk section).
- Emit closes via the same `BrokerAdapter` without going through the LLM each time (configurable behavior).

Keep exit logic **deterministic** and auditable; do not rely solely on the LLM for emergency exits if policy requires hard stops.

## MCP tools and adapters

- `market.ts` tools may use the broker’s market data API or a shared data client.
- `portfolio.ts` tools **must** use the adapter so paper vs live and account selection stay consistent.

## Related docs

- [Architecture](architecture.md) — Executor and agent split.
- [Configuration](configuration.md) — broker platform and risk.
- [Development](development.md) — running with paper trading first.
