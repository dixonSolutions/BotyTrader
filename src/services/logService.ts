/**
 * LogService — real-time, channel-scoped log bus.
 *
 * Services push entries via `push(channel, level, message)`.
 * The TUI (or any consumer) subscribes globally or per-channel and receives
 * entries as they arrive without polling state.
 *
 * Channels:
 *   "system"     — orchestrator lifecycle, pings, config changes
 *   "trading"    — portfolio / candidate evaluations, order decisions
 *   "optimizer"  — walk-forward optimization, challenger scoring
 *
 * Entries are prepended to an in-memory ring buffer (newest-first) so callers
 * can call `getRecent()` to hydrate a fresh subscriber without replaying the
 * full event stream.
 */

import { EventEmitter } from "node:events";

export type LogLevel = "info" | "warn" | "error" | "debug" | "agent";
export type LogChannel = "system" | "trading" | "optimizer";

export interface ServiceLogEntry {
  id: number;
  ts: string;
  channel: LogChannel;
  level: LogLevel;
  message: string;
}

/** Maximum entries kept across all channels. */
const BUFFER_MAX = 2000;
let _idCounter = 0;

export class LogService extends EventEmitter {
  private buffer: ServiceLogEntry[] = [];

  /**
   * Append a log entry. Emits:
   *   "log"          — every entry (global listener)
   *   "log:<channel>" — per-channel listener
   */
  push(channel: LogChannel, level: LogLevel, message: string): ServiceLogEntry {
    const entry: ServiceLogEntry = {
      id: ++_idCounter,
      ts: new Date().toISOString(),
      channel,
      level,
      message,
    };
    this.buffer = [entry, ...this.buffer].slice(0, BUFFER_MAX);
    this.emit("log", entry);
    this.emit(`log:${channel}`, entry);
    return entry;
  }

  /** Subscribe to all channels. Returns an unsubscribe function. */
  subscribe(cb: (entry: ServiceLogEntry) => void): () => void {
    this.on("log", cb);
    return () => this.off("log", cb);
  }

  /** Subscribe to a single channel. Returns an unsubscribe function. */
  subscribeChannel(channel: LogChannel, cb: (entry: ServiceLogEntry) => void): () => void {
    const event = `log:${channel}`;
    this.on(event, cb);
    return () => this.off(event, cb);
  }

  /**
   * Return recent entries from the ring buffer.
   * Caller receives them newest-first (index 0 = most recent).
   */
  getRecent(channel?: LogChannel, limit = 500): ServiceLogEntry[] {
    const entries = channel
      ? this.buffer.filter((e) => e.channel === channel)
      : this.buffer;
    return entries.slice(0, limit);
  }

  /** Flush the buffer for a specific channel, or all channels. */
  clear(channel?: LogChannel): void {
    this.buffer = channel
      ? this.buffer.filter((e) => e.channel !== channel)
      : [];
    this.emit("cleared", channel ?? null);
  }
}
