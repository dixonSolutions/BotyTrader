/**
 * Holdings as ink-table; wheel-scroll when pointer is over the panel (virtual window).
 */

import React, { useMemo, useRef } from "react";
import type { DOMElement } from "ink";
import { Box, Text, useStdout } from "ink";

import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { theme } from "../../theme.js";
import { useWheelScrollInBounds } from "../../pointer/useWheelScrollInBounds.js";
import type { Position } from "../../../execution/broker.js";
import { filterPositions, fmtMoney, roiPct } from "./Positions.js";

function clip(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function roiStr(pos: Position): string {
  const r = roiPct(pos);
  const sign = r >= 0 ? "+" : "";
  return `${sign}${r.toFixed(1)}%`;
}

function positionToRow(p: Position, currency: string, cols: number): AppTableRow {
  const symM = Math.min(10, Math.max(4, Math.floor(cols * 0.1)));
  const qtyM = 10;
  const moneyM = Math.min(14, Math.max(8, Math.floor(cols * 0.14)));
  return {
    Symbol: clip(p.symbol, symM),
    Qty: clip(String(p.qty), qtyM),
    Avg: clip(fmtMoney(p.avgEntryPrice, currency), moneyM),
    Value: clip(fmtMoney(p.marketValue, currency), moneyM),
    UPNL: clip((p.unrealizedPnl >= 0 ? "+" : "") + fmtMoney(p.unrealizedPnl, currency), moneyM),
    ROI: clip(roiStr(p), 8),
  };
}

const HOLDINGS_COLUMNS = ["Symbol", "Qty", "Avg", "Value", "UPNL", "ROI"] as const;

interface Props {
  positions: Position[];
  symbolsFilter: string;
  viewportRows: number;
  currency: string;
}

export function HoldingsCompactTable({
  positions,
  symbolsFilter,
  viewportRows,
  currency,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const ref = useRef<DOMElement>(null);
  const rows = useMemo(() => filterPositions(positions, symbolsFilter), [positions, symbolsFilter]);
  const v = Math.max(1, Math.floor(viewportRows));
  const maxScroll = Math.max(0, rows.length - v);
  const scrollTop = useWheelScrollInBounds(ref, maxScroll);
  const tableData = useMemo(
    () => rows.slice(scrollTop, scrollTop + v).map((p) => positionToRow(p, currency, cols)),
    [rows, scrollTop, v, currency, cols],
  );

  return (
    <Box ref={ref} flexDirection="column" paddingX={1} paddingBottom={1}>
      {rows.length === 0 ? (
        <Text dimColor>No positions match this filter.</Text>
      ) : (
        <>
          <AppTable data={tableData} columns={[...HOLDINGS_COLUMNS]} padding={1} />
          {maxScroll > 0 ? (
            <Text dimColor color={theme.color.muted}>
              Rows {scrollTop + 1}–{Math.min(rows.length, scrollTop + v)} of {rows.length} · wheel here to scroll
            </Text>
          ) : null}
        </>
      )}
    </Box>
  );
}
