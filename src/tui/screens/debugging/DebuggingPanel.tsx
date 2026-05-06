/**
 * Embedded debugging — trading vs optimizer log channels with run/clear controls.
 * Used from Insights → Bot; previously a standalone screen.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { useMouse } from "@zenobius/ink-mouse";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { RefObject } from "react";

import { Button, ButtonGroup } from "../../components/Button.js";
import { Panel } from "../../components/Layout.js";
import { TabBarClickable, type TabItem } from "../../components/TabBarClickable.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { copyTextToClipboard } from "../../clipboard.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";
import type { Orchestrator } from "../../../orchestrator.js";
import type { LogService, LogChannel, ServiceLogEntry, LogLevel } from "../../../services/logService.js";

type DebugMode = "trading" | "optimizer";

const TABS: readonly TabItem<DebugMode>[] = [
  { id: "trading", label: "Trading logs" },
  { id: "optimizer", label: "Optimizer logs" },
];

const TAB_CHANNEL: Record<DebugMode, LogChannel> = {
  trading: "trading",
  optimizer: "optimizer",
};

const LOG_VIEWPORT = 28;
const WHEEL_STEP = 3;

type RunStatus = "idle" | "running" | "done" | "error";

interface LogLine {
  id: number;
  ts: string;
  level: LogLevel;
  channel: LogChannel;
  message: string;
}

export interface DebuggingPanelProps {
  orchestrator: Orchestrator;
  logService: LogService;
  /** Max height (lines) for the log scroll area. */
  logViewportLines?: number;
  /** Wheel hit target: parent skips outer scroll when pointer is over this box. */
  logWheelCaptureRef?: RefObject<DOMElement | null>;
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case "error":
      return theme.color.danger;
    case "warn":
      return theme.color.warn;
    case "agent":
      return theme.color.primary;
    case "debug":
      return theme.color.muted;
    default:
      return theme.color.text;
  }
}

function levelBadge(level: LogLevel): string {
  switch (level) {
    case "error":
      return "ERR ";
    case "warn":
      return "WARN";
    case "agent":
      return "AGNT";
    case "debug":
      return "DBUG";
    default:
      return "INFO";
  }
}

function formatDebugLogsForExport(lines: LogLine[]): string {
  return lines.map((l) => `${l.ts} [${l.channel}] ${levelBadge(l.level)} ${l.message}`).join("\n");
}

