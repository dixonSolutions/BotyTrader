/**
 * Primary portfolio + schedule strip directly under the header (ink-table).
 */

import React from "react";
import { Box, useStdout } from "ink";

import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { aggregatePositions, fmtMoney } from "./Positions.js";
import { formatInsightLocal, formatRelativeUntil } from "./insightFormatters.js";
import type { OrchestratorState } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function nextAgentCell(state: OrchestratorState): string {
  if (state.status === "paused") return "Paused — resume to arm timer";
  if (state.watchlist.length === 0) return "Empty watchlist";
  if (state.cycling) return "Agent cycle running…";
  if (!state.nextScheduledCycleAt) return "Arming…";
  const iso = state.nextScheduledCycleAt;
  return `${formatInsightLocal(iso)} · ${formatRelativeUntil(iso)} · every ${state.agentIntervalSeconds}s`;
}

const WIDE_COLS = ["Unrealized P&L", "Account equity", "Cost basis", "Next agent run (local)"] as const;
const NARROW_COLS = ["Metric", "Value"] as const;

export function InsightsHeadTable({ state }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const narrow = cols < 88;
  const cur = state.account?.currency ?? "USD";
  const totals = aggregatePositions(state.positions);
  const pnlStr = `${totals.unrealizedPnl >= 0 ? "+" : ""}${fmtMoney(totals.unrealizedPnl, cur)}`;
  const equityStr = state.account ? fmtMoney(state.account.equity, cur) : "—";
  const costStr = fmtMoney(totals.costBasis, cur);
  const rawNext = nextAgentCell(state);
  const nextCap = narrow ? Math.max(24, cols - 8) : Math.max(28, Math.floor(cols * 0.28));
  const nextStr = clip(rawNext, nextCap);

  if (narrow) {
    const data: AppTableRow[] = [
      { Metric: "Unrealized P&L", Value: pnlStr },
      { Metric: "Account equity", Value: equityStr },
      { Metric: "Cost basis", Value: costStr },
      { Metric: "Next agent run (local)", Value: nextStr },
    ];
    return (
      <Box marginBottom={1}>
        <AppTable data={data} columns={[...NARROW_COLS]} padding={1} />
      </Box>
    );
  }

  const data: AppTableRow[] = [
    {
      "Unrealized P&L": pnlStr,
      "Account equity": equityStr,
      "Cost basis": costStr,
      "Next agent run (local)": nextStr,
    },
  ];
  return (
    <Box marginBottom={1}>
      <AppTable data={data} columns={[...WIDE_COLS]} padding={1} />
    </Box>
  );
}
