/**
 * System logs panel — ink-virtual-list for performance on large log buffers.
 * Only renders visible items, with wheel-scroll and programmatic control support.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { Button } from "../../components/Button.js";
import { Panel } from "../../components/Layout.js";
import { copyTextToClipboard } from "../../clipboard.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";
import type { LogEntry } from "../../../orchestrator.js";

interface Props {
  logs: LogEntry[];
  /** First row index into `logs` (0 = newest). Parent controls this for programmatic scroll. */
  scrollOffset: number;
  /** Max lines to paint (terminal performance). */
  viewportLines?: number;
  /** Optional pager / actions rendered under the panel title. */
  toolbar?: React.ReactNode;
  /** Hit box for wheel: scroll list only when pointer is inside (parent skips outer scroll). */
  wheelCaptureRef?: RefObject<DOMElement | null>;
  /** Keep parent `scrollOffset` in sync when the user wheels inside {@link wheelCaptureRef}. */
  onWheelScrollOffsetChange?: (offset: number) => void;
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

function formatLogsForExport(entries: LogEntry[]): string {
  return entries.map((e) => `${e.ts} [${e.level}] ${e.message}`).join("\n");
}

export function SystemLogs({
  logs,
  scrollOffset,
  viewportLines = 14,
  toolbar,
  wheelCaptureRef,
  onWheelScrollOffsetChange,
}: Props): React.ReactElement {
  const mouse = useMouse();
  const { stdout } = useStdout();
  const listRef = useRef<VirtualListRef>(null);
  const defaultCaptureRef = useRef<DOMElement | null>(null);
  const captureRef = wheelCaptureRef ?? defaultCaptureRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  /** Wheel scroll — only when pointer is inside the log list box (see Insights outer scroll gate). */
  useEffect(() => {
    const onScroll = (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null || items.length === 0) return;
      const box = getTerminalCellBounds(captureRef);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;
      setSelectedIndex((prev) => {
        const newIndex = dir === "scrollup" ? Math.max(0, prev - 1) : Math.min(items.length - 1, prev + 1);
        listRef.current?.scrollToIndex(newIndex);
        onWheelScrollOffsetChange?.(newIndex);
        return newIndex;
      });
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, items.length, captureRef, onWheelScrollOffsetChange]);

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

  useEffect(() => {
    return () => {
      if (copyHintTimer.current) clearTimeout(copyHintTimer.current);
    };
  }, []);

  function handleCopy(): void {
    const text = formatLogsForExport(logs);
    const { ok, detail } = copyTextToClipboard(text);
    if (copyHintTimer.current) clearTimeout(copyHintTimer.current);
    setCopyHint(ok ? "Copied to clipboard." : `Copy failed: ${detail}`);
    copyHintTimer.current = setTimeout(() => {
      setCopyHint(null);
      copyHintTimer.current = undefined;
    }, 4000);
  }

  return (
    <Panel title={`System logs ${logs.length ? `${selectedIndex + 1}–${hi}` : "0"} of ${logs.length}`}>
      <Box marginBottom={1} flexDirection="row" flexWrap="wrap" alignItems="center">
        <Button
          label="Copy logs"
          icon={icons.bullet}
          onClick={() => handleCopy()}
          disabled={logs.length === 0}
          variant="secondary"
          minWidth={14}
        />
        <Text> </Text>
        {toolbar ? toolbar : null}
      </Box>
      {copyHint ? (
        <Box marginBottom={1}>
          <Text color={copyHint.startsWith("Copy failed") ? theme.color.warn : theme.color.success}>{copyHint}</Text>
        </Box>
      ) : null}
      {items.length === 0 ? (
        <Box ref={captureRef as any}>
          <Text color={theme.color.muted}>No log entries yet.</Text>
        </Box>
      ) : (
        <Box ref={captureRef as any} height={listHeight} flexDirection="column">
          <VirtualList
            ref={listRef}
            items={items}
            height={listHeight}
            renderItem={renderItem}
            selectedIndex={selectedIndex}
          />
        </Box>
      )}
    </Panel>
  );
}
