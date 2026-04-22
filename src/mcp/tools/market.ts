/**
 * Market data tools — OHLCV history and derived technical indicators.
 *
 * Both delegate to the active BrokerAdapter so paper/live and adapter choice
 * stay consistent across the app.
 */

import { computeIndicators } from "../../signal/technical.js";
import type { ToolDefinition } from "./types.js";

export const priceHistoryTool: ToolDefinition = {
  name: "get_price_history",
  description: "Daily OHLCV bars for `symbol` over the last `days` days.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      days: { type: "number", default: 30 },
    },
    required: ["symbol"],
  },
  async handler(args, ctx) {
    const { symbol, days = 30 } = args as { symbol: string; days?: number };
    const bars = await ctx.broker.getPriceHistory(symbol, days);
    return { bars };
  },
};

export const technicalIndicatorsTool: ToolDefinition = {
  name: "get_technical_indicators",
  description: "Compute technical indicators (e.g. sma20, rsi14) for `symbol` from recent closes.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      indicators: {
        type: "array",
        items: { type: "string" },
        description: "Indicator ids like 'sma20', 'rsi14'.",
        default: ["sma20", "rsi14"],
      },
      days: { type: "number", default: 60 },
    },
    required: ["symbol"],
  },
  async handler(args, ctx) {
    const { symbol, indicators = ["sma20", "rsi14"], days = 60 } = args as {
      symbol: string;
      indicators?: string[];
      days?: number;
    };
    const bars = await ctx.broker.getPriceHistory(symbol, days);
    const closes = bars.map((b) => b.c);
    return { values: computeIndicators(closes, indicators) };
  },
};
