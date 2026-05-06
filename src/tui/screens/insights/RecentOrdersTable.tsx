/**
 * Recent broker orders — compact table for the Portfolio insights tab.
 */

import React from "react";
import { Box, Text } from "ink";

import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { theme } from "../../theme.js";
import type { Order } from "../../../execution/broker.js";
import { fmtMoney } from "./Positions.js";

interface Props {
  orders: Order[];
  currency: string;
  /** Max rows to render (newest first). */
  maxRows?: number;
}

export function RecentOrdersTable({ orders, currency, maxRows = 14 }: Props): React.ReactElement {
  if (orders.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color={theme.color.muted}>No recent orders in memory yet. They refresh with account sync.</Text>
      </Box>
    );
  }

  const slice = orders.slice(0, maxRows);
  const data: AppTableRow[] = slice.map((o) => ({
    Time: clip(o.submittedAt.slice(11, 19), 10),
    Sym: clip(o.symbol, 8),
    Side: o.side.toUpperCase(),
    Qty: String(o.qty),
    Fill: `${o.filledQty}`,
    Avg: o.filledAvgPrice != null ? clip(fmtMoney(o.filledAvgPrice, currency), 12) : "—",
    Status: clip(o.status, 10),
  }));

  const columns = ["Time", "Sym", "Side", "Qty", "Fill", "Avg", "Status"];

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      <AppTable data={data} columns={columns} padding={1} />
      <Text color={theme.color.muted}>
        Showing {slice.length} of {orders.length} cached order{orders.length !== 1 ? "s" : ""} (newest first).
      </Text>
    </Box>
  );
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}
