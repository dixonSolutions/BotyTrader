/**
 * FinBERT / sentiment classification via @huggingface/transformers (local) or HF Inference API.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { HfInference } from "@huggingface/inference";

import type { Config, Secrets } from "../../config.js";
import { resolveModelCacheDir, resolvePaths } from "../../config.js";
import { queryHubModel, syncHubTokenFromSecrets } from "../../llm/hf_hub.js";
import type { ProgressCallback } from "../../llm/local_model.js";
import { hashHeadline, type TradingRepositories } from "../storage/repositories.js";

/**
 * Canonical FinBERT card / HF Inference API id (PyTorch hub layout).
 * @see https://huggingface.co/ProsusAI/finbert
 */
export const SUPPORTED_SENTIMENT_REPO_ID = "ProsusAI/finbert";

/**
 * Local `@huggingface/transformers` (Node) needs `tokenizer.json` + ONNX weights.
 * `ProsusAI/finbert` does not ship that layout; Xenova hosts the FinBERT ONNX port.
 * @see https://huggingface.co/Xenova/finbert
 */
export const LOCAL_TRANSFORMERS_FINBERT_REPO = "Xenova/finbert";

/** Hub id actually passed to `pipeline("text-classification", …)` when `provider === local_finbert`. */
export function localSentimentPipelineModelId(config: Config): string {
  const id = config.sentiment.model_id.trim();
  if (!id || id === SUPPORTED_SENTIMENT_REPO_ID) {
    return LOCAL_TRANSFORMERS_FINBERT_REPO;
  }
  return id;
}

/** Rich progress for TUI (PrimeNG-style progress bar mapping is UI-side). */
export type SentimentInstallPhase = "preparing" | "downloading" | "verifying" | "complete" | "error";

export interface SentimentInstallProgress {
  phase: SentimentInstallPhase;
  message: string;
  file?: string;
  loaded?: number;
  total?: number;
  /** 0..1 when known; null when indeterminate. */
  fraction: number | null;
}

export interface ScoredHeadline {
  text: string;
  score: number; // -1..1
  label: "positive" | "neutral" | "negative" | null;
  confidence: number | null;
  fromCache: boolean;
}

type Classifier = (text: string) => Promise<unknown>;

type DisposablePipe = ((text: string) => Promise<unknown>) & { dispose?: () => Promise<void> };

interface CachedClassifier {
  key: string;
  fn: Classifier;
  raw: DisposablePipe;
}

let cached: CachedClassifier | null = null;

/** Monotonic batch counter for `hybrid_finbert` API vs local scheduling (one step per `aggregateNewsSentiment` call). */
let hybridBatchRunCounter = 0;

/** After HF Inference returns HTTP 429 / rate limit, avoid remote calls until this timestamp (ms). */
let hfApiRateLimitBackoffUntil = 0;

const HF_API_BACKOFF_MS = 90_000;

function isHfRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/429|rate limit|too many requests|quota/i.test(msg)) return true;
  const o = err as { status?: number; statusCode?: number };
  const s = typeof o?.status === "number" ? o.status : typeof o?.statusCode === "number" ? o.statusCode : null;
  return s === 429;
}

/**
 * Whether this news-sentiment batch should call HF Inference (hybrid mode only;
 * pure `huggingface_api` ignores this — scoreHeadline uses provider alone).
 */
export function shouldUseRemoteFinbertThisBatch(config: Config, secrets: Secrets): boolean {
  if (config.sentiment.provider !== "hybrid_finbert") return false;
  const den = Math.max(1, Math.floor(config.sentiment.hf_api_runs_denominator));
  const num = Math.max(0, Math.min(Math.floor(config.sentiment.hf_api_runs_numerator), den));
  if (num === 0) return false;
  if (num >= den) {
    return !!secrets.HF_TOKEN?.trim() && Date.now() >= hfApiRateLimitBackoffUntil;
  }
  const slot = hybridBatchRunCounter % den;
  hybridBatchRunCounter += 1;
  if (slot >= num) return false;
  if (!secrets.HF_TOKEN?.trim()) return false;
  if (Date.now() < hfApiRateLimitBackoffUntil) return false;
  return true;
}

