/**
 * Adapter factory — wires `broker.platform` from config.toml to a concrete
 * adapter, with required broker-specific secrets validated by `loadSecrets`.
 */

import type { BrokerPlatform, Secrets } from "../../config.js";
import type { BrokerAdapter } from "../broker.js";
import { AlpacaAdapter } from "./alpaca.js";
import { BinanceAdapter } from "./binance.js";
import { CoinbaseAdapter } from "./coinbase.js";

export function createBrokerAdapter(
  platform: BrokerPlatform,
  secrets: Secrets,
): BrokerAdapter {
  switch (platform) {
    case "alpaca_paper":
    case "alpaca_live":
      return new AlpacaAdapter({
        apiKey: required(secrets.ALPACA_API_KEY, "ALPACA_API_KEY"),
        apiSecret: required(secrets.ALPACA_API_SECRET, "ALPACA_API_SECRET"),
        paper: platform === "alpaca_paper",
      });
    case "coinbase":
      return new CoinbaseAdapter({
        apiKey: required(secrets.COINBASE_API_KEY, "COINBASE_API_KEY"),
        apiSecret: required(secrets.COINBASE_API_SECRET, "COINBASE_API_SECRET"),
      });
    case "binance":
      return new BinanceAdapter({
        apiKey: required(secrets.BINANCE_API_KEY, "BINANCE_API_KEY"),
        apiSecret: required(secrets.BINANCE_API_SECRET, "BINANCE_API_SECRET"),
      });
  }
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required secret ${name} for selected broker.`);
  }
  return value;
}
