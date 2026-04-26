/**
 * Hugging Face Hub model search (read-only JSON API).
 * Used by the Models TUI “Hub” tab so users can browse ids before install or API selection.
 */

export interface HubModelSummary {
  id: string;
  pipeline_tag?: string;
  likes?: number;
  downloads?: number;
}

interface HubApiModel {
  id?: string;
  modelId?: string;
  pipeline_tag?: string;
  likes?: number;
  downloads?: number;
}

/**
 * Search public models on huggingface.co. No token required for this endpoint.
 */
export async function searchHubModels(query: string, limit = 30): Promise<HubModelSummary[]> {
  const q = query.trim() || "llama";
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}&sort=downloads&direction=-1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hub search failed (${res.status}): ${res.statusText}`);
  }
  const data = (await res.json()) as HubApiModel[];
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    id: row.id ?? row.modelId ?? "",
    pipeline_tag: row.pipeline_tag,
    likes: row.likes,
    downloads: row.downloads,
  })).filter((m) => m.id.length > 0);
}