async function applySentimentTransformersCache(config: Config): Promise<void> {
  const { env } = await import("@huggingface/transformers");
  const cache = resolveModelCacheDir(config, resolvePaths());
  // Node / Ink TUI — IndexedDB is unavailable; browser cache throws "not available in this environment".
  env.useBrowserCache = false;
  env.useFSCache = true;
  env.cacheDir = cache;
  if ("allowLocalModels" in env) {
    (env as { allowLocalModels?: boolean }).allowLocalModels = true;
  }
}

/**
 * Drop the cached classifier so the next load re-reads weights from disk
 * (e.g. after `installLocalSentimentWeights`).
 */
export async function disposeSentimentClassifierCache(): Promise<void> {
  if (!cached) return;
  try {
    await cached.raw.dispose?.();
  } catch {
    /* ignore */
  }
  cached = null;
}

function cacheKey(config: Config): string {
  return `${localSentimentPipelineModelId(config)}:${config.model.cache_dir}:${config.model.dtype}`;
}

/**
 * Map HF text-classification output to score in [-1,1] and a coarse label.
 */
function mapLabelScore(raw: unknown): { label: "positive" | "neutral" | "negative" | null; score: number; confidence: number | null } {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") {
    return { label: null, score: 0, confidence: null };
  }
  const o = row as { label?: string; score?: number; logits?: number[] };
  if (typeof o.label === "string") {
    const l = o.label.toLowerCase();
    const conf = typeof o.score === "number" ? o.score : null;
    if (l.includes("pos")) return { label: "positive", score: 1, confidence: conf };
    if (l.includes("neg")) return { label: "negative", score: -1, confidence: conf };
    return { label: "neutral", score: 0, confidence: conf };
  }
  return { label: null, score: 0, confidence: null };
}

/**
 * FinBERT 3-class: use positive and negative prob if available; else map label.
 */
function mapFinbertProbs(
  raw: unknown,
): { label: "positive" | "neutral" | "negative" | null; score: number; confidence: number | null } {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (row && typeof row === "object") {
    const o = row as { label?: string; score?: number; logits?: number[] };
    if (o.label) return mapLabelScore(raw);
  }
  return mapLabelScore(raw);
}

export async function getLocalClassifier(
  config: Config,
  onProgress?: (msg: string) => void,
): Promise<Classifier> {
  const key = cacheKey(config);
  if (cached && cached.key === key) {
    return cached.fn;
  }
  if (cached) {
    await disposeSentimentClassifierCache();
  }
  onProgress?.("Loading sentiment model…");
  await applySentimentTransformersCache(config);
  const { pipeline } = await import("@huggingface/transformers");

  const modelId = localSentimentPipelineModelId(config);
  const pipe = (await pipeline("text-classification", modelId)) as DisposablePipe;

  const fn: Classifier = async (text: string) => pipe(text);
  cached = { key, fn, raw: pipe };
  onProgress?.("Sentiment model ready.");
  return fn;
}

/**
 * Download FinBERT text-classification weights into `model.cache_dir` via
 * transformers.js (same cache as runtime). Does not update `config.sentiment`;
 * call `setSentimentConfig` / warm after this succeeds.
 *
 * Pass `AbortSignal` so the UI can request cancel: disposes the pipeline when
 * possible; in-flight Hub fetches may still finish briefly.
 *
 * Pass `secrets` so `HF_TOKEN` is copied into `process.env` for Transformers.js
 * and for `@huggingface/hub` metadata queries before download.
 */
