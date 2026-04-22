/**
 * Brave Search — general web intelligence tool for the agent.
 * Endpoint: https://api.search.brave.com/res/v1/web/search
 */

import type { ToolDefinition } from "./types.js";

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

export const webSearchTool: ToolDefinition = {
  name: "brave_web_search",
  description: "Search the web with Brave Search. Use for general intel that's not market data or news.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      count: { type: "number", description: "Number of results (default 5).", default: 5 },
    },
    required: ["query"],
  },
  async handler(args, ctx) {
    const token = ctx.secrets.BRAVE_API_KEY;
    if (!token) {
      throw new Error(
        "Brave Search is not configured (set BRAVE_API_KEY in .env to enable brave_web_search).",
      );
    }
    const { query, count = 5 } = args as { query: string; count?: number };
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": token,
      },
    });
    if (!res.ok) {
      throw new Error(`Brave Search ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const data = (await res.json()) as BraveResponse;
    const results = (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description ?? "",
    }));
    return { results };
  },
};
