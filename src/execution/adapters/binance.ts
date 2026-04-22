/**
 * Binance adapter — scaffold only.
 *
 * Implement against Binance Spot API: https://binance-docs.github.io/apidocs/spot/en/
 * Methods throw `NotImplementedError` until wired so the TUI shows a clear
 * message instead of silent failures.
 */

import type {
  AccountSummary,
  BrokerAdapter,
  Order,
  OrderRequest,
  PriceBar,
  Position,
} from "../broker.js";

export interface BinanceAdapterOptions {
  apiKey: string;
  apiSecret: string;
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`BinanceAdapter.${method} is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

export class BinanceAdapter implements BrokerAdapter {
  readonly name = "Binance";

  constructor(_opts: BinanceAdapterOptions) {}

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
