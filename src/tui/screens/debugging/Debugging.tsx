/**
 * Debugging screen — run individual agents in isolation and watch their
 * detailed logs stream in real time.
 *
 * Two modes (tabs):
 *   Trading    → runs portfolio + candidate cycles, streams "trading"
 *   Optimizer  → runs the walk-forward optimizer, streams "optimizer"
 *
 * All system logs (orchestrator lifecycle) are surfaced on every tab through
 * the "system" channel so context is never hidden.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useMouse } from "@zenobius/ink-mouse";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";

import { Button, ButtonGroup } from "../../components/Button.js";
import { Footer, Header, Panel } from "../../components/Layout.js";
import { TabBarClickable, type TabItem } from "../../components/TabBarClickable.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import type { LogService, LogChannel, ServiceLogEntry, LogLevel } from "../../../services/logService.js";

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type DebugMode = "trading" | "optimizer";

const TABS: readonly TabItem<DebugMode>[] = [
  { id: "trading", label: "Trading" },
  { id: "optimizer", label: "Optimizer" },
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

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  logService: LogService;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Level colour mapping (mirrors theme.level but includes "debug")
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Debugging({ orchestrator, state, logService, onBack }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const scrollRef = useRef<ScrollViewRef>(null);

  const [mode, setMode] = useState<DebugMode>("trading");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Seed with recent entries for the active channel on mount / tab change
  useEffect(() => {
    const channel: LogChannel = TAB_CHANNEL[mode];
    const recent = logService.getRecent(channel, 200).map(entryToLine);
    // Also interleave recent system logs for context
    const system = logService.getRecent("system", 50).map(entryToLine);
    const merged = [...recent, ...system]
      .sort((a, b) => b.id - a.id)
      .filter((v, i, arr) => i === 0 || arr[i - 1]!.id !== v.id);
    setLogs(merged.slice(0, 300));
  }, [mode, logService]);

  // Subscribe to the active channel + system for real-time updates
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

  // Wheel scroll
  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null) return;
      scrollRef.current?.scrollBy(dir === "scrollup" ? -WHEEL_STEP : WHEEL_STEP);
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------
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
  const logPanelHeight = Math.max(10, Math.min(LOG_VIEWPORT, rows - 18));
  const activeTab = TABS.find((t) => t.id === mode)!;

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      {/* Header */}
      <Box flexShrink={0}>
        <Header
          breadcrumb={["Debugging"]}
          brokerName={state.brokerName}
          connected={state.connected}
          onBack={onBack}
        />
      </Box>

      {/* Body */}
      <Box flexDirection="column" paddingX={theme.padding} paddingY={1} flexGrow={1} minHeight={0}>
        <Box marginBottom={1} flexDirection="column">
          <Text bold color={theme.color.primary}>
            Debugging
          </Text>
          <Text color={theme.color.muted}>Run agents in isolation and stream their logs in real time.</Text>
        </Box>

        {/* Tab bar — uses shared TabBarClickable for consistent styling */}
        <Box marginBottom={1}>
          <TabBarClickable tabs={TABS} current={mode} onSelect={setMode} />
        </Box>

        {/* Controls panel */}
        <Panel title="Controls" accent={theme.color.accent}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={2}>
              <Text color={theme.color.muted}>Agent:</Text>
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
              <Button
                label="Clear"
                icon={icons.reset}
                onClick={clearLogs}
                variant="ghost"
                minWidth={8}
              />
            </ButtonGroup>
          </Box>
        </Panel>

        {/* Live log panel */}
        <Panel
          title={`Live Logs — ${activeTab.label} + System (${logs.length} entries, newest first)`}
          accent={theme.color.primary}
        >
          <Box height={logPanelHeight} overflow="hidden">
            <ScrollView ref={scrollRef} height={logPanelHeight}>
              {logs.length === 0 ? (
                <Text color={theme.color.muted}>No logs yet. Click Run to start the {activeTab.label} agent.</Text>
              ) : (
                logs.map((line) => <LogRow key={line.id} line={line} />)
              )}
            </ScrollView>
          </Box>
        </Panel>
      </Box>

      {/* Footer */}
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Click a tab then Run to execute that agent",
            "Logs stream in real time — newest entries appear at the top",
            "Stop aborts a running task · Clear flushes the log panel",
          ]}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Log row sub-component
// ---------------------------------------------------------------------------

function LogRow({ line }: { line: LogLine }): React.ReactElement {
  const time = line.ts.slice(11, 23); // HH:MM:SS.mmm
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entryToLine(entry: ServiceLogEntry): LogLine {
  return {
    id: entry.id,
    ts: entry.ts,
    level: entry.level,
    channel: entry.channel,
    message: entry.message,
  };
}
