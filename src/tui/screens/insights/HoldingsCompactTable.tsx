/**
 * Holdings as ink-table with ink-virtual-list for performance on large portfolios.
 * Only renders visible items, with wheel-scroll support.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { theme } from "../../theme.js";
import type { Position } from "../../../execution/broker.js";
import { filterPositions, fmtMoney, roiPct } from "./Positions.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";

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
  invested: string;
  value: string;
  upnl: string;
  roi: string;
  level: "success" | "danger" | "text";
}

const HOLDINGS_COLUMNS: { header: string; key: keyof HoldingsItem }[] = [
  { header: "Symbol", key: "symbol" },
  { header: "Qty", key: "qty" },
  { header: "Avg", key: "avg" },
  { header: "Invested", key: "invested" },
  { header: "Mkt value", key: "value" },
  { header: "UPNL", key: "upnl" },
  { header: "ROI", key: "roi" },
];

function positionToItem(p: Position, currency: string, cols: number): HoldingsItem {
  const symM = Math.min(10, Math.max(4, Math.floor(cols * 0.1)));
  const qtyM = 10;
  const moneyM = Math.min(13, Math.max(7, Math.floor(cols * 0.12)));
  const costBasis = p.qty * p.avgEntryPrice;
  return {
    symbol: clip(p.symbol, symM),
    qty: clip(String(p.qty), qtyM),
    avg: clip(fmtMoney(p.avgEntryPrice, currency), moneyM),
    invested: clip(fmtMoney(costBasis, currency), moneyM),
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
  wheelCaptureRef?: RefObject<DOMElement | null>;
}

export function HoldingsCompactTable({
  positions,
  symbolsFilter,
  viewportRows,
  currency,
  wheelCaptureRef,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const cols = stdout.columns ?? 80;
  const listRef = useRef<VirtualListRef>(null);
  const defaultWheelRef = useRef<DOMElement | null>(null);
  const wheelRef = wheelCaptureRef ?? defaultWheelRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => filterPositions(positions, symbolsFilter), [positions, symbolsFilter]);
  const items = useMemo(
    () => filtered.map((p) => positionToItem(p, currency, cols)),
    [filtered, currency, cols],
  );

  const listHeight = Math.max(4, viewportRows);

  /** Wheel scroll handler for virtual list navigation */
  useEffect(() => {
    const onScroll = (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null || items.length === 0) return;
      const box = getTerminalCellBounds(wheelRef);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;

      setSelectedIndex((prev) => {
        if (dir === "scrollup") return Math.max(0, prev - 1);
        return Math.min(items.length - 1, prev + 1);
      });
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, items.length, wheelRef]);

  // Keep selected index in bounds when items change
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const colWidths = useMemo(() => {
    return HOLDINGS_COLUMNS.map((def) => {
      const headerLen = def.header.length;
      const cellLens = items.map((row) => String(row[def.key] ?? "").length);
      return Math.max(headerLen, ...cellLens, 4) + 2;
    });
  }, [items]);

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + HOLDINGS_COLUMNS.length + 1;

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
          {HOLDINGS_COLUMNS.map((def, i) => (
            <React.Fragment key={def.header}>
              <Text bold color={theme.color.primary}>{padCell(def.header, colWidths[i]!)}</Text>
              {i < HOLDINGS_COLUMNS.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
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
    const values = HOLDINGS_COLUMNS.map((def) => String(item[def.key]));
    const selectionPrefix = isSelected ? "> " : "  ";

    return (
      <Box flexDirection="row">
        <Text bold color={theme.color.muted}>{selectionPrefix}│</Text>
        {values.map((val, i) => {
          const key = HOLDINGS_COLUMNS[i]!.key;
          const useTrendColor = key === "upnl" || key === "roi";
          const color = useTrendColor ? theme.color[item.level] : theme.color.text;
          const isHighlighted = isSelected && i === 0;
          return (
            <React.Fragment key={key}>
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
    <Box ref={wheelRef as any} flexDirection="column" paddingX={1} paddingBottom={1}>
      {renderHeader()}
      <Box height={listHeight} flexDirection="column">
        <VirtualList
          ref={listRef}
          items={items}
          height={listHeight}
          renderItem={renderItem}
          selectedIndex={selectedIndex}
        />
      </Box>
      {renderFooter()}
      <Text dimColor color={theme.color.muted}>
        {items.length} position{items.length !== 1 ? "s" : ""} · Invested = cost at avg entry · Mkt value = live · wheel to scroll
      </Text>
    </Box>
  );
}
