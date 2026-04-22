/**
 * Schedule editor — change how often the bot runs without restarting.
 *
 * Both intervals are in seconds. The agent interval reschedules immediately
 * via `orchestrator.setAgentInterval`; the exit-monitor interval is written
 * to config.toml and takes effect on next monitor restart (pause/resume).
 *
 * `/` opens global search (all tabs). `f` toggles in-tab filter.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { Panel, StatRow } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { writeConfig } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
  onOpenGlobalSearch?: () => void;
}

const FIELDS = [
  { id: "agent", label: "Agent cycle interval (seconds)" },
  { id: "exit", label: "Exit monitor interval (seconds)" },
] as const;

type FieldId = (typeof FIELDS)[number]["id"];

export function ScheduleEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
  onOpenGlobalSearch,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;

  const visibleFields = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return FIELDS.filter((field) => {
      if (!filterMode || !q) return true;
      const val = currentValue(field.id, config);
      const hay = `${field.label} ${field.id} ${val}`.toLowerCase();
      return hay.includes(q);
    });
  }, [config, filterMode, filterQuery]);

  useEffect(() => {
    if (focusRowId == null) return;
    setFilterMode(false);
    setFilterQuery("");
    const idx = FIELDS.findIndex((f) => f.id === focusRowId);
    if (idx >= 0) setCursor(idx);
    consumeRef.current?.();
  }, [focusRowId]);

  useInput(
    (input, key) => {
      if (editing) return;
      if (filterMode) {
        if (input === "f") {
          setFilterMode(false);
          setFilterQuery("");
          return;
        }
        if (key.backspace || key.delete) {
          setFilterQuery((q) => q.slice(0, -1));
          setCursor(0);
          return;
        }
        if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
        else if (key.downArrow) setCursor((c) => Math.min(visibleFields.length - 1, c + 1));
        else if (key.return) {
          const field = visibleFields[cursor];
          if (field) {
            setEditing(true);
            setDraft(currentValue(field.id, config).toString());
          }
        } else if (input && !key.ctrl && !key.meta && input.length === 1) {
          setFilterQuery((q) => q + input);
          setCursor(0);
        }
        return;
      }
      if (input === "/") {
        onOpenGlobalSearch?.();
        return;
      }
      if (input === "f") {
        setFilterMode(true);
        setFilterQuery("");
        setCursor(0);
        return;
      }
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow) setCursor((c) => Math.min(visibleFields.length - 1, c + 1));
      else if (key.return) {
        const field = visibleFields[cursor];
        if (field) {
          setEditing(true);
          setDraft(currentValue(field.id, config).toString());
        }
      }
    },
    { isActive: active },
  );

  function commit(): void {
    const field = visibleFields[cursor];
    if (!field) return;
    const n = Number(draft.trim());
    setEditing(false);
    setDraft("");
    if (!Number.isFinite(n) || n < 1) return;
    if (field.id === "agent") {
      orchestrator.setAgentInterval(n);
    } else {
      config.schedule.exit_monitor_interval_seconds = Math.floor(n);
      writeConfig(config);
    }
  }

  return (
    <Panel>
      {filterMode ? (
        <Box marginBottom={1}>
          <Text color={theme.color.accent}>Filter: </Text>
          <Text color={theme.color.text}>{filterQuery.length ? filterQuery : "(type to narrow)"}</Text>
        </Box>
      ) : null}
      {visibleFields.length === 0 ? (
        <Text color={theme.color.muted}>No schedule rows match this filter.</Text>
      ) : (
        visibleFields.map((field, i) => (
          <Box key={field.id}>
            <Text color={i === cursor ? theme.color.accent : theme.color.text}>
              {i === cursor ? "› " : "  "}
              {field.label.padEnd(36)}
            </Text>
            <Text>{currentValue(field.id, config)}s</Text>
          </Box>
        ))
      )}
      {editing ? (
        <Box marginTop={1}>
          <Text color={theme.color.primary}>Seconds: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            {filterMode
              ? "type filter · f exit filter · ↑/↓ · Enter edit"
              : "↑/↓ select · Enter edit · / search all · f filter"}
          </Text>
          <Box marginTop={1}>
            <Text color={theme.color.muted}>
              Hint: shorter intervals burn more API quota. 60-300s is sane for most setups.
            </Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <StatRow label="Status" value={orchestrator.getState().status} />
        <StatRow label="Last cycle" value={orchestrator.getState().lastCycleAt ?? "—"} />
      </Box>
    </Panel>
  );
}

function currentValue(field: FieldId, config: Orchestrator["config"]): number {
  return field === "agent"
    ? config.schedule.agent_interval_seconds
    : config.schedule.exit_monitor_interval_seconds;
}
