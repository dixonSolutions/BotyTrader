/**
 * Autonomous optimizer — snapshots, walk-forward schedule, safety gates.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { Toggle } from "../../components/Toggle.js";
import { Select } from "../../components/Select.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator } from "../../../orchestrator.js";

const SCHEDULE_DAYS = [
  "daily",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

type RowId =
  | "schedule_day"
  | "schedule_hour"
  | "lookback"
  | "challengers"
  | "learning_rate"
  | "mutation"
  | "improvement"
  | "max_weight"
  | "exit_window"
  | "shadow_range"
  | "min_snapshots"
  | "outcome_interval";

const ROWS: { id: RowId; label: string; hint?: string }[] = [
  { id: "schedule_day", label: "Schedule day (click to cycle)" },
  { id: "schedule_hour", label: "Run hour (local, 0–23)" },
  { id: "lookback", label: "Lookback days" },
  { id: "challengers", label: "Challenger count" },
  { id: "learning_rate", label: "Learning rate α (0–1)" },
  { id: "mutation", label: "Mutation rate" },
  { id: "improvement", label: "Min improvement vs champion (0–1)" },
  { id: "max_weight", label: "Max single indicator weight (0–1)" },
  { id: "exit_window", label: "Snapshot outcome window (hours)" },
  { id: "shadow_range", label: "Shadow capture range (0–1)" },
  { id: "min_snapshots", label: "Min snapshots before optimize" },
  { id: "outcome_interval", label: "Outcome backfill interval (min)" },
];

function valueForRow(id: RowId, o: Orchestrator): string {
  const c = o.config.optimization;
  switch (id) {
    case "schedule_day":
      return c.schedule_day;
    case "schedule_hour":
      return String(c.schedule_hour);
    case "lookback":
      return String(c.lookback_days);
    case "challengers":
      return String(c.challenger_count);
    case "learning_rate":
      return String(c.learning_rate);
    case "mutation":
      return String(c.mutation_rate);
    case "improvement":
      return String(c.improvement_threshold);
    case "max_weight":
      return String(c.max_single_weight);
    case "exit_window":
      return String(c.exit_window_hours);
    case "shadow_range":
      return String(c.shadow_capture_range);
    case "min_snapshots":
      return String(c.min_snapshots);
    case "outcome_interval":
      return String(c.outcome_monitor_interval_minutes);
    default:
      return "";
  }
}

export function OptimizationEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const trading = orchestrator.getState().trading;
  const summary = trading.optimization;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  useEffect(() => {
    if (focusRowId == null) return;
    const j = ROWS.findIndex((r) => r.id === focusRowId);
    if (j >= 0) setSelectedIdx(j);
    consumeRef.current?.();
  }, [focusRowId]);

  function startEdit(i: number): void {
    const row = ROWS[i];
    if (!row) return;
    setSelectedIdx(i);
    // schedule_day is now handled by the inline Select component
    if (row.id === "schedule_day") return;
    setEditing(true);
    setDraft(valueForRow(row.id, orchestrator));
  }

  function commit(): void {
    const row = ROWS[selectedIdx];
    if (!row) return;
    setEditing(false);
    const n = Number(draft.trim());
    if (!Number.isFinite(n)) {
      setDraft("");
      return;
    }
    const id = row.id;
    switch (id) {
      case "schedule_hour":
        orchestrator.setOptimizationScheduleHour(n);
        break;
      case "lookback":
        orchestrator.setOptimizationNumeric("lookback_days", n);
        break;
      case "challengers":
        orchestrator.setOptimizationNumeric("challenger_count", n);
        break;
      case "learning_rate":
        orchestrator.setOptimizationNumeric("learning_rate", n);
        break;
      case "mutation":
        orchestrator.setOptimizationNumeric("mutation_rate", n);
        break;
      case "improvement":
        orchestrator.setOptimizationNumeric("improvement_threshold", n);
        break;
      case "max_weight":
        orchestrator.setOptimizationNumeric("max_single_weight", n);
        break;
      case "exit_window":
        orchestrator.setOptimizationNumeric("exit_window_hours", n);
        break;
      case "shadow_range":
        orchestrator.setOptimizationNumeric("shadow_capture_range", n);
        break;
      case "min_snapshots":
        orchestrator.setOptimizationNumeric("min_snapshots", n);
        break;
      case "outcome_interval":
        orchestrator.setOptimizationNumeric("outcome_monitor_interval_minutes", n);
        break;
      default:
        break;
    }
    setDraft("");
  }

  return (
    <Panel>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.color.primary}>
          Autonomous optimizer
        </Text>
        <Text color={theme.color.muted}>
          Feature snapshots, walk-forward challengers, learning-rate config updates. Requires trading DB + bars.
        </Text>
      </Box>

      <Box marginBottom={1} flexDirection="row" flexWrap="wrap" alignItems="center">
        <Toggle
          leading={<Text color={theme.color.muted}>Optimizer </Text>}
          enabled={config.optimization.enabled}
          onToggle={() => orchestrator.setOptimizationEnabled(!config.optimization.enabled)}
        />
        <Toggle
          leading={<Text color={theme.color.muted}> · Stress test </Text>}
          enabled={config.optimization.stress_test_enabled}
          onToggle={() => orchestrator.setOptimizationStressTestEnabled(!config.optimization.stress_test_enabled)}
        />
      </Box>

      {ROWS.map((row, i) => (
        <ClickableRow
          key={row.id}
          selected={i === selectedIdx}
          onClick={() => {
            if (editing) return;
            startEdit(i);
          }}
          detail={row.hint}
        >
          <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-start" width="100%">
            <Box minWidth={12} width="55%" maxWidth={48} flexShrink={1}>
              <Text
                wrap="truncate-end"
                color={i === selectedIdx ? theme.color.accent : theme.color.text}
              >
                {row.label}
              </Text>
            </Box>
            <Box marginLeft={1} flexShrink={0}>
              {row.id === "schedule_day" ? (
                <Select
                  options={SCHEDULE_DAYS}
                  value={config.optimization.schedule_day as ScheduleDay}
                  onChange={(next) => orchestrator.setOptimizationScheduleDay(next)}
                  width={14}
                />
              ) : (
                <Text wrap="truncate-end">{valueForRow(row.id, orchestrator)}</Text>
              )}
            </Box>
          </Box>
        </ClickableRow>
      ))}

      {editing ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>{ROWS[selectedIdx]?.hint ?? "Edit value"}</Text>
          <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
            <Text color={theme.color.primary}>Value: </Text>
            <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
            <Box marginLeft={1}>
              <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
            </Box>
          </Box>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="row" flexWrap="wrap">
        <Button
          label="Run optimization now"
          icon={icons.play}
          onClick={() => void orchestrator.runOptimizationNow()}
          variant="secondary"
          minWidth={22}
        />
      </Box>

      <Box marginTop={2} flexDirection="column" borderStyle="round" borderColor={theme.color.muted} paddingX={1}>
        <Text bold color={theme.color.accent}>
          Optimizer status
        </Text>
        <StatRow
          label="Snapshots (total / outcomes / shadow)"
          value={summary ? `${summary.snapshotTotal} / ${summary.snapshotsWithOutcome} / ${summary.shadowCount}` : "—"}
        />
        <StatRow label="Last run" value={summary?.lastRunAt ?? "—"} />
        <StatRow label="Last status" value={summary?.lastStatus ?? "—"} />
        <StatRow
          label="Improvement last"
          value={summary?.lastImprovementPct != null ? `${(summary.lastImprovementPct * 100).toFixed(1)}%` : "—"}
        />
        <StatRow label="Schedule hint" value={summary?.nextScheduledHint ?? "—"} />
        {summary?.lastNotes ? (
          <Text color={theme.color.muted} wrap="truncate">
            Notes: {summary.lastNotes}
          </Text>
        ) : null}
      </Box>
    </Panel>
  );
}
