/**
 * Settings editor — non-secret config.toml fields.
 * Pointer: click a row to toggle / cycle / open editor; filter via toolbar.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { CheckboxGlyph } from "../../components/Toggle.js";
import { Select } from "../../components/Select.js";
import { Panel } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import {
  writeConfig,
  type BrokerPlatform,
  BrokerPlatformSchema,
} from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

type FieldKind = "bool" | "number" | "enum" | "list";

interface Field {
  id: string;
  label: string;
  kind: FieldKind;
  value: string;
  options?: string[];
}

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

const BROKER_OPTIONS = BrokerPlatformSchema.options;

function buildFields(config: Orchestrator["config"]): Field[] {
  return [
    { id: "autotrade", label: "Autotrade", kind: "bool", value: String(config.autotrade.enabled) },
    {
      id: "broker",
      label: "Broker platform",
      kind: "enum",
      value: config.broker.platform,
      options: BROKER_OPTIONS,
    },
    {
      id: "watchlist",
      label: "Symbols to trade (comma-separated)",
      kind: "list",
      value: config.watchlist.symbols.join(", "),
    },
    { id: "max_position_pct", label: "Max position %", kind: "number", value: String(config.risk.max_position_pct) },
    {
      id: "min_confidence_to_trade",
      label: "Min confidence to trade (0-1)",
      kind: "number",
      value: String(config.risk.min_confidence_to_trade),
    },
    { id: "stop_loss_pct", label: "Stop loss %", kind: "number", value: String(config.risk.stop_loss_pct) },
    { id: "take_profit_pct", label: "Take profit %", kind: "number", value: String(config.risk.take_profit_pct) },
  ];
}

export function SettingsEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const fields = buildFields(config);
  const [selectedVisibleIdx, setSelectedVisibleIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;
  // `active` reserved for parent (focus isolation); all interaction is pointer-based here.

  const visible = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return fields
      .map((f, sourceIndex) => ({ f, sourceIndex }))
      .filter(({ f }) => {
        if (!filterMode || !q) return true;
        const hay = `${f.label} ${f.id} ${f.value}`.toLowerCase();
        return hay.includes(q);
      });
  }, [fields, filterMode, filterQuery]);

  useEffect(() => {
    if (focusRowId == null) return;
    setFilterMode(false);
    setFilterQuery("");
  }, [focusRowId]);

  useEffect(() => {
    if (focusRowId == null) return;
    const j = visible.findIndex((v) => v.f.id === focusRowId);
    if (j >= 0) setSelectedVisibleIdx(j);
    consumeRef.current?.();
  }, [focusRowId, visible]);

  function handleActivate(field: Field): void {
    if (field.kind === "bool") {
      if (field.id === "autotrade") {
        orchestrator.setAutotrade(!config.autotrade.enabled);
      }
    } else if (field.kind === "enum") {
      // Enum fields are now handled by the inline Select component; nothing to do on row click.
    } else {
      setEditing(true);
      setDraft(field.value);
    }
  }

  function handleEnumChange(field: Field, next: string): void {
    if (field.id === "broker") {
      config.broker.platform = next as BrokerPlatform;
      writeConfig(config);
    }
  }

  function commit(): void {
    const field = visible[selectedVisibleIdx]?.f;
    if (!field) return;
    const raw = draft.trim();
    setEditing(false);
    setDraft("");

    switch (field.id) {
      case "watchlist":
        if (raw) orchestrator.setWatchlist(raw.split(/[\s,]+/));
        break;
      case "max_position_pct":
      case "min_confidence_to_trade":
      case "stop_loss_pct":
      case "take_profit_pct": {
        const n = Number(raw);
        if (raw && Number.isFinite(n)) orchestrator.setRiskField(field.id, n);
        break;
      }
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
      {visible.length === 0 ? (
        <Text color={theme.color.muted}>No rows match this filter.</Text>
      ) : (
        visible.map(({ f: field }, i) => (
          <ClickableRow
            key={field.id}
            selected={i === selectedVisibleIdx}
            onClick={() => {
              if (editing) return;
              setSelectedVisibleIdx(i);
              handleActivate(field);
            }}
          >
            <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-start" width="100%">
              <Box minWidth={12} width="55%" maxWidth={46} flexShrink={1}>
                <Text
                  wrap="truncate-end"
                  color={i === selectedVisibleIdx ? theme.color.accent : theme.color.text}
                >
                  {field.label}
                </Text>
              </Box>
              <Box marginLeft={1} flexShrink={0}>
                {field.kind === "bool" ? (
                  <CheckboxGlyph enabled={field.value === "true"} />
                ) : field.kind === "enum" ? (
                  <Select
                    options={(field.options ?? []) as readonly string[]}
                    value={field.value}
                    onChange={(next) => handleEnumChange(field, next)}
                    width={20}
                  />
                ) : (
                  <Text color={valueColor(field)} wrap="truncate-end">
                    {displayValue(field)}
                  </Text>
                )}
              </Box>
            </Box>
          </ClickableRow>
        ))
      )}
      {editing ? (
        <Box marginTop={1} flexDirection="row" flexWrap="wrap">
          <Text color={theme.color.primary}>New value: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
          <Box marginLeft={1}>
            <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            Click a row: toggle, cycle enum, or open value editor. Use Filter to narrow. Typing in the value field
            still uses the keyboard.
          </Text>
        </Box>
      )}
    </Panel>
  );
}

function displayValue(field: Field): string {
  if (field.kind === "bool") return field.value === "true" ? "ON" : "OFF";
  return field.value;
}

function valueColor(field: Field): string {
  if (field.kind === "bool") {
    return field.value === "true" ? theme.color.success : theme.color.warn;
  }
  return theme.color.text;
}
