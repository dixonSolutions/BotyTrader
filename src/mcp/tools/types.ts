/**
 * Shared types for MCP tool registration.
 *
 * Tools follow the MCP contract: each has a name, description, JSON-schema
 * input definition, and a handler that returns a text payload (the agent
 * sees the structured JSON inside the text content block).
 */

import type { BrokerAdapter } from "../../execution/broker.js";
import type { Secrets } from "../../config.js";

export interface ToolContext {
  broker: BrokerAdapter;
  secrets: Secrets;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
}
