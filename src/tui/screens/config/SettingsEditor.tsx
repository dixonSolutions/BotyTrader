/**
 * Settings editor — non-secret config.toml fields.
 *
 * Field types we support inline:
 *   - boolean : Enter toggles
 *   - enum    : Enter cycles to next option
 *   - number  : Enter opens a TextInput; submit writes back
 *   - list    : Enter opens a TextInput accepting comma-separated values
 *
 * `/` opens global search (all tabs). `f` toggles in-tab filter.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import {
  writeConfig,
  type BrokerPlatform,
  BrokerPlatformSchema,
  type Config,
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
  onOpenGlobalSearch?: () => void;
}

const BROKER_OPTIONS = BrokerPlatformSchema.options;

/** Order must match `buildFields` row order (for jump-to from global search). */
const SETTINGS_FIELD_IDS: readonly string[] = [
  "autotrade",
  "memory_enabled",
  "web_search_enabled",
  "broker",
  "watchlist",
  "max_position_pct",
  "min_confidence_to_trade",
  "stop_loss_pct",
  "take_profit_pct",
  "embedding_model",
  "active_model",
  "model_dtype",
  "model_device",
  "max_new_tokens",
  "hf_bucket",
];

function buildFields(config: Orchestrator["config"]): Field[] {
  return [
    { id: "autotrade", label: "Autotrade", kind: "bool", value: String(config.autotrade.enabled) },
    {
      id: "memory_enabled",
      label: "Memory (RAG + HF writes)",
      kind: "bool",
      value: String(config.features.memory_enabled),
    },
    {
      id: "web_search_enabled",
      label: "Web search (Brave tool)",
      kind: "bool",
      value: String(config.features.web_search_enabled),
    },
    {
      id: "broker",
      label: "Broker platform",
      kind: "enum",
      value: config.broker.platform,
      options: BROKER_OPTIONS,
    },
    {
      id: "watchlist",
      label: "Watchlist (comma-separated)",
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
    { id: "embedding_model", label: "Embedding model", kind: "list", value: config.gemini.embedding_model },
    {
      id: "active_model",
      label: "Active local model",
      kind: "list",
      value: config.model.id || "(none — open Models screen)",
    },
    {
      id: "model_dtype",
      label: "Model dtype (quantisation)",
      kind: "enum",
      value: config.model.dtype,
      options: ["auto", "fp32", "fp16", "q8", "q4", "q4f16"],
    },
    {
      id: "model_device",
      label: "Inference device",
      kind: "enum",
      value: config.model.device,
      options: ["auto", "cpu", "wasm", "webgpu"],
    },
    {
      id: "max_new_tokens",
      label: "Max new tokens / turn",
      kind: "number",
      value: String(config.model.max_new_tokens),
    },
    { id: "hf_bucket", label: "HF bucket", kind: "list", value: config.huggingface.bucket_name },
  ];
}

export function SettingsEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
  onOpenGlobalSearch,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const fields = buildFields(config);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;

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
    const idx = SETTINGS_FIELD_IDS.indexOf(focusRowId);
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
          setCursor(0);
          return;
        }
        if (key.backspace || key.delete) {
          setFilterQuery((q) => q.slice(0, -1));
          setCursor(0);
          return;
        }
        if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
        else if (key.downArrow) setCursor((c) => Math.min(visible.length - 1, c + 1));
        else if (key.return) {
          const row = visible[cursor]?.f;
          if (row) handleEnter(row);
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
      else if (key.downArrow) setCursor((c) => Math.min(visible.length - 1, c + 1));
      else if (key.return) {
        const row = visible[cursor]?.f;
        if (row) handleEnter(row);
      }
    },
    { isActive: active },
  );

  function handleEnter(field: Field): void {
    if (field.kind === "bool") {
      if (field.id === "autotrade") {
        orchestrator.setAutotrade(!config.autotrade.enabled);
      } else if (field.id === "memory_enabled") {
        orchestrator.setMemoryEnabled(!config.features.memory_enabled);
      } else if (field.id === "web_search_enabled") {
        orchestrator.setWebSearchEnabled(!config.features.web_search_enabled);
      }
    } else if (field.kind === "enum") {
      const opts = field.options ?? [];
      const next = opts[(opts.indexOf(field.value) + 1) % opts.length];
      if (field.id === "broker") {
        config.broker.platform = next as BrokerPlatform;
      } else if (field.id === "model_dtype") {
        config.model.dtype = next as Config["model"]["dtype"];
      } else if (field.id === "model_device") {
        config.model.device = next as Config["model"]["device"];
      }
      writeConfig(config);
    } else {
      setEditing(true);
      setDraft(field.value);
    }
  }

  function commit(): void {
    const field = visible[cursor]?.f;
    if (!field) return;
    const raw = draft.trim();
    setEditing(false);
    setDraft("");
    if (!raw) return;

    switch (field.id) {
      case "watchlist":
        orchestrator.setWatchlist(raw.split(/[\s,]+/));
        break;
      case "max_position_pct":
      case "min_confidence_to_trade":
      case "stop_loss_pct":
      case "take_profit_pct": {
        const n = Number(raw);
        if (Number.isFinite(n)) orchestrator.setRiskField(field.id, n);
        break;
      }
      case "embedding_model":
        config.gemini.embedding_model = raw;
        writeConfig(config);
        break;
      case "active_model":
        // Manual override path — preferred flow is the dedicated Models screen,
        // but power-users may want to type a repo id directly.
        config.model.id = raw;
        writeConfig(config);
        break;
      case "max_new_tokens": {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n) && n > 0) {
          config.model.max_new_tokens = n;
          writeConfig(config);
        }
        break;
      }
      case "hf_bucket":
        config.huggingface.bucket_name = raw;
        writeConfig(config);
        break;
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
      {visible.length === 0 ? (
        <Text color={theme.color.muted}>No rows match this filter.</Text>
      ) : (
        visible.map(({ f: field }, i) => (
          <Box key={field.id}>
            <Text color={i === cursor ? theme.color.accent : theme.color.text}>
              {i === cursor ? "› " : "  "}
              {field.label.padEnd(34)}
            </Text>
            <Text color={valueColor(field)}>{displayValue(field)}</Text>
          </Box>
        ))
      )}
      {editing ? (
        <Box marginTop={1}>
          <Text color={theme.color.primary}>New value: </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            {filterMode
              ? "type filter · f exit filter · ↑/↓ · Enter edit/toggle"
              : "↑/↓ select · Enter edit/toggle/cycle · / search all · f filter"}
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
