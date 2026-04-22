/**
 * Performance panel — risk-adjusted metrics. Each row shows value + a
 * subtle target hint so the user knows what "good" looks like at a glance.
 */

import React from "react";
import { Box, Text } from "ink";

import { Panel, StatRow } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { formatDuration, type PerformanceMetrics } from "../../../metrics.js";

interface Props {
  metrics: PerformanceMetrics;
}

export function Performance({ metrics }: Props): React.ReactElement {
  return (
    <Panel title="Performance">
      <StatRow
        label="Profit factor"
        value={fmtRatio(metrics.profitFactor)}
        valueColor={profitFactorColor(metrics.profitFactor)}
      />
      <StatRow
        label="Win rate"
        value={fmtPct(metrics.winRatePct)}
        valueColor={winRateColor(metrics.winRatePct)}
      />
      <StatRow
        label="Max drawdown"
        value={fmtPct(metrics.maxDrawdownPct)}
        valueColor={metrics.maxDrawdownPct === null ? undefined : theme.color.danger}
      />
      <StatRow
        label="Sharpe (ann.)"
        value={fmtRatio(metrics.sharpe)}
        valueColor={sharpeColor(metrics.sharpe)}
      />
      <StatRow label="Avg trade duration" value={formatDuration(metrics.avgTradeDurationMs)} />
      <Box marginTop={1}>
        <Text color={theme.color.muted}>
          Based on {metrics.closedTrades} closed trade{metrics.closedTrades === 1 ? "" : "s"}.
        </Text>
      </Box>
    </Panel>
  );
}

function fmtRatio(n: number | null): string {
  if (n === null) return "—";
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(2);
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)}%`;
}

function profitFactorColor(n: number | null): string | undefined {
  if (n === null) return undefined;
  if (!Number.isFinite(n) || n >= 1.75) return theme.color.success;
  if (n >= 1) return theme.color.warn;
  return theme.color.danger;
}

function winRateColor(n: number | null): string | undefined {
  if (n === null) return undefined;
  if (n >= 55) return theme.color.success;
  if (n >= 45) return theme.color.warn;
  return theme.color.danger;
}

function sharpeColor(n: number | null): string | undefined {
  if (n === null) return undefined;
  if (n >= 1) return theme.color.success;
  if (n >= 0) return theme.color.warn;
  return theme.color.danger;
}
