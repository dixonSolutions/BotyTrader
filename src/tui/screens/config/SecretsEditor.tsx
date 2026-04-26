/**
 * Secrets editor — view (masked) and reset .env credentials. Pointer + text entry for values.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { Panel } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { SECRET_DESCRIPTIONS, SecretsSchema, brokerRequiredSecrets, writeEnv, type Secrets } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

const ALL_KEYS = Object.keys(SecretsSchema.shape) as (keyof Secrets)[];

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

export function SecretsEditor({ orchestrator, active, focusRowId, onFocusRowConsumed }: Props): React.ReactElement {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

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
  }, [focusRowId]);

  useEffect(() => {
    if (focusRowId == null) return;
    const j = visibleKeys.indexOf(focusRowId as keyof Secrets);
    if (j >= 0) setSelectedIdx(j);
    consumeRef.current?.();
  }, [focusRowId, visibleKeys]);

  function openEdit(index: number): void {
    setSelectedIdx(index);
    setEditing(true);
    setDraft("");
  }

  function commit(): void {
    const keyName = visibleKeys[selectedIdx];
    if (!keyName) return;
    const value = draft.trim();
    if (value) writeEnv({ [keyName]: value });
    setEditing(false);
    setDraft("");
  }

  return (
    <Panel>
      <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
        <Button
          label={filterMode ? "Done filtering" : "Filter keys"}
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
      {visibleKeys.length === 0 ? (
        <Text color={theme.color.muted}>No secrets match this filter.</Text>
      ) : (
        visibleKeys.map((key, i) => {
          const set = Boolean(process.env[key] && process.env[key]!.trim() !== "");
          const isRequired = required.has(key);
          return (
            <ClickableRow
              key={key}
              selected={i === selectedIdx}
              onClick={() => {
                if (editing) return;
                openEdit(i);
              }}
              detail={SECRET_DESCRIPTIONS[key]}
            >
              <Text>
                <Text color={i === selectedIdx ? theme.color.accent : theme.color.text}>{key}</Text>
                <Text color={theme.color.muted}>{"  "}</Text>
                <Text color={set ? theme.color.success : isRequired ? theme.color.danger : theme.color.muted}>
                  {set ? "set" : isRequired ? "missing (required)" : "unset"}
                </Text>
              </Text>
            </ClickableRow>
          );
        })
      )}
      {editing ? (
        <Box marginTop={1} flexDirection="row" flexWrap="wrap">
          <Text color={theme.color.primary}>New value (hidden): </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={commit} mask="*" />
          <Box marginLeft={1}>
            <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
          </Box>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.color.muted}>Click a key to set it. Use Filter to narrow. Typing the secret uses the keyboard.</Text>
        </Box>
      )}
    </Panel>
  );
}