export function DebuggingPanel({
  orchestrator,
  logService,
  logViewportLines,
  logWheelCaptureRef,
}: DebuggingPanelProps): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const scrollRef = useRef<ScrollViewRef>(null);
  const defaultWheelRef = useRef<DOMElement | null>(null);
  const wheelRef = logWheelCaptureRef ?? defaultWheelRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };

  const [mode, setMode] = useState<DebugMode>("trading");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const copyHintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyHintTimer.current) clearTimeout(copyHintTimer.current);
    };
  }, []);

  useEffect(() => {
    const channel: LogChannel = TAB_CHANNEL[mode];
    const recent = logService.getRecent(channel, 200).map(entryToLine);
    const system = logService.getRecent("system", 50).map(entryToLine);
    const merged = [...recent, ...system]
      .sort((a, b) => b.id - a.id)
      .filter((v, i, arr) => i === 0 || arr[i - 1]!.id !== v.id);
    setLogs(merged.slice(0, 300));
  }, [mode, logService]);

  useEffect(() => {
    const channel: LogChannel = TAB_CHANNEL[mode];

    const handleEntry = (entry: ServiceLogEntry): void => {
      setLogs((prev) => [entryToLine(entry), ...prev].slice(0, 500));
    };

    const unsubChannel = logService.subscribeChannel(channel, handleEntry);
    const unsubSystem = logService.subscribeChannel("system", handleEntry);

    return () => {
      unsubChannel();
      unsubSystem();
    };
  }, [mode, logService]);

  useEffect(() => {
    const onScroll = (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null) return;
      const box = getTerminalCellBounds(wheelRef);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;
      scrollRef.current?.scrollBy(dir === "scrollup" ? -WHEEL_STEP : WHEEL_STEP);
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, wheelRef]);

  function clearLogs(): void {
    logService.clear(TAB_CHANNEL[mode]);
    setLogs([]);
  }

  const handleRun = useCallback(async () => {
    if (runStatus === "running") return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setRunStatus("running");
    try {
      if (mode === "trading") {
        await orchestrator.runTradingNow();
      } else {
        await orchestrator.runOptimizationNow();
      }
      setRunStatus("done");
    } catch {
      setRunStatus("error");
    }
  }, [mode, orchestrator, runStatus]);

  function handleStop(): void {
    abortRef.current?.abort();
    setRunStatus("idle");
  }

  function statusLabel(): string {
    switch (runStatus) {
      case "running":
        return "● Running";
      case "done":
        return "✓ Done";
      case "error":
        return "✕ Error";
      default:
        return "○ Idle";
    }
  }

  function statusColor(): string {
    switch (runStatus) {
      case "running":
        return theme.color.warn;
      case "done":
        return theme.color.success;
      case "error":
        return theme.color.danger;
      default:
        return theme.color.muted;
    }
  }

  const rows = stdout.rows ?? 30;
  const defaultLogH = Math.max(8, Math.min(LOG_VIEWPORT, rows - 18));
  const logPanelHeight = logViewportLines ?? defaultLogH;
  const activeTab = TABS.find((t) => t.id === mode)!;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.color.primary}>
          Live debugging
        </Text>
        <Text color={theme.color.muted}>Stream trading or optimizer channels (plus system). Run from here or Actions above.</Text>
      </Box>

      <Box marginBottom={1}>
        <TabBarClickable tabs={TABS} current={mode} onSelect={setMode} />
      </Box>

      <Panel title="Log controls" accent={theme.color.accent}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text color={theme.color.muted}>Channel:</Text>
            <Text color={theme.color.text} bold>
              {activeTab.label}
            </Text>
            <Text color={theme.color.muted}>Status:</Text>
            <Text color={statusColor()} bold>
              {statusLabel()}
            </Text>
          </Box>
          <ButtonGroup>
            <Button
              label="Run"
              icon={icons.play}
              onClick={() => {
                void handleRun();
              }}
              variant="success"
              disabled={runStatus === "running"}
              minWidth={8}
            />
            <Button
              label="Stop"
              icon={icons.close}
              onClick={handleStop}
              variant="danger"
              disabled={runStatus !== "running"}
              minWidth={8}
            />
            <Button label="Clear" icon={icons.reset} onClick={clearLogs} variant="ghost" minWidth={8} />
            <Button
              label="Copy logs"
              icon={icons.bullet}
              onClick={() => {
                const text = formatDebugLogsForExport(logs);
                const { ok, detail } = copyTextToClipboard(text);
                if (copyHintTimer.current) clearTimeout(copyHintTimer.current);
                setCopyHint(ok ? "Copied to clipboard." : `Copy failed: ${detail}`);
                copyHintTimer.current = setTimeout(() => {
                  setCopyHint(null);
                  copyHintTimer.current = undefined;
                }, 4000);
              }}
              disabled={logs.length === 0}
              variant="secondary"
              minWidth={12}
            />
          </ButtonGroup>
        </Box>
      </Panel>

      {copyHint ? (
        <Box marginBottom={1}>
          <Text color={copyHint.startsWith("Copy failed") ? theme.color.warn : theme.color.success}>{copyHint}</Text>
        </Box>
      ) : null}

      <Panel
        title={`${activeTab.label} + system (${logs.length} newest-first)`}
        accent={theme.color.primary}
      >
        <Box ref={wheelRef} height={logPanelHeight} overflow="hidden">
          <ScrollView ref={scrollRef} height={logPanelHeight}>
            {logs.length === 0 ? (
              <Text color={theme.color.muted}>No logs yet. Run the agent or use Actions → Run.</Text>
            ) : (
              logs.map((line) => <LogRow key={line.id} line={line} />)
            )}
          </ScrollView>
        </Box>
      </Panel>
    </Box>
  );
}

function LogRow({ line }: { line: LogLine }): React.ReactElement {
  const time = line.ts.slice(11, 23);
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={theme.color.muted}>{time} </Text>
      <Text color={levelColor(line.level)} bold>
        {levelBadge(line.level)}{" "}
      </Text>
      <Text color={theme.color.muted}>[{line.channel.slice(0, 4)}] </Text>
      <Text color={levelColor(line.level)} wrap="wrap">
        {line.message}
      </Text>
    </Box>
  );
}

function entryToLine(entry: ServiceLogEntry): LogLine {
  return {
    id: entry.id,
    ts: entry.ts,
    level: entry.level,
    channel: entry.channel,
    message: entry.message,
  };
}
