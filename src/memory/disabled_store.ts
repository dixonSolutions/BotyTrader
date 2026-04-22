/**
 * No-op memory backend when `features.memory_enabled` is false in config.toml.
 * Avoids Gemini / Hugging Face calls while keeping API keys in `.env` unchanged.
 */

import type { MemoryRecord, MemoryStore, SearchHit } from "./store.js";

export class DisabledMemoryStore {
  async sync(): Promise<void> {}

  async search(_text: string, _k = 5): Promise<SearchHit[]> {
    return [];
  }

  async append(text: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    return {
      id: "memory_disabled",
      text,
      vector: [],
      metadata,
      createdAt: new Date().toISOString(),
    };
  }

  size(): number {
    return 0;
  }

  recent(_limit = 20): MemoryRecord[] {
    return [];
  }
}

export type WorkingMemoryStore = MemoryStore | DisabledMemoryStore;
