/**
 * Portfolio tools — read-only views over the active broker adapter.
 * Order submission is intentionally NOT exposed here (see docs/mcp-server.md).
 */

import type { ToolDefinition } from "./types.js";

export const portfolioStateTool: ToolDefinition = {
  name: "get_portfolio_state",
  description: "Current account summary (equity, cash, buying power) and open positions.",
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const [account, positions] = await Promise.all([
      ctx.broker.getAccount(),
      ctx.broker.listPositions(),
    ]);
    return {
      equity: account.equity,
      cash: account.cash,
      buying_power: account.buyingPower,
      currency: account.currency,
      positions,
    };
  },
};

export const orderHistoryTool: ToolDefinition = {
  name: "get_order_history",
  description: "Recent orders, optionally filtered by `symbol`.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      limit: { type: "number", default: 50 },
    },
  },
  async handler(args, ctx) {
    const { symbol, limit = 50 } = args as { symbol?: string; limit?: number };
    const orders = await ctx.broker.listOrders({ symbol, limit });
    return { orders };
  },
};
