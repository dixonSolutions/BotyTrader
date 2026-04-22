/**
 * Thin wrapper around `@huggingface/transformers` text-generation pipelines.
 *
 * Responsibilities (single):
 *   - Lazily construct ONE pipeline per process for the active model id.
 *   - Forward a chat message list through the model's tokenizer chat template.
 *   - Surface download progress to the orchestrator (used by the Models TUI).
 *
 * The library is ESM-only and pulls a few MB of native ONNX runtime, so we
 * import lazily on first use to keep startup fast for users who only browse
 * Config / Models without running a cycle.
 */

import path from "node:path";

import type { Config } from "../config.js";
import { resolveModelCacheDir } from "../config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  /** Hard limit on completion tokens for THIS call (defaults to model.max_new_tokens). */
  maxNewTokens?: number;
  /** Greedy if false, sampling otherwise. ReAct loops should stay deterministic by default. */
  doSample?: boolean;
  /** Stop strings — generation truncates as soon as one appears. */
  stop?: string[];
}

/**
 * Mirrors the shape emitted by `@huggingface/transformers`. We re-declare it
 * here so the rest of the codebase doesn't need to import the library's
 * deep types for a single callback.
 */
export type ProgressEvent =
  | { status: "initiate"; name: string; file: string }
  | { status: "download"; name: string; file: string }
  | {
      status: "progress";
      name: string;
      file: string;
      loaded: number;
      total: number;
      progress: number;
    }
  | {
      status: "progress_total";
      name: string;
      loaded: number;
      total: number;
      progress: number;
      files: Record<string, { loaded: number; total: number }>;
    }
  | { status: "done"; name: string; file: string }
  | { status: "ready"; task: string; model: string };

export type ProgressCallback = (event: ProgressEvent) => void;

interface PipelineLike {
  (
    messages: ChatMessage[],
    options: { max_new_tokens: number; do_sample: boolean; return_full_text: boolean },
  ): Promise<{ generated_text: string | ChatMessage[] }[]>;
  dispose?: () => Promise<void>;
}

let cached: { id: string; pipe: PipelineLike } | null = null;

/**
 * Returns (and caches) a text-generation pipeline for the given config.
 *
 * IMPORTANT: progress callbacks fire only on the *first* load per model id.
 * Subsequent calls reuse the cached pipeline and skip the download.
 */
export async function getLocalPipeline(
  config: Config,
  onProgress?: ProgressCallback,
): Promise<PipelineLike> {
  const id = config.model.id.trim();
  if (!id) {
    throw new Error(
      "No local model selected. Open the Models screen (m from Home) to install and select one.",
    );
  }
  if (cached && cached.id === id) return cached.pipe;
  if (cached && cached.id !== id) {
    try {
      await cached.pipe.dispose?.();
    } catch {
      // Best-effort dispose — older versions of transformers.js may not implement it.
    }
    cached = null;
  }

  const transformers = await import("@huggingface/transformers");
  configureCacheDir(transformers, config);

  const pipe = (await transformers.pipeline("text-generation", id, {
    dtype: config.model.dtype === "auto" ? undefined : config.model.dtype,
    device: config.model.device === "auto" ? undefined : config.model.device,
    progress_callback: onProgress,
  })) as unknown as PipelineLike;

  cached = { id, pipe };
  return pipe;
}

/** Drop the cached pipeline so the next call downloads/loads from scratch. */
export async function disposeLocalPipeline(): Promise<void> {
  if (!cached) return;
  try {
    await cached.pipe.dispose?.();
  } catch {
    /* ignore */
  }
  cached = null;
}

/**
 * Generate one assistant turn from a chat transcript.
 *
 * `stop` is enforced *after* generation by truncation — most ONNX models do
 * not yet expose token-level stop strings via transformers.js, so we do this
 * post-hoc to keep the ReAct parser predictable.
 */
export async function generateChat(
  config: Config,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  const pipe = await getLocalPipeline(config);
  const out = await pipe(messages, {
    max_new_tokens: opts.maxNewTokens ?? config.model.max_new_tokens,
    do_sample: opts.doSample ?? false,
    return_full_text: false,
  });

  const first = out?.[0]?.generated_text;
  let text = "";
  if (typeof first === "string") {
    text = first;
  } else if (Array.isArray(first)) {
    const last = first.at(-1);
    text = last?.content ?? "";
  }
  return applyStops(text, opts.stop ?? []);
}

function applyStops(text: string, stops: string[]): string {
  if (stops.length === 0) return text;
  let cut = text.length;
  for (const s of stops) {
    if (!s) continue;
    const idx = text.indexOf(s);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return text.slice(0, cut);
}

/**
 * Point transformers.js at our project-local cache directory so users can
 * see, audit, and delete every byte they download.
 */
function configureCacheDir(
  transformers: { env: { cacheDir: string | null; allowLocalModels: boolean; useFSCache: boolean } },
  config: Config,
): void {
  const dir = resolveModelCacheDir(config);
  transformers.env.cacheDir = dir;
  transformers.env.allowLocalModels = true;
  transformers.env.useFSCache = true;
  // Some users move the cache between machines — make the absolute path obvious in logs.
  void path; // path import kept for future use (e.g. local model loading)
}
