/**
 * Hugging Face Hub helpers via `@huggingface/hub`.
 *
 * Transformers.js reads `process.env.HF_TOKEN` / `HF_ACCESS_TOKEN` for Hub
 * fetches; this module syncs from parsed `Secrets` when `.env` was not loaded
 * on that process, and exposes typed query helpers (model metadata, file tree).
 */

import { listFiles, modelInfo } from "@huggingface/hub";

import type { Secrets } from "../config.js";

/** Mirrors Transformers.js Node hub client env lookup. */
export function syncHubTokenFromSecrets(secrets: Secrets): void {
  const t = secrets.HF_TOKEN?.trim();
  if (!t) return;
  if (!process.env.HF_TOKEN?.trim()) process.env.HF_TOKEN = t;
  if (!process.env.HF_ACCESS_TOKEN?.trim()) process.env.HF_ACCESS_TOKEN = t;
}

export interface HubModelQuerySummary {
  id: string;
  name: string;
  gated: false | "auto" | "manual" | undefined;
  private: boolean | undefined;
  downloads: number | undefined;
  pipelineTag: string | undefined;
  updatedAt: Date;
}

export async function queryHubModel(
  repoId: string,
  accessToken?: string,
): Promise<HubModelQuerySummary> {
  const name = repoId.trim();
  const info = await modelInfo({
    name,
    ...(accessToken?.trim() ? { accessToken: accessToken.trim() } : {}),
  });
  return {
    id: info.id,
    name: info.name,
    gated: info.gated,
    private: info.private,
    downloads: info.downloads,
    pipelineTag: info.task,
    updatedAt: info.updatedAt,
  };
}

export interface HubListedFile {
  path: string;
  size: number;
}

/**
 * Lists all files under the repo (recursive). Uses the Hub API; pass a token
 * for private or gated models you have access to.
 */
export async function listHubRepoFiles(
  repoId: string,
  opts: { accessToken?: string; signal?: AbortSignal } = {},
): Promise<HubListedFile[]> {
  const name = repoId.trim();
  const accessToken = opts.accessToken?.trim();
  const out: HubListedFile[] = [];
  const gen = listFiles({
    repo: name,
    recursive: true,
    ...(accessToken ? { accessToken } : {}),
  });
  for await (const e of gen) {
    opts.signal?.throwIfAborted();
    if (e.type === "file") {
      out.push({ path: e.path, size: e.size });
    }
  }
  return out;
}
