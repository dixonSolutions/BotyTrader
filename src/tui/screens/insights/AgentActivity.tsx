/**
 * Agent session strip — previous run snapshot, schedule, live step, reasoning.
 * Complements vitals with "what is it doing / why" without opening logs.
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../../theme.js";
import type { OrchestratorState } from "../../../orchestrator.js";

interface Props {
  state: OrchestratorState;
}

export function AgentActivity({ state }: Props): React.ReactElement {
  const prev = state.previousSession;
  const nextLine = formatNextCycle(state);
  const liveLine = formatLive(state);
  const reasoning = state.lastCompletedReasoning?.trim() || null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.color.muted}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.color.accent}>
        Agent session
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Previous run (last exit) </Text>
        <Text color={theme.color.text}>
          {prev
            ? `${fmtTs(prev.endedAt)} · ${prev.cyclesCompleted} cycle(s) · last ${prev.lastSymbol ?? "—"} ${prev.lastAction ?? ""}${prev.lastReasoningSnippet ? ` · “${prev.lastReasoningSnippet}”` : ""}`
            : "No snapshot yet — quit once with `q` to save a summary."}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Next automatic cycle </Text>
        <Text color={theme.color.text}>{nextLine}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Right now </Text>
        <Text color={state.cycling ? theme.color.warn : theme.color.text}>{liveLine}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Latest reasoning </Text>
        <Text color={theme.color.text}>{reasoning ? softWrap(reasoning, 96) : "— (runs after each cycle completes)"}</Text>
      </Box>
    </Box>
  );
}

function formatNextCycle(state: OrchestratorState): string {
  if (state.status === "paused") return "Paused — resume with `p` to arm the timer.";
  if (state.watchlist.length === 0) return "Watchlist empty — add symbols in Config.";
  if (state.cycling) return "Timer held until this cycle finishes; then interval resumes.";
  if (!state.nextScheduledCycleAt) return "— (arming…)";
  return `${relativeFromNow(state.nextScheduledCycleAt)} · ${fmtTs(state.nextScheduledCycleAt)} · every ${state.agentIntervalSeconds}s`;
}

function formatLive(state: OrchestratorState): string {
  if (state.cycling && state.agentLive) {
    const { symbol, phase, detail } = state.agentLive;
    return `${symbol} · ${phase}${detail ? ` · ${detail}` : ""}`;
  }
  if (state.cycling) return "Working…";
  if (state.lastCycleAt) return `Idle · last cycle ${relativeFromNowPast(state.lastCycleAt)}`;
  return "Idle · no cycle completed yet this session.";
}

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function relativeFromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return iso;
  if (ms <= 0) return "due now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

function relativeFromNowPast(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function softWrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!w) continue;
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > width ? `${w.slice(0, width - 1)}…` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}
