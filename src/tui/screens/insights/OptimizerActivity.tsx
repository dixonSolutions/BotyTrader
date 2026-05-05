/**
 * Autonomous optimizer status — snapshots, last run, schedule hint.
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../../theme.js";
import type { OrchestratorState } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

export function OptimizerActivity({ state }: Props): React.ReactElement {
  const opt = state.trading.optimization;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.color.muted}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.color.accent}>
        Autonomous optimizer
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Snapshots </Text>
        <Text color={theme.color.text}>
          {opt
            ? `${opt.snapshotTotal} total · ${opt.snapshotsWithOutcome} with outcomes · ${opt.shadowCount} shadow`
            : "— (open trading DB)"}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Last run </Text>
        <Text color={theme.color.text}>{opt?.lastRunAt ?? "—"}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Status / improvement </Text>
        <Text color={theme.color.text}>
          {opt?.lastStatus ?? "—"}
          {opt?.lastImprovementPct != null ? ` · ${(opt.lastImprovementPct * 100).toFixed(1)}%` : ""}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Schedule </Text>
        <Text color={theme.color.text}>{opt?.nextScheduledHint ?? "—"}</Text>
      </Box>
      {opt?.lastNotes ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>Notes </Text>
          <Text color={theme.color.subtle} wrap="truncate">
            {opt.lastNotes}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
