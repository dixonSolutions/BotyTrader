/**
 * MCP server entry point — exposes the tool registry over stdio.
 *
 * In-process use: the agent loop calls `runTool(name, args)` directly via
 * the registry, no transport involved. This file is the standalone variant
 * that lets external MCP clients (Claude Desktop, Cursor, etc.) discover
 * and call the same tools.
 *
 * Run with `npm run mcp` (uses tsx) for development.
 *
 * Standalone stdio must **not** start when this module is bundled into the
 * main TUI (`dist/index.js`): a loose `import.meta.url === argv` check would
 * match the bundle entry, attach a second stdin consumer, and break Ink /
 * Buffer.concat in the MCP transport.
 */

import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, loadSecrets, type Config } from "../config.js";
import { createBrokerAdapter } from "../execution/adapters/index.js";
import { resolveTool, toolsForRuntime } from "./tools/index.js";
import type { ToolContext } from "./tools/index.js";

export async function runStandaloneMcpServer(): Promise<void> {
  const config = loadConfig();
  const secretsResult = loadSecrets(config);
  if (!secretsResult.ok) {
    throw new Error(
      `Cannot start MCP server: missing secrets ${secretsResult.missing.join(", ")}`,
    );
  }
  const broker = createBrokerAdapter(config.broker.platform, secretsResult.secrets);
  const ctx: ToolContext = { broker, secrets: secretsResult.secrets };

  const server = new Server(
    { name: "botytrader-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsForRuntime(config, secretsResult.secrets).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = resolveTool(req.params.name, config, secretsResult.secrets);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(req.params.arguments ?? {}, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** Direct dispatch for in-process use (agent loop). */
export async function callTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
  config: Config,
): Promise<unknown> {
  const tool = resolveTool(name, config, ctx.secrets);
  if (!tool) throw new Error(`Unknown or disabled tool: ${name}`);
  return tool.handler(args, ctx);
}

function launchedAsMcpStdioServer(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = path.resolve(entry).replace(/\\/g, "/");
  return /\/mcp\/server\.(ts|js|cjs|mjs)$/.test(norm);
}

// `npm run mcp` → `tsx src/mcp/server.ts` (path ends with `/mcp/server.ts`)
if (launchedAsMcpStdioServer()) {
  runStandaloneMcpServer().catch((err) => {
    console.error("MCP server failed:", err);
    process.exit(1);
  });
}
