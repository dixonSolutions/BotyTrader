/**
 * Vector store backed by a Hugging Face Storage Bucket.
 *
 * Serialisation: JSON-lines for portability + transparency. The whole index is
 * loaded into memory once per process (write-through to remote on append).
 *
 * For large indexes this should later move to Arrow/Parquet, but the public
 * API of `MemoryStore` (search / append / sync) is stable.
 */

import type { Embedder } from "./embedder.js";
import type { HfBucket } from "./hf.js";

export interface MemoryRecord {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchHit {
  record: MemoryRecord;
  score: number;
}

export interface MemoryStoreOptions {
  bucket: HfBucket;
  embedder: Embedder;
  indexKey?: string;
  metaKey?: string;
}

const SCHEMA_VERSION = 1;

export class MemoryStore {
  private readonly bucket: HfBucket;
  private readonly embedder: Embedder;
  private readonly indexKey: string;
  private readonly metaKey: string;

  private records: MemoryRecord[] = [];
  private loaded = false;

  constructor(opts: MemoryStoreOptions) {
    this.bucket = opts.bucket;
    this.embedder = opts.embedder;
    this.indexKey = opts.indexKey ?? "index.jsonl";
    this.metaKey = opts.metaKey ?? "meta.json";
  }

  /** Pull the latest index from the bucket — call on startup. */
  async sync(): Promise<void> {
    const bytes = await this.bucket.getObject(this.indexKey);
    if (!bytes) {
      this.records = [];
      this.loaded = true;
      return;
    }
    const text = new TextDecoder().decode(bytes);
    const records: MemoryRecord[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as MemoryRecord);
      } catch {
        // Skip malformed lines rather than failing the whole load.
      }
    }
    this.records = records;
    this.loaded = true;
  }

  /** Embed `text` and return the top-k most similar records by cosine. */
  async search(text: string, k = 5): Promise<SearchHit[]> {
    if (!this.loaded) await this.sync();
    if (this.records.length === 0) return [];

    const query = await this.embedder.embed(text);
    const hits: SearchHit[] = this.records.map((record) => ({
      record,
      score: cosine(query, record.vector),
    }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** Embed text + metadata, append, and write through to the bucket. */
  async append(
    text: string,
    metadata: Record<string, unknown> = {},
  ): Promise<MemoryRecord> {
    if (!this.loaded) await this.sync();
    const vector = await this.embedder.embed(text);
    const record: MemoryRecord = {
      id: cryptoRandomId(),
      text,
      vector,
      metadata,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    await this.flush();
    return record;
  }

  /** Number of records currently held locally. */
  size(): number {
    return this.records.length;
  }

  /** Most recent N records (for the Memory TUI screen). */
  recent(limit = 20): MemoryRecord[] {
    return this.records.slice(-limit).reverse();
  }

  private async flush(): Promise<void> {
    const lines = this.records.map((r) => JSON.stringify(r)).join("\n");
    await this.bucket.putObject(this.indexKey, lines + "\n");
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      lastUpdated: new Date().toISOString(),
      count: this.records.length,
      dim: this.embedder.dimensions(),
    };
    await this.bucket.putObject(this.metaKey, JSON.stringify(meta, null, 2));
  }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function cryptoRandomId(): string {
  // Node 20 has globalThis.crypto — fallback kept tiny for safety.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
