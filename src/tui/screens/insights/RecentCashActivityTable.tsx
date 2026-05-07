/**
 * Dividends, withholding, and cash interest from broker account activity (Alpaca).
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { theme } from "../../theme.js";
import type { CashActivity } from "../../../execution/broker.js";
import { fmtMoney } from "./Positions.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";

interface Props {
  activities: CashActivity[];
  currency: string;
  wheelCaptureRef?: RefObject<DOMElement | null>;
}

/** Single row item for virtual list */
interface CashItem {
  date: string;
  type: string;
  symbol: string;
  net: string;
}

const CASH_COLUMNS = ["Date", "Type", "Symbol", "Net (cash)"];

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
      return t;
  }
}

export function RecentCashActivityTable({
  activities,
  currency,
  wheelCaptureRef,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const listRef = useRef<VirtualListRef>(null);
  const defaultWheelRef = useRef<DOMElement | null>(null);
  const wheelRef = wheelCaptureRef ?? defaultWheelRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo((): CashItem[] => {
    return activities.map((a) => ({
      date: a.ts.slice(0, 10),
      type: typeLabel(a.activityType),
      symbol: a.symbol ?? "—",
      net: (a.netAmount >= 0 ? "+" : "") + fmtMoney(a.netAmount, currency),
    }));
  }, [activities, currency]);

  const listHeight = Math.min(items.length, 12);

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

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const colWidths = useMemo(() => {
    return CASH_COLUMNS.map((col, idx) => {
      const headerLen = col.length;
      const key = ["date", "type", "symbol", "net"][idx] as keyof CashItem;
      const cellLens = items.map((row) => String(row[key] ?? "").length);
      return Math.max(headerLen, ...cellLens, 3) + 2;
    });
  }, [items]);

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + CASH_COLUMNS.length + 1;

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
          {CASH_COLUMNS.map((col, i) => (
            <React.Fragment key={col}>
              <Text bold color={theme.color.primary}>{padCell(col, colWidths[i]!)}</Text>
              {i < CASH_COLUMNS.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
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

  function renderItem({ item, isSelected }: { item: CashItem; isSelected: boolean }): React.ReactElement {
    const values = [item.date, item.type, item.symbol, item.net];
    const selectionPrefix = isSelected ? "> " : "  ";

    return (
      <Box flexDirection="row">
        <Text bold color={theme.color.muted}>{selectionPrefix}│</Text>
        {values.map((val, i) => {
          const isHighlighted = isSelected && i === 0;
          return (
            <React.Fragment key={i}>
              <Text color={isHighlighted ? theme.color.primary : theme.color.text}>{padCell(val, colWidths[i]!)}</Text>
              {i < values.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
            </React.Fragment>
          );
        })}
        <Text bold color={theme.color.muted}>│</Text>
      </Box>
    );
  }

  if (activities.length === 0) {
    return (
      <Box ref={wheelRef as any} paddingX={1} paddingY={1}>
        <Text color={theme.color.muted}>
          No dividend or interest lines in the recent sync window (or broker does not expose cash activity).
        </Text>
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
      <Text color={theme.color.muted}>
        Net = cash impact of each line (dividends accrue as portfolio income; withholdings show as negatives).
      </Text>
      <Text color={theme.color.muted}>
        {items.length} activit{items.length !== 1 ? "ies" : "y"} cached (newest first) · wheel to scroll
      </Text>
    </Box>
  );
}
