/**
 * `submit_order` action — orchestrator-only path from a validated Decision
 * to a broker order. Enforces risk gates (autotrade flag, confidence floor)
 * BEFORE the order leaves the process.
 *
 * Lives in `actions/` (not `mcp/tools/`) so the agent cannot bypass these
 * checks by calling it directly.
 */

import type { BrokerAdapter, Order } from "../execution/broker.js";
import type { Config } from "../config.js";
import type { Decision } from "./types.js";

export interface SubmitOrderResult {
  submitted: boolean;
  order?: Order;
  reason?: string;
}

export async function submitOrder(
  decision: Decision,
  config: Config,
  broker: BrokerAdapter,
): Promise<SubmitOrderResult> {
  if (!config.autotrade.enabled) {
    return { submitted: false, reason: "autotrade.enabled is false" };
  }
  if (decision.action === "hold") {
    return { submitted: false, reason: "decision is hold" };
  }
  if (decision.confidence < config.risk.min_confidence_to_trade) {
    return {
      submitted: false,
      reason: `confidence ${decision.confidence} < min_confidence_to_trade ${config.risk.min_confidence_to_trade}`,
    };
  }
  if (decision.qty <= 0) {
    return { submitted: false, reason: "qty must be > 0 for buy/sell/close" };
  }

  const side = decision.action === "sell" || decision.action === "close" ? "sell" : "buy";
  const isFractional = decision.qty % 1 !== 0;
  if (isFractional && decision.limitPrice !== undefined) {
    return { submitted: false, reason: "fractional Alpaca orders must be market orders" };
  }
  const type = isFractional ? "market" : (decision.limitPrice !== undefined ? "limit" : "market");

  const order = await broker.submitOrder({
    symbol: decision.symbol,
    side,
    qty: decision.qty,
    type,
    limitPrice: type === "limit" ? decision.limitPrice : undefined,
    timeInForce: "day",
  });
  return { submitted: true, order };
}
