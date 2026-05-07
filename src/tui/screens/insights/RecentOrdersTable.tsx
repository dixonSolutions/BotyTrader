/**
 * Recent broker orders — compact table for the Portfolio insights tab.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { theme } from "../../theme.js";
import type { Order } from "../../../execution/broker.js";
import { fmtMoney } from "./Positions.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";

interface Props {
  orders: Order[];
  currency: string;
  wheelCaptureRef?: RefObject<DOMElement | null>;
}

/** Single row item for virtual list */
interface OrderItem {
  time: string;
  symbol: string;
  side: string;
  qty: string;
  fill: string;
  avg: string;
  notional: string;
  status: string;
}

const ORDER_COLUMNS = ["Time", "Sym", "Side", "Qty", "Fill", "Avg", "Notional", "Status"];

function fillNotional(o: Order, currency: string): string {
  if (o.filledAvgPrice == null || o.filledQty <= 0) return "—";
  return fmtMoney(o.filledQty * o.filledAvgPrice, currency);
}

export function RecentOrdersTable({ orders, currency, wheelCaptureRef }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const listRef = useRef<VirtualListRef>(null);
  const defaultWheelRef = useRef<DOMElement | null>(null);
  const wheelRef = wheelCaptureRef ?? defaultWheelRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [selectedIndex, setSelectedIndex] = useState(0);

  const items = useMemo((): OrderItem[] => {
    return orders.map((o) => ({
      time: o.submittedAt.slice(11, 19),
      symbol: o.symbol,
      side: o.side.toUpperCase(),
      qty: String(o.qty),
      fill: String(o.filledQty),
      avg: o.filledAvgPrice != null ? fmtMoney(o.filledAvgPrice, currency) : "—",
      notional: fillNotional(o, currency),
      status: o.status,
    }));
  }, [orders, currency]);

  const listHeight = Math.min(items.length, 14);

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
    return ORDER_COLUMNS.map((col, idx) => {
      const headerLen = col.length;
      const key = ["time", "symbol", "side", "qty", "fill", "avg", "notional", "status"][idx] as keyof OrderItem;
      const cellLens = items.map((row) => String(row[key] ?? "").length);
      return Math.max(headerLen, ...cellLens, 3) + 2;
    });
  }, [items]);

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + ORDER_COLUMNS.length + 1;

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
          {ORDER_COLUMNS.map((col, i) => (
            <React.Fragment key={col}>
              <Text bold color={theme.color.primary}>{padCell(col, colWidths[i]!)}</Text>
              {i < ORDER_COLUMNS.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
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

  function renderItem({ item, isSelected }: { item: OrderItem; isSelected: boolean }): React.ReactElement {
    const values = [item.time, item.symbol, item.side, item.qty, item.fill, item.avg, item.notional, item.status];
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

  if (orders.length === 0) {
    return (
      <Box ref={wheelRef as any} paddingX={1} paddingY={1}>
        <Text color={theme.color.muted}>No recent orders in memory yet. They refresh with account sync.</Text>
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
        Notional = filled qty × avg fill (cash out on buys, proceeds on sells when filled).
      </Text>
      <Text color={theme.color.muted}>
        {items.length} order{items.length !== 1 ? "s" : ""} cached (newest first) · wheel to scroll
      </Text>
    </Box>
  );
}
