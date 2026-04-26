/**
 * BrokerAdapter — broker-agnostic interface used by the orchestrator,
 * MCP tools (`market`, `portfolio`), and execution actions.
 *
 * Concrete adapters live in `./adapters/`. The orchestrator picks one based
 * on `broker.platform` in config.toml so the rest of the app never has a
 * direct dependency on Alpaca, Coinbase, or Binance SDKs.
 */

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  qty: number;
  type?: OrderType;
  limitPrice?: number;
  timeInForce?: TimeInForce;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  filledQty: number;
  status: string;
  submittedAt: string;
  filledAvgPrice?: number;
}

export interface Position {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export interface AccountSummary {
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
}

export interface PriceBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  summary?: string;
  /** Related tickers when the feed provides them (e.g. Alpaca). */
  symbols?: string[];
}

/** Options for {@link BrokerAdapter.searchNews}. */
export interface NewsSearchOpts {
  /** After pagination (and keyword filter), keep at most this many rows. Omit = no cap. */
  maxArticles?: number;
}

export interface BrokerAdapter {
  /** Display name surfaced to the TUI / logs (e.g. "Alpaca (paper)"). */
  readonly name: string;

  /** Cheap connectivity probe — used by the Dashboard. */
  ping(): Promise<boolean>;

  // Orders
  submitOrder(req: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  listOrders(opts?: { symbol?: string; limit?: number }): Promise<Order[]>;

  // Account / portfolio
  getAccount(): Promise<AccountSummary>;
  listPositions(): Promise<Position[]>;

  // Market data
  getPriceHistory(symbol: string, days: number): Promise<PriceBar[]>;

  /**
   * Optional — adapters that don't expose news return [].
   * The MCP `news` tool falls back to NewsAPI when this returns empty.
   */
  getNews?(symbol: string, limit: number): Promise<NewsItem[]>;

  /**
   * Optional rich news lookup: symbol list (`AAPL` or `AAPL,MSFT`) or free-text
   * (fetches a broad feed and filters client-side when the API has no keyword param).
   * Implementations should page until the feed ends (honour `maxArticles` if set).
   */
  searchNews?(query: string, opts?: NewsSearchOpts): Promise<NewsItem[]>;

  /**
   * Optional — best-effort top-of-book / depth snapshot. Implementations may
   * synthesise a single-level book from L1 quotes when full L2 isn't available.
   */
  getOrderBook?(symbol: string, depth?: number): Promise<OrderBookSnapshot>;
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  ts: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}
