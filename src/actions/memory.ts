/**
 * `summarize_to_memory` action — orchestrator-only path that turns a finished
 * cycle into a single, embeddable summary string and persists it via the
 * MemoryStore (which writes through to the HF Storage Bucket).
 */

import type { MemoryStore } from "../memory/store.js";
import type { Decision } from "./types.js";

export interface CycleData {
  symbol: string;
  decision: Decision;
  toolCalls: { name: string; args: unknown }[];
  startedAt: string;
  finishedAt: string;
}

export async function summarizeToMemory(
  cycle: CycleData,
  store: MemoryStore,
): Promise<void> {
  const lines: string[] = [
    `Symbol: ${cycle.symbol}`,
    `Decision: ${cycle.decision.action.toUpperCase()} qty=${cycle.decision.qty} confidence=${cycle.decision.confidence}`,
    `Reasoning: ${cycle.decision.reasoning}`,
  ];
  if (cycle.toolCalls.length > 0) {
    lines.push(`Tools used: ${cycle.toolCalls.map((t) => t.name).join(", ")}`);
  }
  const summary = lines.join("\n");

  await store.append(summary, {
    symbol: cycle.symbol,
    action: cycle.decision.action,
    confidence: cycle.decision.confidence,
    startedAt: cycle.startedAt,
    finishedAt: cycle.finishedAt,
  });
}
