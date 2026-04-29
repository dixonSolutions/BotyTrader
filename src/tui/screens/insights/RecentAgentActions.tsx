/**
 * RecentAgentActions — compact card showing latest agent trading decisions.
 * Uses ink-virtual-list for performance on large signal histories.
 * Displays action type, symbol, timestamp, technical/sentiment/final scores.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { theme } from "../../theme.js";
import type { SignalRow, TradeAction } from "../../../trading/types.js";
import { formatInsightLocalShort } from "./insightFormatters.js";

function scoreTxt(n: number | null): string {
  return n === null || Number.isNaN(n) ? "—" : n.toFixed(1);
}

function actionIcon(action: TradeAction): string {
  switch (action) {
    case "buy":
      return "▲";
    case "sell":
      return "▼";
    case "hold":
      return "◆";
    default:
      return "○";
  }
}

function actionColor(action: TradeAction): string {
  switch (action) {
    case "buy":
      return theme.color.success;
    case "sell":
      return theme.color.danger;
    case "hold":
      return theme.color.muted;
    default:
      return theme.color.text;
  }
}

const ACTION_COLUMNS = ["Time", "Sym", "Act", "Tech", "Sent", "Final", "Exec"];

/** Single row item for virtual list */
interface ActionItem {
  time: string;
  symbol: string;
  action: TradeAction;
  actionStr: string;
  technical: string;
  sentiment: string;
  final: string;
  executed: string;
}

function signalToItem(s: SignalRow, timeW: number, symW: number): ActionItem {
  const t = formatInsightLocalShort(s.createdAt);
  const time = t.length > timeW ? `${t.slice(0, timeW - 1)}…` : t;
  const sym = s.symbol.length > symW ? `${s.symbol.slice(0, symW - 1)}…` : s.symbol;
  return {
    time,
    symbol: sym,
    action: s.action,
    actionStr: `${actionIcon(s.action)} ${s.action.toUpperCase()}`,
    technical: scoreTxt(s.technicalScore),
    sentiment: scoreTxt(s.sentimentScore),
    final: scoreTxt(s.hybridScore),
    executed: s.executed ? "Y" : "N",
  };
}

interface Props {
  signals: SignalRow[];
  viewportRows: number;
}

export function RecentAgentActions({ signals, viewportRows }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const cols = stdout.columns ?? 80;
  const listRef = useRef<VirtualListRef>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const timeW = Math.min(20, Math.max(14, Math.floor(cols * 0.18)));
  const symW = 6;

  const items = useMemo(
    () => signals.map((s) => signalToItem(s, timeW, symW)),
    [signals, timeW, symW],
  );

  const listHeight = Math.max(3, Math.floor(viewportRows));

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

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const colWidths = useMemo(() => {
    return ACTION_COLUMNS.map((col, idx) => {
      const headerLen = col.length;
      const key = ["time", "symbol", "actionStr", "technical", "sentiment", "final", "executed"][idx] as keyof ActionItem;
      const cellLens = items.map((row) => String(row[key] ?? "").length);
      return Math.max(headerLen, ...cellLens, 3) + 2;
    });
  }, [items]);

  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + ACTION_COLUMNS.length + 1;

  function padCell(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    return ` ${text}${" ".repeat(padding - 1)}`;
  }

  function renderHeader(): React.ReactElement {
    return (
      <Box flexDirection="column">
        <Box marginLeft={1} marginBottom={1}>
          <Text bold color={theme.color.primary}>
            Recent agent actions
          </Text>
        </Box>
        <Text bold color={theme.color.muted}>
          {"┌" + "─".repeat(totalWidth - 2) + "┐"}
        </Text>
        <Box flexDirection="row">
          <Text bold color={theme.color.muted}>│</Text>
          {ACTION_COLUMNS.map((col, i) => (
            <React.Fragment key={col}>
              <Text bold color={theme.color.primary}>{padCell(col, colWidths[i]!)}</Text>
              {i < ACTION_COLUMNS.length - 1 ? <Text bold color={theme.color.muted}>│</Text> : null}
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

  function renderItem({ item, isSelected }: { item: ActionItem; isSelected: boolean }): React.ReactElement {
    const values = [item.time, item.symbol, item.actionStr, item.technical, item.sentiment, item.final, item.executed];
    const selectionPrefix = isSelected ? "> " : "  ";

    return (
      <Box flexDirection="row">
        <Text bold color={theme.color.muted}>{selectionPrefix}│</Text>
        {values.map((val, i) => {
          const color = i === 2 ? actionColor(item.action) : theme.color.text;
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

  const hasSignals = signals.length > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.color.muted}
      paddingX={1}
      marginTop={1}
      marginBottom={1}
    >
      {!hasSignals ? (
        <Text dimColor color={theme.color.muted}>
          No recent actions — run trading cycles to generate signals.
        </Text>
      ) : (
        <Box flexDirection="column">
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
            {items.length} action{items.length !== 1 ? "s" : ""} · wheel to scroll
          </Text>
        </Box>
      )}
    </Box>
  );
}
