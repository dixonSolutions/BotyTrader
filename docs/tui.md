# TUI (Ink + pointer)

The **BotyTrader** terminal UI is built with **Ink** (React for terminal UIs) and **[@zenobius/ink-mouse](https://github.com/zenobi-us/ink-mouse)** for pointer hit-testing. The root `render()` in `src/index.tsx` wraps the app in `<MouseProvider>` so buttons, rows, and tabs respond to the terminal’s mouse protocol. Ink only enables **TTY raw mode** while some `useInput` hook is active; without that, SGR pointer bytes can **echo** visibly (e.g. on **Home**, which has no text field). A no-op `useInput` in `index.tsx` keeps stdin raw for the whole session so that noise does not appear.

**Interaction model:** primary actions are **clickable** (filled pill buttons, tab strips, and list rows). **Typing** is still used where free-form text is required (`SafeTextInput` — same UX as ink-text-input, but ignores SGR mouse bytes that would otherwise be appended while a field is focused — search fields, secret values, model ids, etc.). A terminal with **SGR mouse reporting** (e.g. modern VS Code, iTerm, Windows Terminal, most Linux VTE) is required for clicks; SSH/tmux can work if mouse mode is forwarded, but behaviour varies by environment.

**Hit-testing:** Bounds are **derived from the same yoga getters Ink uses when painting** (`getComputedLeft` / `getComputedTop` / `getComputedWidth` / `getComputedHeight`, summed from `ink-root` down to the element — same idea as `ink/build/render-node-to-output.js`). `usePointerTarget` recomputes that box on every pointer move/press, passes the live **`stdout.columns` / `stdout.rows`** viewport into hit tests (clamp SGR cells to the terminal grid), and rebinds when the terminal resizes. SGR `Px`/`Py` are shifted by an **origin** (default **1,1** for xterm 1-based cells); set **`BOTYTRADER_POINTER_ORIGIN=0`** or **`dx,dy`** if your terminal differs.

**Alternate screen:** On a normal shell, Ink’s first row can start **below the prompt** while the mouse still reports **viewport** coordinates from the top — hits look permanently wrong. `AlternateScreen` (`\x1b[?1049h`) switches to the alternate buffer so the TUI starts at the terminal origin. Disable with **`BOTYTRADER_NO_ALT_SCREEN=1`** if your environment breaks on alt-screen (some embedded terminals).

The TUI **displays** orchestrator and agent state and sends **intents** to the orchestrator (orders, config writes, model operations), which keeps validation and permissions on the backend. This matches “security at the API level” — the TUI is not a second authority.

## Screens (current `src/tui/`)

| Area | Purpose |
|------|--------|
| **Home** | Choose **Insights**, **Alpaca Search**, or **Config**; **Quit** exits the app. |
| **Setup** | First-run / missing `.env` keys — masked `TextInput` for each key. |
| **Insights** | **Portfolio** tab: summary strip, vitals, balances, holdings, recent orders, performance, market context. **Bot** tab: DB signals, optimizer + engine status, actions (trading / optimizer / LLM / pause / ping), orchestrator logs, embedded trading vs optimizer log debugging. |
| **Config** | Sub-tabs: **Settings**, **Trading**, **Models** (FinBERT [ProsusAI/finbert](https://huggingface.co/ProsusAI/finbert) only — provider, warm, agent blend ±), **Secrets**, **Schedule**. **Search all tabs** opens a global search panel; each sub-tab can **Filter** rows where shown. |

## Navigation

- **Header** — On every screen except **Home**, **Back** is its **own row** under the chrome (secondary pill + icon) so it stays visible on dense dashboards; the next row is **BotyTrader** + breadcrumb and broker status. **Back** returns to **Home** from Insights / Config / Alpaca Search; on **Setup**, it goes to the previous secret step or exits on the first step (and matches **Continue** when there is nothing to configure). The divider uses live **`stdout.columns`**.
- **Tabs** — click the pill for each Config sub-tab (Settings, Trading, Models, …).
- **Home** — click a large card to open a route, or **Quit** to exit. Channel log debugging is under **Insights → Bot** (not a separate Home card).

No global keyboard shortcuts are documented for these flows; use the on-screen controls. Text fields continue to support normal keyboard entry and **Enter** to submit where `onSubmit` is wired on the text field.

## State flow

```
┌──────────┐     subscribe / poll      ┌───────────────┐
│   TUI    │ ◄─────────────────────── │ Orchestrator  │
│ app.tsx  │ ◄─ intents (clicks) ─────►│ (state owner)  │
└──────────┘                           └───────────────┘
```

## Files (approximate)

```
src/tui/
├── app.tsx                 ← root routing (Home, Insights, Alpaca Search, Config)
├── theme.ts
├── components/
│   ├── Layout.tsx          ← Header (Back), Footer, ScreenFrame, Panel
│   ├── Button.tsx
│   ├── IconButton.tsx
│   ├── TabBarClickable.tsx
│   ├── ClickableRow.tsx
│   └── icons.ts
└── screens/
    ├── Home.tsx
    ├── Setup.tsx
    ├── debugging/          ← DebuggingPanel (embedded in Insights → Bot)
    ├── config/             ← Config, FinbertModelsEditor (Models tab), editors, …
    └── insights/           ← Insights tabs, holdings, signals, RecentOrdersTable, …
```

## UX principles (project)

- **Consistency:** Shared `Button` / `TabBarClickable` / `ClickableRow` and `theme` tokens.
- **Hierarchy:** One clear title per screen; secondary info in panels.
- **Chunking:** Insights splits **Portfolio** vs **Bot**; actions and debug logs live on **Bot**.
- **Feedback:** Show busy states where the orchestrator runs async work.

## Related docs

- [Architecture](architecture.md) — TUI in the system diagram.
- [Configuration](configuration.md) — `.env` secrets, setup wizard, `SecretsSchema`.
- [Models & inference](models.md) — reasoning `[model]` vs FinBERT `[sentiment]` (Config → Models tab).
