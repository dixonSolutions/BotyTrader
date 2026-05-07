/**
 * Trading SQLite — path summary and destructive reset (signals & optimizer snapshots).
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";

import { Button } from "../../components/Button.js";
import { Panel } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

export function DbEditor({
  orchestrator,
  state,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = useState(true);
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  const cfgPath = orchestrator.config.trading.database_path;
  const resolvedPath = state.trading.dbPath;
  const dbErr = state.trading.dbOpenError;

  useEffect(() => {
    if (focusRowId !== "erase_db") return;
    consumeRef.current?.();
  }, [focusRowId]);

  function erase(): void {
    setBusy(true);
    setFeedback(null);
    try {
      const r = orchestrator.eraseTradingDatabase();
      setFeedbackOk(r.ok);
      setFeedback(
        r.ok ? "Database file removed and a fresh empty database was created." : (r.error ?? "Erase failed."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Database (SQLite)">
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.color.muted}>Configured path (config.toml)</Text>
        <Text>{cfgPath}</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.color.muted}>Resolved path</Text>
        <Text>{resolvedPath}</Text>
      </Box>
      {dbErr ? (
        <Box marginBottom={1}>
          <Text color={theme.color.warn}>Open error: {dbErr}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.color.muted} wrap="wrap">
          Erase deletes the SQLite file (including WAL files), then recreates an empty database with migrations.
          All signals, snapshots, and optimizer history stored in this DB are permanently removed.
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" alignItems="center">
        <Button
          label="Erase database"
          icon={icons.reset}
          onClick={() => erase()}
          disabled={busy}
          variant="danger"
          minWidth={18}
        />
        {busy ? (
          <Text color={theme.color.muted}> Working…</Text>
        ) : null}
      </Box>
      {feedback ? (
        <Box marginTop={1}>
          <Text color={feedbackOk ? theme.color.success : theme.color.warn}>{feedback}</Text>
        </Box>
      ) : null}
    </Panel>
  );
}
