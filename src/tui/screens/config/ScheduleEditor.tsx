/**
 * Schedule editor — change how often the bot runs. Pointer rows + value editing.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { writeConfig } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

const FIELDS = [
  { id: "agent", label: "Agent cycle interval (seconds)" },
  { id: "exit", label: "Exit monitor interval (seconds)" },
  { id: "portfolio", label: "Portfolio trading cycle (seconds)" },
  { id: "candidate", label: "Watchlist / candidate cycle (seconds)" },
  { id: "discovery", label: "Discovery cycle (seconds)" },
] as const;

type FieldId = (typeof FIELDS)[number]["id"];

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
      const val = currentValue(field.id, config);
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
    setEditing(true);
    setDraft(currentValue(field.id, config).toString());
  }

  function commit(): void {
    const field = visibleFields[selectedIdx];
    if (!field) return;
    const n = Number(draft.trim());
    setEditing(false);
    setDraft("");
    if (!Number.isFinite(n) || n < 1) return;
    if (field.id === "agent") {
      orchestrator.setAgentInterval(n);
    } else if (field.id === "exit") {
      config.schedule.exit_monitor_interval_seconds = Math.floor(n);
      writeConfig(config);
    } else if (field.id === "portfolio") {
      orchestrator.setTradingCycleInterval("portfolio", n);
    } else if (field.id === "candidate") {
      orchestrator.setTradingCycleInterval("candidate", n);
    } else {
      orchestrator.setTradingCycleInterval("discovery", n);
    }
  }

  return (
    <Panel>
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
          <ClickableRow
            key={field.id}
            selected={i === selectedIdx}
            onClick={() => {
              if (editing) return;
              startEdit(i);
            }}
          >
            <Text>
              <Text color={i === selectedIdx ? theme.color.accent : theme.color.text}>
                {field.label.padEnd(36)}
              </Text>
              <Text> {currentValue(field.id, config)}s</Text>
            </Text>
          </ClickableRow>
        ))
      )}
      {editing ? (
        <Box marginTop={1} flexDirection="row" flexWrap="wrap">
          <Text color={theme.color.primary}>Seconds: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
          <Box marginLeft={1}>
            <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            Click a row to edit seconds. Shorter intervals burn more API quota. 60–300s is typical.
          </Text>
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
  switch (field) {
    case "agent":
      return config.schedule.agent_interval_seconds;
    case "exit":
      return config.schedule.exit_monitor_interval_seconds;
    case "portfolio":
      return config.schedule.portfolio_cycle_seconds;
    case "candidate":
      return config.schedule.candidate_cycle_seconds;
    case "discovery":
      // Use new discovery config if enabled, otherwise fall back to schedule
      return config.discovery?.enabled
        ? (config.discovery.scan_interval_seconds ?? config.schedule.discovery_cycle_seconds)
        : config.schedule.discovery_cycle_seconds;
  }
}
