# TUI (Ink)

The **BotyTrader** terminal UI is built with **Ink** (React for terminal UIs). It displays orchestrator and agent state and sends **commands** to the orchestrator (never bypassing backend validation when a remote API exists).

## Screens

| Screen | Purpose |
|--------|---------|
| **Dashboard** | High-level status: connection, last cycle, PnL snapshot, alerts. |
| **Watchlist** | Symbols under management; edit list (persisted via `config.toml`). |
| **Agent Log** | Stream of agent reasoning steps, tool calls, and errors (truncated/pretty-printed). |
| **Memory** | Recent retrievals, stored summaries, sync status with Hugging Face. |
| **Config** | View/edit non-secret preferences (embedding model id, risk thresholds, broker platform, schedule). Secrets remain in `.env` only. |

Optional **Portfolio** screen may mirror broker positions (`Portfolio.tsx` in the intended tree).

## Navigation

- Tab or key-based switching between `[Dashboard] [Watchlist] [Agent Log] [Memory] [Config]`.
- Keep **choice overload** low: primary actions visible per screen; advanced options behind a single “Advanced” or config file.

## State flow

```
┌──────────┐     subscribe / poll      ┌───────────────┐
│   TUI    │ ◄─────────────────────── │ Orchestrator  │
│ app.tsx  │ ── commands (keyboard) ─►│ (state owner) │
└──────────┘                           └───────────────┘
```

- **TUI renders** snapshots from orchestrator state (and optional log buffer).
- **TUI sends** intents: e.g. “reload config”, “pause cycles”, “run watchlist symbol now” — the orchestrator enforces permissions and schedules.

## Files (intended)

```
src/tui/
├── app.tsx              ← root Ink app, routing between screens
└── screens/
    ├── Dashboard.tsx
    ├── Watchlist.tsx
    ├── AgentLog.tsx
    ├── Memory.tsx
    ├── Portfolio.tsx
    └── Config.tsx
```

## UX principles (project)

- **Consistency:** Same keybindings and labels across screens.
- **Hierarchy:** One clear title per screen; secondary info in panels.
- **Whitespace:** Avoid dense walls of text; chunk logs in Agent Log.
- **Feedback:** Under 400ms response where possible for local actions (Doherty threshold); show loading for network.

## Related docs

- [Architecture](architecture.md) — TUI in the system diagram.
- [Configuration](configuration.md) — what belongs in TUI vs `.env`.