export async function installLocalSentimentWeights(
  config: Config,
  onProgress?: (p: SentimentInstallProgress) => void,
  signal?: AbortSignal,
  secrets?: Secrets,
): Promise<void> {
  let activePipe: DisposablePipe | null = null;
  const disposeActivePipe = async (): Promise<void> => {
    const p = activePipe;
    activePipe = null;
    if (!p) return;
    try {
      await p.dispose?.();
    } catch {
      /* ignore */
    }
  };

  const emit = (p: SentimentInstallProgress): void => {
    onProgress?.(p);
  };

  signal?.addEventListener(
    "abort",
    () => {
      void disposeActivePipe();
    },
    { passive: true },
  );

  if (signal?.aborted) {
    throw new DOMException("Install cancelled", "AbortError");
  }

  if (secrets) {
    syncHubTokenFromSecrets(secrets);
  }

  await disposeSentimentClassifierCache();
  emit({ phase: "preparing", message: "Clearing in-memory classifier cache…", fraction: null });
  await applySentimentTransformersCache(config);

  if (signal?.aborted) {
    throw new DOMException("Install cancelled", "AbortError");
  }

  const pipelineId = localSentimentPipelineModelId(config);

  try {
    emit({ phase: "preparing", message: "Querying Hugging Face Hub…", fraction: null });
    const hubTok = secrets?.HF_TOKEN?.trim();
    const meta = await queryHubModel(pipelineId, hubTok);
    signal?.throwIfAborted();
    emit({
      phase: "preparing",
      message: `Hub: ${meta.name}${meta.gated ? " (gated — token required)" : ""} · ${meta.pipelineTag ?? "?"}`,
      fraction: null,
    });
  } catch (e) {
    if (signal?.aborted) {
      throw new DOMException("Install cancelled", "AbortError");
    }
    emit({
      phase: "preparing",
      message: `Hub query skipped: ${e instanceof Error ? e.message : String(e)}`,
      fraction: null,
    });
  }

  emit({
    phase: "downloading",
    message: `Hub: ${pipelineId} (Transformers.js cache) — card ${SUPPORTED_SENTIMENT_REPO_ID}`,
    fraction: 0,
  });

  const { pipeline } = await import("@huggingface/transformers");

  const progressCb: ProgressCallback = (e) => {
    if (signal?.aborted) return;
    if (e.status === "progress" && e.total > 0) {
      emit({
        phase: "downloading",
        message: "Downloading",
        file: e.file,
        loaded: e.loaded,
        total: e.total,
        fraction: Math.min(1, e.loaded / e.total),
      });
    } else if (e.status === "progress_total") {
      const frac = e.total > 0 ? Math.min(1, e.loaded / e.total) : null;
      emit({
        phase: "downloading",
        message: "Overall transfer",
        fraction: frac,
      });
    } else if (e.status === "download" || e.status === "initiate") {
      emit({
        phase: "downloading",
        message: e.status === "initiate" ? `Starting: ${e.file}` : `Fetching: ${e.file}`,
        file: e.file,
        fraction: null,
      });
    } else if (e.status === "ready") {
      emit({ phase: "verifying", message: `${e.task} — ${e.model}`, fraction: 1 });
    } else if (e.status === "done") {
      emit({ phase: "downloading", message: `Finished: ${e.file}`, file: e.file, fraction: 1 });
    }
  };

  let pipe: DisposablePipe;
  try {
    pipe = (await pipeline("text-classification", pipelineId, {
      progress_callback: progressCb,
    })) as DisposablePipe;
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException("Install cancelled", "AbortError");
    }
    emit({
      phase: "error",
      message: err instanceof Error ? err.message : String(err),
      fraction: null,
    });
    throw err;
  }

  activePipe = pipe;

  if (signal?.aborted) {
    await disposeActivePipe();
    throw new DOMException("Install cancelled", "AbortError");
  }

  emit({ phase: "verifying", message: "Warm probe — running a short classification…", fraction: 1 });
  try {
    await pipe("Markets were mixed today.");
  } catch {
    /* optional */
  }

  if (signal?.aborted) {
    await disposeActivePipe();
    throw new DOMException("Install cancelled", "AbortError");
  }

  await disposeActivePipe();
  emit({ phase: "complete", message: "Artifacts cached — FinBERT is ready to load.", fraction: 1 });
}

/** On-disk directory for the repo Transformers.js uses in `local_finbert` mode. */
export function localSentimentModelCachePath(config: Config): string {
  const id = localSentimentPipelineModelId(config);
  const root = resolveModelCacheDir(config, resolvePaths());
  return path.join(root, ...id.split("/").filter(Boolean));
}

