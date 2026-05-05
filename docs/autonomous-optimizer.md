# Autonomous optimizer

The optimizer division records **feature snapshots** (per-indicator scores and weights at decision time), backfills **price outcomes** from SQLite `price_history`, and periodically runs a **walk-forward** search over challenger weight sets and execution parameters.

## Data flow

1. **Observe** — When `[optimization].enabled` is true and the simple strategy has a full 10-indicator breakdown (80+ daily bars), the engine writes a row to `feature_snapshots` for strong candidates (`hybrid >= buy_threshold`) and **shadow** near-misses (within `shadow_capture_range` below the threshold).
2. **Outcomes** — On `outcome_monitor_interval_minutes`, the orchestrator fills `outcome_pct_change` once `exit_window_hours` have passed, using daily closes from `price_history`.
3. **Optimize** — On `schedule_day` / `schedule_hour` (local time), the bot loads snapshots with outcomes in the last `lookback_days`, backtests the champion vs `challenger_count` mutated bundles, applies **gates** (improvement vs champion, max single weight, optional stress window), then blends the winner into config with **learning_rate** α and persists `config.toml`.

## SQLite tables

| Table                 | Purpose                                      |
|-----------------------|----------------------------------------------|
| `feature_snapshots`   | Per-symbol scores, weights, hybrid, outcome |
| `optimization_runs`   | Audit log of each cycle                      |
| `weight_history`      | Post-update weight / param snapshot         |

## Config

See `[optimization]` in `config.example.toml`. Tuning is available under **Config → Optimize** and status under **Insights → Autonomous optimizer**.

## Safety

- Config updates only pass strict gates; failed runs are logged as `skipped` in `optimization_runs`.
- **Stress test** re-evaluates champion vs winner on the worst contiguous 7-day window in the lookback slice (minimum PnL for the champion).
