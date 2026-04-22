/**
 * Secrets editor — view (masked) and reset .env credentials.
 * Required keys are highlighted; broker-specific requirements come from
 * `brokerRequiredSecrets(config.broker.platform)`.
 *
 * `/` opens global search (all tabs). `f` toggles in-tab filter.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import {
  SECRET_DESCRIPTIONS,
  SecretsSchema,
  brokerRequiredSecrets,
  writeEnv,
  type Secrets,
} from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

const ALL_KEYS = Object.keys(SecretsSchema.shape) as (keyof Secrets)[];

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
  onOpenGlobalSearch?: () => void;
}

export function SecretsEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
  onOpenGlobalSearch,
}: Props): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;

  const required = useMemo(() => {
    const base: (keyof Secrets)[] = [...brokerRequiredSecrets(orchestrator.config.broker.platform)];
    if (orchestrator.config.features.memory_enabled) base.push("GEMINI_API_KEY");
    if (orchestrator.config.features.web_search_enabled) base.push("BRAVE_API_KEY");
    return new Set<keyof Secrets>(base);
  }, [
    orchestrator.config.broker.platform,
    orchestrator.config.features.memory_enabled,
    orchestrator.config.features.web_search_enabled,
  ]);

  const visibleKeys = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return ALL_KEYS.filter((key) => {
      if (!filterMode || !q) return true;
      const hay = `${key} ${SECRET_DESCRIPTIONS[key]}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filterMode, filterQuery]);

  useEffect(() => {
    if (focusRowId == null) return;
    setFilterMode(false);
    setFilterQuery("");
    const j = ALL_KEYS.indexOf(focusRowId as keyof Secrets);
    if (j >= 0) setCursor(j);
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
        else if (key.downArrow) setCursor((c) => Math.min(visibleKeys.length - 1, c + 1));
        else if (key.return) {
          setEditing(true);
          setDraft("");
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
      else if (key.downArrow) setCursor((c) => Math.min(visibleKeys.length - 1, c + 1));
      else if (key.return) {
        setEditing(true);
        setDraft("");
      }
    },
    { isActive: active },
  );

  function commit(): void {
    const keyName = visibleKeys[cursor];
    if (!keyName) return;
    const value = draft.trim();
    if (value) writeEnv({ [keyName]: value });
    setEditing(false);
    setDraft("");
  }

  return (
    <Panel>
      {filterMode ? (
        <Box marginBottom={1}>
          <Text color={theme.color.accent}>Filter: </Text>
          <Text color={theme.color.text}>{filterQuery.length ? filterQuery : "(type to narrow)"}</Text>
        </Box>
      ) : null}
      {visibleKeys.length === 0 ? (
        <Text color={theme.color.muted}>No secrets match this filter.</Text>
      ) : (
        visibleKeys.map((key, i) => {
          const set = Boolean(process.env[key] && process.env[key]!.trim() !== "");
          const isRequired = required.has(key);
          return (
            <Box key={key} flexDirection="column">
              <Box>
                <Text color={i === cursor ? theme.color.accent : theme.color.text}>
                  {i === cursor ? "› " : "  "}
                  {key}
                </Text>
                <Text color={theme.color.muted}>{"  "}</Text>
                <Text color={set ? theme.color.success : isRequired ? theme.color.danger : theme.color.muted}>
                  {set ? "set" : isRequired ? "missing (required)" : "unset"}
                </Text>
              </Box>
              {i === cursor ? (
                <Text color={theme.color.muted}>{"  " + SECRET_DESCRIPTIONS[key]}</Text>
              ) : null}
            </Box>
          );
        })
      )}
      {editing ? (
        <Box marginTop={1}>
          <Text color={theme.color.primary}>New value (hidden): </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} mask="*" />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.color.muted}>
            {filterMode
              ? "type filter · f exit filter · ↑/↓ · Enter set"
              : "↑/↓ · Enter set · / search all · f filter"}
          </Text>
        </Box>
      )}
    </Panel>
  );
}
