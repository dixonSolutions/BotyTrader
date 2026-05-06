/**
 * Schedule editor — trading cycles, exit monitor, agent cadence, optimizer run windows.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { Select } from "../../components/Select.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

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

type FieldKind = "seconds" | "minutes" | "hour" | "day";

type FieldId =
  | "exit"
  | "portfolio"
  | "candidate"
  | "agent_interval"
  | "schedule_day"
  | "schedule_hour"
  | "outcome_interval";

interface FieldRow {
  id: FieldId;
  label: string;
  kind: FieldKind;
  sectionBanner?: string;
}

const FIELDS: FieldRow[] = [
  { id: "exit", label: "Exit monitor interval (seconds)", kind: "seconds", sectionBanner: "Trading & exits" },
  { id: "portfolio", label: "Portfolio trading cycle (seconds)", kind: "seconds" },
  { id: "candidate", label: "Watchlist / candidate cycle (seconds)", kind: "seconds" },
  {
    id: "agent_interval",
    label: "Agent / LLM cycle interval (seconds)",
    kind: "seconds",
    sectionBanner: "Agent",
  },
  {
    id: "schedule_day",
    label: "Optimizer run day (local)",
    kind: "day",
    sectionBanner: "Autonomous optimizer",
  },
  { id: "schedule_hour", label: "Optimizer run hour (local, 0–23)", kind: "hour" },
  { id: "outcome_interval", label: "Optimizer outcome backfill (minutes)", kind: "minutes" },
];

export function ScheduleEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  const visibleFields = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return FIELDS.filter((field) => {
      if (!filterMode || !q) return true;
      const val = displayValue(field.id, config);
      const hay = `${field.label} ${field.id} ${val}`.toLowerCase();
      return hay.includes(q);
    });
  }, [config, filterMode, filterQuery]);

  useEffect(() => {
    if (focusRowId == null) return;
    setFilterMode(false);
    setFilterQuery("");
  }, [focusRowId]);

  useEffect(() => {
    if (focusRowId == null) return;
    const j = visibleFields.findIndex((f) => f.id === focusRowId);
    if (j >= 0) setSelectedIdx(j);
    consumeRef.current?.();
  }, [focusRowId, visibleFields]);

  function startEdit(i: number): void {
    const field = visibleFields[i];
    if (!field) return;
    setSelectedIdx(i);
    if (field.kind === "day") return;
    setEditing(true);
    setDraft(displayValue(field.id, config));
  }

  function commit(): void {
    const field = visibleFields[selectedIdx];
    if (!field || field.kind === "day") return;
    setEditing(false);
    const raw = draft.trim();
    const n = Number(raw);
    setDraft("");

    if (field.kind === "hour") {
      if (!Number.isFinite(n) || n < 0 || n > 23) return;
      orchestrator.setOptimizationScheduleHour(Math.floor(n));
      return;
    }

    if (field.kind === "minutes") {
      if (!Number.isFinite(n) || n < 1) return;
      orchestrator.setOptimizationNumeric("outcome_monitor_interval_minutes", n);
      return;
    }

    // seconds
    if (!Number.isFinite(n) || n < 1) return;
    if (field.id === "exit") {
      orchestrator.setExitMonitorIntervalSeconds(n);
    } else if (field.id === "portfolio") {
      orchestrator.setTradingCycleInterval("portfolio", n);
    } else if (field.id === "candidate") {
      orchestrator.setTradingCycleInterval("candidate", n);
    } else if (field.id === "agent_interval") {
      orchestrator.setAgentIntervalSeconds(n);
    }
  }

  const selectedField = visibleFields[selectedIdx];

  return (
    <Panel>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.color.primary}>
          Schedules
        </Text>
        <Text color={theme.color.muted}>
          Intervals for the trading engine, exit monitor, agent cadence, and when the autonomous optimizer runs.
        </Text>
      </Box>
      <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
        <Button
          label={filterMode ? "Done filtering" : "Filter rows"}
          icon={filterMode ? icons.close : icons.search}
          onClick={() => {
            if (filterMode) {
              setFilterMode(false);
              setFilterQuery("");
            } else {
              setFilterMode(true);
              setFilterQuery("");
            }
          }}
          variant="secondary"
        />
      </Box>
      {filterMode ? (
        <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
          <Text color={theme.color.accent}>Narrow: </Text>
          <TextInput value={filterQuery} onChange={setFilterQuery} />
        </Box>
      ) : null}
      {visibleFields.length === 0 ? (
        <Text color={theme.color.muted}>No schedule rows match this filter.</Text>
      ) : (
        visibleFields.map((field, i) => (
          <Box key={field.id} flexDirection="column">
            {field.sectionBanner ? (
              <Box marginTop={i > 0 ? 1 : 0} marginBottom={0}>
                <Text bold color={theme.color.accent}>
                  {field.sectionBanner}
                </Text>
              </Box>
            ) : null}
            <ClickableRow
              selected={i === selectedIdx}
              onClick={() => {
                if (editing) return;
                startEdit(i);
              }}
            >
              <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-start" width="100%">
                <Box minWidth={12} width="55%" maxWidth={46} flexShrink={1}>
                  <Text
                    wrap="truncate-end"
                    color={i === selectedIdx ? theme.color.accent : theme.color.text}
                  >
                    {field.label}
                  </Text>
                </Box>
                <Box marginLeft={1} flexShrink={0}>
                  {field.kind === "day" ? (
                    <Select
                      options={SCHEDULE_DAYS}
                      value={config.optimization.schedule_day as ScheduleDay}
                      onChange={(next) => orchestrator.setOptimizationScheduleDay(next)}
                      width={14}
                    />
                  ) : (
                    <Text wrap="truncate-end">{displayValue(field.id, config)}</Text>
                  )}
                </Box>
              </Box>
            </ClickableRow>
          </Box>
        ))
      )}
      {editing && selectedField && selectedField.kind !== "day" ? (
        <Box marginTop={1} flexDirection="row" flexWrap="wrap">
          <Text color={theme.color.primary}>{editPrompt(selectedField.kind)} </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
          <Box marginLeft={1}>
            <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            Click a numeric row to edit. Shorter trading intervals use more API quota; 60–300s is typical for
            cycles. Optimizer hour uses local machine time (once per calendar day).
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <StatRow label="Status" value={orchestrator.getState().status} />
      </Box>
    </Panel>
  );
}

function editPrompt(kind: FieldKind): string {
  switch (kind) {
    case "seconds":
      return "Seconds:";
    case "minutes":
      return "Minutes:";
    case "hour":
      return "Hour (0–23):";
    default:
      return "Value:";
  }
}

function displayValue(id: FieldId, config: Orchestrator["config"]): string {
  switch (id) {
    case "exit":
      return String(config.schedule.exit_monitor_interval_seconds);
    case "portfolio":
      return String(config.schedule.portfolio_cycle_seconds);
    case "candidate":
      return String(config.schedule.candidate_cycle_seconds);
    case "agent_interval":
      return String(config.schedule.agent_interval_seconds);
    case "schedule_day":
      return config.optimization.schedule_day;
    case "schedule_hour":
      return String(config.optimization.schedule_hour);
    case "outcome_interval":
      return String(config.optimization.outcome_monitor_interval_minutes);
  }
}