/**
 * Remove downloaded ONNX / tokenizer files for the active local sentiment repo.
 * Does not change config; call after disposing the engine if needed.
 */
export async function removeLocalSentimentArtifacts(config: Config): Promise<{ path: string; removed: boolean }> {
  const dir = localSentimentModelCachePath(config);
  await disposeSentimentClassifierCache();
  try {
    await fs.access(dir);
  } catch {
    return { path: dir, removed: false };
  }
  await fs.rm(dir, { recursive: true, force: true });
  return { path: dir, removed: true };
}

export type ScoreHeadlineOpts = {
  onProgress?: (m: string) => void;
  /**
   * Set by `aggregateNewsSentiment` for `hybrid_finbert`: this batch should try HF Inference first.
   * Ignored for other providers.
   */
  preferRemoteApi?: boolean;
};

async function classifyViaHfInference(
  config: Config,
  secrets: Secrets,
  repo: TradingRepositories,
  trimmed: string,
  h: string,
  ttlMs: number,
): Promise<ScoredHeadline> {
  const token = secrets.HF_TOKEN?.trim();
  if (!token) {
    return { text: trimmed, score: 0, label: "neutral", confidence: null, fromCache: false };
  }
  const hf = new HfInference(token);
  const out = await hf.textClassification({
    model: config.sentiment.model_id,
    inputs: trimmed,
  });
  const { score, label, confidence } = mapClassificationArray(out);
  repo.setSentimentCache({
    headlineHash: h,
    headline: trimmed,
    modelId: config.sentiment.model_id,
    label,
    score,
    confidence,
    ttlMs,
  });
  return { text: trimmed, score, label, confidence, fromCache: false };
}

async function classifyViaLocalFinbert(
  config: Config,
  secrets: Secrets,
  repo: TradingRepositories,
  trimmed: string,
  h: string,
  ttlMs: number,
  onProgress?: (m: string) => void,
): Promise<ScoredHeadline> {
  syncHubTokenFromSecrets(secrets);
  const pipe = await getLocalClassifier(config, onProgress);
  const raw = await pipe(trimmed);
  const mapped = mapFinbertProbs(raw);
  const score = mapped.label === "positive" ? 1 : mapped.label === "negative" ? -1 : 0;
  const soft = typeof (raw as { score?: number })?.score === "number" && mapped.label
    ? mapped.label === "positive"
      ? (raw as { score: number }).score
      : mapped.label === "negative"
        ? -(raw as { score: number }).score
        : 0
    : score;
  const finalScore = clampSoft(soft);

  repo.setSentimentCache({
    headlineHash: h,
    headline: trimmed,
    modelId: config.sentiment.model_id,
    label: mapped.label,
    score: finalScore,
    confidence: mapped.confidence,
    ttlMs,
  });
  return { text: trimmed, score: finalScore, label: mapped.label, confidence: mapped.confidence, fromCache: false };
}

