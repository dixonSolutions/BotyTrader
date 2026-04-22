/**
 * News tool — delegates to the broker adapter (e.g. Alpaca News) when the
 * adapter exposes `getNews`. Adapters without news support return an empty
 * array; a future revision can plug NewsAPI here as a fallback.
 */

import type { ToolDefinition } from "./types.js";

export const newsSearchTool: ToolDefinition = {
  name: "search_news",
  description: "Recent news headlines for `symbol`.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      limit: { type: "number", default: 10 },
    },
    required: ["symbol"],
  },
  async handler(args, ctx) {
    const { symbol, limit = 10 } = args as { symbol: string; limit?: number };
    if (!ctx.broker.getNews) return { items: [] };
    const items = await ctx.broker.getNews(symbol, limit);
    return { items };
  },
};
