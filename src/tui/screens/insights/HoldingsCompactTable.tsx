/**
 * Holdings as ink-table with ink-virtual-list for performance on large portfolios.
 * Only renders visible items, with wheel-scroll support.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { theme } from "../../theme.js";
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

/** Single row item for virtual list */
interface HoldingsItem {
  symbol: string;
  qty: string;
  avg: string;
  value: string;
  upnl: string;
  roi: string;
  level: "success" | "danger" | "text";
}

function positionToItem(p: Position, currency: string, cols: number): HoldingsItem {
  const symM = Math.min(10, Math.max(4, Math.floor(cols * 0.1)));
  const qtyM = 10;
  const moneyM = Math.min(14, Math.max(8, Math.floor(cols * 0.14)));
  return {
    symbol: clip(p.symbol, symM),
    qty: clip(String(p.qty), qtyM),
    avg: clip(fmtMoney(p.avgEntryPrice, currency), moneyM),
    value: clip(fmtMoney(p.marketValue, currency), moneyM),
    upnl: clip((p.unrealizedPnl >= 0 ? "+" : "") + fmtMoney(p.unrealizedPnl, currency), moneyM),
    roi: clip(roiStr(p), 8),
    level: p.unrealizedPnl >= 0 ? "success" : "danger",
  };
}

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
  const mouse = useMouse();
  const cols = stdout.columns ?? 80;
  const listRef = useRef<VirtualListRef>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => filterPositions(positions, symbolsFilter), [positions, symbolsFilter]);
  const items = useMemo(
    () => filtered.map((p) => positionToItem(p, currency, cols)),
    [filtered, currency, cols],
  );

  const listHeight = Math.max(4, viewportRows);

  /** Wheel scroll handler for virtual list navigation */
  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null || items.length === 0) return;
      setSelectedIndex((prev) => {
        if (dir === "scrollup") return Math.max(0, prev - 1);
        return Math.min(items.length - 1, prev + 1);
      });
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, items.length]);

  // Keep selected index in bounds when items change
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const columns = ["Symbol", "Qty", "Avg", "Value", "UPNL", "ROI"];
  const colWidths = useMemo(() => {
    const widths = columns.map((col) => {
      const headerLen = col.length;
      const cellLens = items.map((row) => String(row[col.toLowerCase() as keyof HoldingsItem] ?? "").length);
      return Math.max(headerLen, ...cellLens, 4) + 2;
    });
    return widths;
  }, [items]);

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + columns.length + 1;

  function padCell(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    return ` ${text}${" ".repeat(padding - 1)}`;
  }

  function renderHeader(): React.ReactElement {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.color.muted}>
          {"┌" + "─".repeat(totalWidth - 2) + "┐"}
        </Text>
        <Box flexDirection="row">
          <Text bold color={theme.color.muted}>│</Text>
          {columns.map((col, i) => (
            <React.Fragment key={col}>
              <Text bold color={theme.color.primary}>{padCell(col, colWidths[i]!)}</Text>
              {i < columns.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
            </React.Fragment>
          ))}
          <Text bold color={theme.color.muted}>│</Text>
        </Box>
        <Text bold color={theme.color.muted}>
          {"├" + "─".repeat(totalWidth - 2) + "┤"}
        </Text>
      </Box>
    );
  }

  function renderFooter(): React.ReactElement {
    return (
      <Text bold color={theme.color.muted}>
        {"└" + "─".repeat(totalWidth - 2) + "┘"}
      </Text>
    );
  }

  function renderItem({ item, isSelected }: { item: HoldingsItem; isSelected: boolean }): React.ReactElement {
    const values = [item.symbol, item.qty, item.avg, item.value, item.upnl, item.roi];
    const selectionPrefix = isSelected ? "> " : "  ";

    return (
      <Box flexDirection="row">
        <Text bold color={theme.color.muted}>{selectionPrefix}│</Text>
        {values.map((val, i) => {
          const color = i === 4 || i === 5 ? theme.color[item.level] : theme.color.text;
          const isHighlighted = isSelected && i === 0;
          return (
            <React.Fragment key={i}>
              <Text color={isHighlighted ? theme.color.primary : color}>{padCell(val, colWidths[i]!)}</Text>
              {i < values.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
            </React.Fragment>
          );
        })}
        <Text bold color={theme.color.muted}>│</Text>
      </Box>
    );
  }

  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={1}>
        <Text dimColor>No positions match this filter.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {renderHeader()}
      <Box height={listHeight} flexDirection="column">
        <VirtualList
          ref={listRef}
          items={items}
          height={listHeight}
          renderItem={renderItem}
          selectedIndex={selectedIndex}
          showOverflowIndicators
        />
      </Box>
      {renderFooter()}
      <Text dimColor color={theme.color.muted}>
        {items.length} position{items.length !== 1 ? "s" : ""} · wheel to scroll
      </Text>
    </Box>
  );
}
