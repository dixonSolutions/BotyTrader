# TUI (Ink)

The **BotyTrader** terminal UI is built with **Ink** (React for terminal UIs). It displays orchestrator and agent state and sends **commands** to the orchestrator (never bypassing backend validation when a remote API exists).

## Screens

| Screen | Purpose |
|--------|---------|
| **Setup** | First-run and credential-reset wizard. Appears automatically on startup when any required `.env` key is missing; always reachable from any screen via `s`. |
| **Dashboard** | High-level status: connection, last cycle, PnL snapshot, alerts. |
| **Watchlist** | Symbols under management; edit list (persisted via `config.toml`). |
| **Agent Log** | Stream of agent reasoning steps, tool calls, and errors (truncated/pretty-printed). |
| **Memory** | Recent retrievals, stored summaries, sync status with Hugging Face. |
| **Config** | View/edit non-secret preferences (embedding model id, risk thresholds, broker platform, schedule). Use `/` to search across Settings, Secrets, and Schedule; use `f` to filter rows on the active sub-tab. |
| **Secrets** | View which `.env` keys are set (values masked). Reset or re-enter any credential without leaving the TUI. |

Optional **Portfolio** screen may mirror broker positions (`Portfolio.tsx` in the intended tree).

## Navigation

- Tab or key-based switching between `[Dashboard] [Watchlist] [Agent Log] [Memory] [Config] [Secrets]`.
- Press `s` from any screen to open the **Secrets** screen and reset credentials at any time.
- Keep **choice overload** low: primary actions visible per screen; advanced options behind a single "Advanced" or config file.

### Setup wizard (automatic on missing secrets)

On startup, `SecretsSchema` validates every required `.env` key. If any key is absent or empty the app **does not crash** — it opens the **Setup** screen instead. The wizard:

1. Lists each missing key with a short description of what it is and where to obtain it.
2. Shows a masked input field for each key.
3. Writes accepted values to `.env` (creating the file if it does not exist).
4. Re-validates and launches normally once all required keys pass.

This means you can skip the manual `.env` copy step entirely — just run the app and let the TUI guide you.

### Resetting credentials

If an API key stops working (rotated, expired, or entered incorrectly) open the **Secrets** screen (`s` from any screen):

1. Navigate to the key you want to change.
2. Press `Enter` to edit — the current value is cleared and a masked input appears.
3. Type the new value and confirm with `Enter`.
4. The orchestrator reloads secrets in place without a full restart.

You never need to manually edit `.env` to fix a broken credential.

## State flow

```
┌──────────┐     subscribe / poll      ┌───────────────┐
│   TUI    │ ◄─────────────────────── │ Orchestrator  │
│ app.tsx  │ ── commands (keyboard) ─►│ (state owner) │
└──────────┘                           └───────────────┘
```

- **TUI renders** snapshots from orchestrator state (and optional log buffer).
- **TUI sends** intents: e.g. "reload config", "pause cycles", "run watchlist symbol now", "reload secrets" — the orchestrator enforces permissions and schedules.

## Files (intended)

```
src/tui/
├── app.tsx              ← root Ink app, routing between screens
└── screens/
    ├── Setup.tsx        ← startup wizard and credential reset
    ├── Dashboard.tsx
    ├── Watchlist.tsx
    ├── AgentLog.tsx
    ├── Memory.tsx
    ├── Portfolio.tsx
    ├── Config.tsx
    └── Secrets.tsx      ← masked view + edit for .env keys
```

## UX principles (project)

- **Consistency:** Same keybindings and labels across screens.
- **Hierarchy:** One clear title per screen; secondary info in panels.
- **Whitespace:** Avoid dense walls of text; chunk logs in Agent Log.
- **Feedback:** Under 400ms response where possible for local actions (Doherty threshold); show loading for network.

## Insights → Agent session panel

The **Insights** screen includes an **Agent session** strip (below vitals) that shows:

- **Previous run** — summary from the last time you quit the app (`q`), written to `.botytrader-last-session.json` (gitignored).
- **Next automatic cycle** — countdown from the scheduler (`config.toml` interval); shows paused / empty-watchlist states.
- **Right now** — live phase while a cycle runs (RAG, tool calls, decision).
- **Latest reasoning** — full reasoning string from the most recently completed cycle.

Manual run: from Insights, press **`n`** to run the agent immediately for the **focus symbol** (change symbol with **Tab** / **Shift+Tab**).

**System logs** show a **virtual viewport** (newest at top). Use **`[`** / **`]`** to scroll one line older/newer, **PgUp** / **PgDn** for a page, **`0`** to jump back to the newest tail.

## Related docs

- [Architecture](architecture.md) — TUI in the system diagram.
- [Configuration](configuration.md) — `.env` secrets, setup wizard flow, and `SecretsSchema`.
