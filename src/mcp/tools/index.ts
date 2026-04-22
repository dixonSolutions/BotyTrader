/**
 * MCP tool registry — single source of truth for what the agent can call.
 * Adding a new tool is one append here plus one file under `./`.
 */

import type { Config, Secrets } from "../../config.js";
import { priceHistoryTool, technicalIndicatorsTool } from "./market.js";
import { newsSearchTool } from "./news.js";
import { orderHistoryTool, portfolioStateTool } from "./portfolio.js";
import { webSearchTool } from "./web_search.js";
import type { ToolDefinition } from "./types.js";

export const toolRegistry: ToolDefinition[] = [
  webSearchTool,
  priceHistoryTool,
  technicalIndicatorsTool,
  newsSearchTool,
  portfolioStateTool,
  orderHistoryTool,
];

/** Tools exposed to the LLM and standalone MCP — respects `config.features.web_search_enabled` and `BRAVE_API_KEY`. */
export function toolsForRuntime(config: Config, secrets: Secrets): ToolDefinition[] {
  const allowBrave =
    config.features.web_search_enabled && Boolean(secrets.BRAVE_API_KEY?.trim());
  return toolRegistry.filter((t) => t.name !== "brave_web_search" || allowBrave);
}

export function resolveTool(name: string, config: Config, secrets: Secrets): ToolDefinition | undefined {
  return toolsForRuntime(config, secrets).find((t) => t.name === name);
}

export type { ToolDefinition, ToolContext } from "./types.js";
