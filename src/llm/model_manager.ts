/**
 * Local model manager — list, pull, select, and delete Hugging Face models.
 *
 * Storage layout (mirrors how `@huggingface/transformers` caches files):
 *
 *   <cache_dir>/
 *     <org>/<repo>/        ← e.g. onnx-community/Qwen2.5-0.5B-Instruct
 *       config.json
 *       tokenizer.json
 *       onnx/<weights>.onnx
 *       ...
 *
 * "Installed" means we have at least a `config.json` for the repo on disk.
 * Pulling reuses `pipeline()` because it runs the exact resolver + downloader
 * the runtime will use later, so what you install is exactly what you load.
 */

import fs from "node:fs";
import path from "node:path";

import type { Config, ModelProvider } from "../config.js";
import { resolveModelCacheDir, writeConfig } from "../config.js";
import { searchHubModels, type HubModelSummary } from "./hub_models.js";
import {
  disposeLocalPipeline,
  getLocalPipeline,
  type ProgressCallback,
} from "./local_model.js";

export interface InstalledModel {
  /** Full HF repo id, e.g. `onnx-community/Qwen2.5-0.5B-Instruct`. */
  id: string;
  /** Absolute path to the model's directory on disk. */
  path: string;
  /** Total on-disk size in bytes (sum of all files under `path`). */
  sizeBytes: number;
  /** Latest mtime under the directory — handy for "recently used" sorts. */
  modifiedAt: string;
}

export interface PullProgress {
  file: string;
  loaded: number;
  total: number;
  /** 0..1 once `total` is known, otherwise null. */
  fraction: number | null;
}

export class ModelManager {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /** Absolute root directory where models are cached. */
  get cacheDir(): string {
    return resolveModelCacheDir(this.config);
  }

  /** Currently selected model id (may be empty before first install / API pick). */
  get activeId(): string {
    return this.config.model.id.trim();
  }

  get provider(): ModelProvider {
    return this.config.model.provider;
  }

  /**
   * Switch between local ONNX/transformers.js and Hugging Face Inference API.
   * Clears the cached local pipeline when leaving local mode.
   */
  async setProvider(provider: ModelProvider): Promise<void> {
    if (this.config.model.provider === provider) return;
    this.config.model.provider = provider;
    writeConfig(this.config);
    await disposeLocalPipeline();
  }

  /**
   * Use a Hub model id for remote inference (sets provider to huggingface_api).
   */
  async setRemoteInferenceModel(modelId: string): Promise<void> {
    const id = modelId.trim();
    if (!id) throw new Error("Model id is empty.");
    this.config.model.provider = "huggingface_api";
    this.config.model.id = id;
    writeConfig(this.config);
    await disposeLocalPipeline();
  }

  /** Search huggingface.co for public model ids (browse tab). */
  async searchHub(query: string, limit = 30): Promise<HubModelSummary[]> {
    return searchHubModels(query, limit);
  }

  /** Walk the cache directory and return one entry per `<org>/<repo>` subtree. */
  listInstalled(): InstalledModel[] {
    const root = this.cacheDir;
    if (!fs.existsSync(root)) return [];

    const out: InstalledModel[] = [];
    for (const orgEntry of safeReaddir(root)) {
      const orgPath = path.join(root, orgEntry);
      if (!isDir(orgPath)) continue;
      // Two layouts are possible:
      //  (a) <org>/<repo>/config.json     (HF style)
      //  (b) <repo>/config.json           (when the user pulled a single-name id)
      if (containsModel(orgPath)) {
        out.push(describeModel(orgEntry, orgPath));
        continue;
      }
      for (const repoEntry of safeReaddir(orgPath)) {
        const repoPath = path.join(orgPath, repoEntry);
        if (!isDir(repoPath)) continue;
        if (!containsModel(repoPath)) continue;
        out.push(describeModel(`${orgEntry}/${repoEntry}`, repoPath));
      }
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /**
   * Pull a model id by running the same resolver the runtime uses. Progress
   * events are forwarded to `onProgress` (one per file) so the TUI can render
   * a real bar, not a fake one.
   */
  async pull(modelId: string, onProgress?: (p: PullProgress) => void): Promise<void> {
    const id = modelId.trim();
    if (!id) throw new Error("Model id is empty.");

    const cb: ProgressCallback = (event) => {
      if (!onProgress) return;
      if (event.status === "progress") {
        const total = event.total;
        const loaded = event.loaded;
        onProgress({
          file: event.file,
          loaded,
          total,
          fraction: total > 0 ? Math.min(1, loaded / total) : null,
        });
      } else if (event.status === "done" || event.status === "initiate" || event.status === "download") {
        onProgress({ file: event.file, loaded: 0, total: 0, fraction: null });
      }
    };

    // Temporarily set this id into config so the cached pipeline keys on it,
    // pull, then restore the previous active id (the user must select it
    // explicitly via `select()` — pulling never silently switches models).
    const previousId = this.config.model.id;
    this.config.model.id = id;
    try {
      await disposeLocalPipeline();
      await getLocalPipeline(this.config, cb);
    } finally {
      this.config.model.id = previousId;
      await disposeLocalPipeline();
    }
  }

  /**
   * Select an installed model as the active reasoning LLM.
   * Persists to config.toml and clears the in-memory pipeline cache so the
   * next cycle constructs the new model.
   */
  async select(modelId: string): Promise<void> {
    const id = modelId.trim();
    if (!id) throw new Error("Cannot select an empty model id.");
    this.config.model.id = id;
    writeConfig(this.config);
    await disposeLocalPipeline();
  }

  /** Recursively delete a model from disk. Refuses paths outside the cache root. */
  async delete(modelId: string): Promise<void> {
    const installed = this.listInstalled().find((m) => m.id === modelId);
    if (!installed) throw new Error(`Model not installed: ${modelId}`);
    const root = path.resolve(this.cacheDir);
    const target = path.resolve(installed.path);
    if (!target.startsWith(root + path.sep) && target !== root) {
      // Defence in depth — never let a crafted id walk out of the cache dir.
      throw new Error("Refusing to delete: path is outside the model cache directory.");
    }
    await fs.promises.rm(target, { recursive: true, force: true });
    // Drop the parent org dir if it is now empty.
    const parent = path.dirname(target);
    if (parent !== root) {
      try {
        const remaining = await fs.promises.readdir(parent);
        if (remaining.length === 0) await fs.promises.rmdir(parent);
      } catch {
        /* ignore */
      }
    }
    if (this.activeId === modelId) {
      this.config.model.id = "";
      writeConfig(this.config);
      await disposeLocalPipeline();
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function containsModel(dir: string): boolean {
  // A model dir is anything that has a config.json or an onnx/ subdir.
  if (fs.existsSync(path.join(dir, "config.json"))) return true;
  if (fs.existsSync(path.join(dir, "onnx")) && isDir(path.join(dir, "onnx"))) return true;
  return false;
}

function describeModel(id: string, dirPath: string): InstalledModel {
  const { sizeBytes, latestMs } = scanTree(dirPath);
  return {
    id,
    path: dirPath,
    sizeBytes,
    modifiedAt: new Date(latestMs).toISOString(),
  };
}

function scanTree(root: string): { sizeBytes: number; latestMs: number } {
  let sizeBytes = 0;
  let latestMs = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        try {
          const st = fs.statSync(child);
          sizeBytes += st.size;
          if (st.mtimeMs > latestMs) latestMs = st.mtimeMs;
        } catch {
          /* ignore vanished files */
        }
      }
    }
  }
  return { sizeBytes, latestMs };
}

/** Format a byte count for human display ("3.4 GB", "812 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
