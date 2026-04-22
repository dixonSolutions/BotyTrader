/**
 * Coinbase adapter — scaffold only.
 *
 * Implement against Coinbase Advanced Trade API:
 * https://docs.cloud.coinbase.com/advanced-trade-api/docs/welcome
 *
 * Methods that are not yet implemented throw `NotImplementedError` so the
 * orchestrator surfaces a clear message in the TUI rather than silently
 * returning empty data.
 */

import type {
  AccountSummary,
  BrokerAdapter,
  Order,
  OrderRequest,
  PriceBar,
  Position,
} from "../broker.js";

export interface CoinbaseAdapterOptions {
  apiKey: string;
  apiSecret: string;
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`CoinbaseAdapter.${method} is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

export class CoinbaseAdapter implements BrokerAdapter {
  readonly name = "Coinbase";

  // Credentials are accepted now so the constructor signature matches the
  // factory; they will be wired in when the adapter is implemented.
  constructor(_opts: CoinbaseAdapterOptions) {}

  async ping(): Promise<boolean> {
    return false;
  }

  async submitOrder(_req: OrderRequest): Promise<Order> {
    throw new NotImplementedError("submitOrder");
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new NotImplementedError("cancelOrder");
  }

  async listOrders(): Promise<Order[]> {
    throw new NotImplementedError("listOrders");
  }

  async getAccount(): Promise<AccountSummary> {
    throw new NotImplementedError("getAccount");
  }

  async listPositions(): Promise<Position[]> {
    throw new NotImplementedError("listPositions");
  }

  async getPriceHistory(_symbol: string, _days: number): Promise<PriceBar[]> {
    throw new NotImplementedError("getPriceHistory");
  }
}
