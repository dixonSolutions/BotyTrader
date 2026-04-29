/**
 * System logs panel — ink-virtual-list for performance on large log buffers.
 * Only renders visible items, with wheel-scroll and programmatic control support.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import type { LogEntry } from "../../../orchestrator.js";

interface Props {
  logs: LogEntry[];
  /** First row index into `logs` (0 = newest). Parent controls this for programmatic scroll. */
  scrollOffset: number;
  /** Max lines to paint (terminal performance). */
  viewportLines?: number;
  /** Optional pager / actions rendered under the panel title. */
  toolbar?: React.ReactNode;
}

/** Single log item for virtual list */
interface LogItem {
  time: string;
  level: string;
  message: string;
  levelColor: string;
  ts: number;
}

function logToItem(entry: LogEntry): LogItem {
  // Format: emoji prefix + message for visual scanning
  let icon = "•";
  if (entry.level === "error") icon = "✗";
  else if (entry.level === "warn") icon = "⚠";
  else if (entry.level === "info") icon = "ℹ";
  else if (entry.level === "agent") icon = "◆";

  // Highlight key message patterns
  const message = entry.message;
  if (message.startsWith("▶▶▶")) icon = "▶";
  if (message.startsWith("◀◀◀")) icon = "◀";
  if (message.includes("DECISION:")) icon = "★";
  if (message.includes("💭")) icon = "💭";

  return {
    time: entry.ts.slice(11, 23),
    level: entry.level.padEnd(5),
    message: `${icon} ${message}`,
    levelColor: theme.level[entry.level],
    ts: new Date(entry.ts).getTime(),
  };
}

export function SystemLogs({ logs, scrollOffset, viewportLines = 14, toolbar }: Props): React.ReactElement {
  const mouse = useMouse();
  const listRef = useRef<VirtualListRef>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Convert logs to items (newest first)
  const items = useMemo(() => {
    return logs.map(logToItem);
  }, [logs]);

  const listHeight = Math.max(5, viewportLines);

  // Sync with parent scroll offset (programmatic control)
  useEffect(() => {
    const maxOffset = Math.max(0, items.length - listHeight);
    const targetIndex = Math.min(Math.max(0, scrollOffset), maxOffset);
    setSelectedIndex(targetIndex);
    listRef.current?.scrollToIndex(targetIndex);
  }, [scrollOffset, items.length, listHeight]);

  /** Wheel scroll handler for virtual list navigation */
  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null || items.length === 0) return;
      setSelectedIndex((prev) => {
        const newIndex = dir === "scrollup" ? Math.max(0, prev - 1) : Math.min(items.length - 1, prev + 1);
        listRef.current?.scrollToIndex(newIndex);
        return newIndex;
      });
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, items.length]);

  const hi = logs.length === 0 ? 0 : Math.min(selectedIndex + listHeight, logs.length);

  function renderItem({ item, isSelected }: { item: LogItem; isSelected: boolean }): React.ReactElement {
    const selectionPrefix = isSelected ? "> " : "  ";
    return (
      <Box flexDirection="row">
        <Text color={isSelected ? theme.color.primary : theme.color.muted}>{selectionPrefix}{item.time} </Text>
        <Text color={item.levelColor}>{item.level} </Text>
        <Text color={isSelected ? theme.color.primary : theme.color.text}>{item.message}</Text>
      </Box>
    );
  }

  return (
    <Panel title={`System logs ${logs.length ? `${selectedIndex + 1}–${hi}` : "0"} of ${logs.length}`}>
      {toolbar ? (
        <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
          {toolbar}
        </Box>
      ) : null}
      {items.length === 0 ? (
        <Text color={theme.color.muted}>No log entries yet.</Text>
      ) : (
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
      )}
    </Panel>
  );
}
