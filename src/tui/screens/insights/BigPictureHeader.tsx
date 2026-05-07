/**
 * Big Picture Header — High-level portfolio summary.
 * Total Account Value, Day's Change ($/%), Total Unrealized P/L, Buying Power.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";

import { theme } from "../../theme.js";
import { aggregatePositions, fmtMoney } from "./Positions.js";
import type { OrchestratorState } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

export function BigPictureHeader({ state }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const narrow = cols < 90;
  const cur = state.account?.currency ?? "USD";
  const totals = aggregatePositions(state.positions);
  const equity = state.account?.equity ?? 0;
  const dailyPnlAbs = state.performance.dailyPnlAbs ?? 0;
  const dailyPnlPct = state.performance.dailyPnlPct ?? 0;

  const upnl = totals.unrealizedPnl;
  const buyingPower = state.account?.buyingPower ?? 0;
  const cash = state.account?.cash ?? 0;

  const pnlColor = dailyPnlAbs >= 0 ? theme.color.success : theme.color.danger;
  const upnlColor = upnl >= 0 ? theme.color.success : theme.color.danger;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        paddingX={2}
        paddingY={narrow ? 1 : 0}
        flexDirection={narrow ? "column" : "row"}
        justifyContent="space-between"
        alignItems={narrow ? "flex-start" : "center"}
        borderStyle="round"
        borderColor={theme.color.primary}
      >
        <Box flexDirection="column">
          <Text color={theme.color.muted}>TOTAL ACCOUNT VALUE</Text>
          <Text bold color={theme.color.primary}>
            {fmtMoney(equity, cur)}
          </Text>
        </Box>

        <Box flexDirection="column" marginLeft={narrow ? 0 : 4}>
          <Text color={theme.color.muted}>DAY'S CHANGE</Text>
          <Text bold color={pnlColor}>
            {dailyPnlAbs >= 0 ? "+" : ""}{fmtMoney(dailyPnlAbs, cur)} ({dailyPnlAbs >= 0 ? "+" : ""}{dailyPnlPct.toFixed(2)}%)
          </Text>
        </Box>

        <Box flexDirection="column" marginLeft={narrow ? 0 : 4}>
          <Text color={theme.color.muted}>UNREALIZED P/L</Text>
          <Text bold color={upnlColor}>
            {upnl >= 0 ? "+" : ""}{fmtMoney(upnl, cur)}
          </Text>
        </Box>

        <Box flexDirection="column" marginLeft={narrow ? 0 : 4}>
          <Text color={theme.color.muted}>BUYING POWER / CASH</Text>
          <Box>
            <Text bold color={theme.color.text}>{fmtMoney(buyingPower, cur)}</Text>
            <Text color={theme.color.muted}> / </Text>
            <Text color={theme.color.text}>{fmtMoney(cash, cur)}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
