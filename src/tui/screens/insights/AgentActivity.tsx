/**
 * Trading engine status strip — portfolio and watchlist candidate cycles.
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../../theme.js";
import type { OrchestratorState } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

export function AgentActivity({ state }: Props): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.color.muted}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.color.accent}>
        Trading Engine
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Status </Text>
        <Text color={state.status === "running" ? theme.color.success : theme.color.warn}>
          {state.status === "running" ? "🟢 Running" : "⏸️ Paused"} · {state.tradingMode} mode
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Trading cycles </Text>
        <Text color={state.tradingBusy ? theme.color.warn : theme.color.text}>
          {state.tradingBusy
            ? "⏳ Portfolio or candidate cycle running…"
            : `Portfolio: every ${state.portfolioCycleSeconds}s · Candidates: every ${state.candidateCycleSeconds}s`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Symbols to trade </Text>
        <Text color={theme.color.text}>
          {state.watchlist.length} ticker(s): {state.watchlist.slice(0, 8).join(", ")}
          {state.watchlist.length > 8 ? "…" : ""}
        </Text>
      </Box>
    </Box>
  );
}
