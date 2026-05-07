/**
 * Dividends, withholding, and cash interest from broker account activity (Alpaca).
 */

import React from "react";
import { Box, Text } from "ink";

import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { theme } from "../../theme.js";
import type { CashActivity } from "../../../execution/broker.js";
import { fmtMoney } from "./Positions.js";

interface Props {
  activities: CashActivity[];
  currency: string;
  maxRows?: number;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Short label for Alpaca activity_type codes. */
function typeLabel(t: string): string {
  switch (t) {
    case "DIV":
      return "Dividend";
    case "DIVNRA":
      return "Div W/H";
    case "INT":
      return "Interest";
    default:
      return clip(t, 10);
  }
}

export function RecentCashActivityTable({
  activities,
  currency,
  maxRows = 12,
}: Props): React.ReactElement {
  if (activities.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color={theme.color.muted}>
          No dividend or interest lines in the recent sync window (or broker does not expose cash activity).
        </Text>
      </Box>
    );
  }

  const slice = activities.slice(0, maxRows);
  const data: AppTableRow[] = slice.map((a) => {
    const day = a.ts.slice(0, 10);
    const netStr =
      (a.netAmount >= 0 ? "+" : "") + fmtMoney(a.netAmount, currency);
    return {
      Date: clip(day, 12),
      Type: typeLabel(a.activityType),
      Symbol: a.symbol ? clip(a.symbol, 8) : "—",
      "Net (cash)": netStr,
    };
  });

  const columns = ["Date", "Type", "Symbol", "Net (cash)"];

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      <AppTable data={data} columns={columns} padding={1} />
      <Text color={theme.color.muted}>
        Net = cash impact of each line (dividends accrue as portfolio income; withholdings show as negatives).
      </Text>
      <Text color={theme.color.muted}>
        Showing {slice.length} of {activities.length} activit{activities.length !== 1 ? "ies" : "y"} (newest first).
      </Text>
    </Box>
  );
}
