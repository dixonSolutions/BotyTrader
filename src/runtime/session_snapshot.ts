/**
 * Persists a tiny summary when the orchestrator stops so the next launch can
 * show "previous session" stats without touching secrets or full logs.
 */

import fs from "node:fs";
import path from "node:path";

export const SESSION_SNAPSHOT_FILENAME = ".botytrader-last-session.json";

export interface SessionSnapshotV1 {
  v: 1;
  endedAt: string;
  startedAt: string;
  cyclesCompleted: number;
  lastSymbol: string | null;
  lastAction: string | null;
  lastReasoningSnippet: string | null;
}

export type PreviousSessionSummary = Omit<SessionSnapshotV1, "v">;

export function readSessionSnapshot(root: string): PreviousSessionSummary | null {
  try {
    const file = path.join(root, SESSION_SNAPSHOT_FILENAME);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as SessionSnapshotV1;
    if (raw.v !== 1 || typeof raw.endedAt !== "string") return null;
    return {
      endedAt: raw.endedAt,
      startedAt: raw.startedAt,
      cyclesCompleted: raw.cyclesCompleted,
      lastSymbol: raw.lastSymbol ?? null,
      lastAction: raw.lastAction ?? null,
      lastReasoningSnippet: raw.lastReasoningSnippet ?? null,
    };
  } catch {
    return null;
  }
}

export function writeSessionSnapshot(root: string, snap: PreviousSessionSummary): void {
  const payload: SessionSnapshotV1 = { v: 1, ...snap };
  const file = path.join(root, SESSION_SNAPSHOT_FILENAME);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function clipReasoning(text: string | null, max = 400): string | null {
  if (text === null || text === "") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