export async function scoreHeadline(
  config: Config,
  secrets: Secrets,
  repo: TradingRepositories,
  text: string,
  opts: ScoreHeadlineOpts = {},
): Promise<ScoredHeadline> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", score: 0, label: "neutral", confidence: null, fromCache: true };
  }
  const h = hashHeadline(trimmed);
  const ttlMs = config.sentiment.cache_ttl_hours * 3_600_000;
  const hit = repo.getSentimentCache(h);
  if (hit) {
    return {
      text: trimmed,
      score: hit.score,
      label: hit.label,
      confidence: hit.confidence,
      fromCache: true,
    };
  }

  if (config.sentiment.provider === "disabled") {
    return { text: trimmed, score: 0, label: "neutral", confidence: null, fromCache: false };
  }

  const token = secrets.HF_TOKEN?.trim();
  const wantsRemote =
    config.sentiment.provider === "huggingface_api" ||
    (config.sentiment.provider === "hybrid_finbert" && opts.preferRemoteApi === true);
  const canHitRemote = !!token && Date.now() >= hfApiRateLimitBackoffUntil;

  if (config.sentiment.provider === "huggingface_api" && !token) {
    return { text: trimmed, score: 0, label: "neutral", confidence: null, fromCache: false };
  }

  if (wantsRemote && canHitRemote) {
    try {
      return await classifyViaHfInference(config, secrets, repo, trimmed, h, ttlMs);
    } catch (err) {
      if (isHfRateLimitError(err)) {
        hfApiRateLimitBackoffUntil = Date.now() + HF_API_BACKOFF_MS;
        opts.onProgress?.(
          `HF Inference rate limited — ${Math.round(HF_API_BACKOFF_MS / 1000)}s cooldown; using local FinBERT.`,
        );
      } else {
        opts.onProgress?.(`HF Inference error: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Fall through to local when possible (hybrid, or huggingface_api fallback after remote failure).
    }
  }

  const useLocal =
    config.sentiment.provider === "local_finbert" ||
    config.sentiment.provider === "hybrid_finbert" ||
    config.sentiment.provider === "huggingface_api";

  if (!useLocal) {
    return { text: trimmed, score: 0, label: "neutral", confidence: null, fromCache: false };
  }

  try {
    return await classifyViaLocalFinbert(config, secrets, repo, trimmed, h, ttlMs, opts.onProgress);
  } catch (err) {
    opts.onProgress?.(`Sentiment error: ${err instanceof Error ? err.message : String(err)}`);
    return { text: trimmed, score: 0, label: "neutral", confidence: null, fromCache: false };
  }
}

function clampSoft(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

/**
 * HF Inference returns multiple classes with label + score.
 */
function mapClassificationArray(
  rows: { label: string; score: number }[],
): { score: number; label: "positive" | "neutral" | "negative" | null; confidence: number | null } {
  let pos = 0;
  let neg = 0;
  let best: { label: "positive" | "neutral" | "negative" | null; score: number } = {
    label: null,
    score: 0,
  };
  for (const r of rows) {
    const l = r.label.toLowerCase();
    if (l.includes("pos")) pos = Math.max(pos, r.score);
    if (l.includes("neg")) neg = Math.max(neg, r.score);
    if (l.includes("pos") || l.includes("neg") || l.includes("neu")) {
      if (r.score > best.score) {
        if (l.includes("pos")) best = { label: "positive", score: r.score };
        else if (l.includes("neg")) best = { label: "negative", score: r.score };
        else best = { label: "neutral", score: r.score };
      }
    }
  }
  if (pos > 0 || neg > 0) {
    return { score: clampSoft(pos - neg), label: best.label, confidence: Math.max(pos, neg) };
  }
  if (rows[0]) {
    const s = mapLabelScore(rows[0] as unknown);
    return { score: s.score, label: s.label, confidence: s.confidence };
  }
  return { score: 0, label: "neutral", confidence: null };
}

/**
 * Weighted average of headline scores: recency — newer first.
 */
export async function aggregateNewsSentiment(
  config: Config,
  secrets: Secrets,
  repo: TradingRepositories,
  headlines: { title: string; publishedAt: string }[],
  opts: { onProgress?: (m: string) => void; maxItems?: number } = {},
): Promise<{ sentimentScore: number; scored: number }> {
  if (headlines.length === 0) {
    return { sentimentScore: 0, scored: 0 };
  }
  const max = opts.maxItems ?? 10;
  const slice = headlines.slice(0, max);
  const preferRemoteApi = shouldUseRemoteFinbertThisBatch(config, secrets);
  let wSum = 0;
  let sSum = 0;
  const now = Date.now();
  for (let i = 0; i < slice.length; i++) {
    const t = slice[i]!;
    const sc = await scoreHeadline(config, secrets, repo, t.title, { ...opts, preferRemoteApi });
    const ageH = (now - Date.parse(t.publishedAt)) / 3_600_000;
    const w = 1 / (1 + Math.max(0, ageH) * 0.1) * (1 / (i + 1));
    wSum += w;
    sSum += w * sc.score;
  }
  if (wSum === 0) return { sentimentScore: 0, scored: 0 };
  return { sentimentScore: clampSoft(sSum / wSum), scored: slice.length };
}
