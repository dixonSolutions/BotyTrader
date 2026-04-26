/**
 * Vital signs strip — health at a glance (Doherty threshold).
 * On narrow terminals, metrics stack instead of squeezing one row.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";

import { Sparkline } from "../../components/Sparkline.js";
import { theme } from "../../theme.js";
import type { OrchestratorState, BotStatus } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

export function VitalSigns({ state }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const narrow = cols < 76;
  const equity = state.account?.equity ?? null;
  const currency = state.account?.currency ?? "USD";
  const pnlAbs = state.performance.dailyPnlAbs;
  const pnlPct = state.performance.dailyPnlPct;
  const pnlColor =
    pnlAbs === null ? theme.color.muted : pnlAbs >= 0 ? theme.color.success : theme.color.danger;

  const metaRow = (
    <>
      <Box flexDirection={narrow ? "column" : "row"} flexWrap="wrap" marginBottom={narrow ? 1 : 0}>
        <Box marginRight={narrow ? 0 : 2} marginBottom={narrow ? 0 : 0}>
          <Text color={theme.color.muted}>Status </Text>
          <Text bold color={statusColor(state.status)}>
            {state.status.toUpperCase()}
          </Text>
        </Box>
        <Box marginRight={narrow ? 0 : 2}>
          <Text color={theme.color.muted}>Equity </Text>
          <Text bold>{fmtMoney(equity, currency)}</Text>
        </Box>
        <Box marginRight={narrow ? 0 : 2}>
          <Text color={theme.color.muted}>24h PnL </Text>
          <Text bold color={pnlColor}>
            {fmtSignedMoney(pnlAbs, currency)}
            {pnlPct !== null ? ` (${fmtSignedPct(pnlPct)})` : ""}
          </Text>
        </Box>
        <Box marginRight={narrow ? 0 : 2}>
          <Text color={theme.color.muted}>Uptime </Text>
          <Text>{fmtUptime(state.startedAt)}</Text>
        </Box>
        <Box>
          <Text color={theme.color.muted}>Latency </Text>
          <Text color={latencyColor(state.pingMs)}>{state.pingMs === null ? "—" : `${state.pingMs}ms`}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" alignItems="center">
        <Text color={theme.color.muted}>Equity trail </Text>
        <Sparkline
          values={state.equityHistory.map((s) => s.equity)}
          width={Math.min(48, Math.max(12, cols - 18))}
          color={theme.color.primary}
        />
      </Box>
    </>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor(state.status)}
      paddingX={1}
      marginBottom={1}
    >
      {metaRow}
    </Box>
  );
}

function statusColor(status: BotStatus): string {
  switch (status) {
    case "running":
      return theme.color.success;
    case "paused":
      return theme.color.warn;
    case "error":
      return theme.color.danger;
  }
}

function latencyColor(ms: number | null): string {
  if (ms === null) return theme.color.danger;
  if (ms < 250) return theme.color.success;
  if (ms < 750) return theme.color.warn;
  return theme.color.danger;
}

function fmtMoney(n: number | null, currency: string): string {
  if (n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)} ${currency}`;
}

function fmtSignedMoney(n: number | null, currency: string): string {
  if (n === null || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)} ${currency}`;
}

function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h${m.toString().padStart(2, "0")}m`;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
}
