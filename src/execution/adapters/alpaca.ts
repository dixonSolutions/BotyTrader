/**
 * Alpaca adapter — paper or live, selected by `broker.platform` in config.toml.
 *
 * Uses Alpaca's REST endpoints directly (no SDK dependency) so the binary
 * stays small and the surface stays explicit. All authenticated calls go
 * through `request()` which centralises auth headers and error handling.
 */

import type {
  AccountSummary,
  BrokerAdapter,
  NewsItem,
  Order,
  OrderBookSnapshot,
  OrderRequest,
  PriceBar,
  Position,
} from "../broker.js";

export interface AlpacaAdapterOptions {
  apiKey: string;
  apiSecret: string;
  paper: boolean;
}

const DATA_BASE = "https://data.alpaca.markets/v2";
const NEWS_BASE = "https://data.alpaca.markets/v1beta1/news";

export class AlpacaAdapter implements BrokerAdapter {
  readonly name: string;
  private readonly tradingBase: string;
  private readonly headers: HeadersInit;

  constructor(opts: AlpacaAdapterOptions) {
    this.name = opts.paper ? "Alpaca (paper)" : "Alpaca (live)";
    this.tradingBase = opts.paper
      ? "https://paper-api.alpaca.markets/v2"
      : "https://api.alpaca.markets/v2";
    this.headers = {
      "APCA-API-KEY-ID": opts.apiKey,
      "APCA-API-SECRET-KEY": opts.apiSecret,
      "Content-Type": "application/json",
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.request<unknown>(`${this.tradingBase}/account`);
      return true;
    } catch {
      return false;
    }
  }

  async submitOrder(req: OrderRequest): Promise<Order> {
    const body = {
      symbol: req.symbol,
      qty: req.qty,
      side: req.side,
      type: req.type ?? "market",
      time_in_force: req.timeInForce ?? "day",
      ...(req.limitPrice !== undefined ? { limit_price: req.limitPrice } : {}),
    };
    const raw = await this.request<AlpacaOrder>(`${this.tradingBase}/orders`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return mapOrder(raw);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request(`${this.tradingBase}/orders/${orderId}`, { method: "DELETE" });
  }

  async listOrders(opts?: { symbol?: string; limit?: number }): Promise<Order[]> {
    const params = new URLSearchParams();
    params.set("status", "all");
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.symbol) params.set("symbols", opts.symbol);
    const raw = await this.request<AlpacaOrder[]>(
      `${this.tradingBase}/orders?${params.toString()}`,
    );
    return raw.map(mapOrder);
  }

  async getAccount(): Promise<AccountSummary> {
    const raw = await this.request<AlpacaAccount>(`${this.tradingBase}/account`);
    return {
      equity: Number(raw.equity),
      cash: Number(raw.cash),
      buyingPower: Number(raw.buying_power),
      currency: raw.currency ?? "USD",
    };
  }

  async listPositions(): Promise<Position[]> {
    const raw = await this.request<AlpacaPosition[]>(`${this.tradingBase}/positions`);
    return raw.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      marketValue: Number(p.market_value),
      unrealizedPnl: Number(p.unrealized_pl),
    }));
  }

  async getPriceHistory(symbol: string, days: number): Promise<PriceBar[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const sym = symbol.toUpperCase();
    // Multi-symbol bars API — default feed is `sip` (paid); `iex` works on free/paper.
    const params = new URLSearchParams({
      symbols: sym,
      timeframe: "1Day",
      start: start.toISOString(),
      end: end.toISOString(),
      limit: "10000",
      adjustment: "raw",
      feed: "iex",
      sort: "asc",
    });
    const url = `${DATA_BASE}/stocks/bars?${params.toString()}`;
    const raw = await this.request<{ bars?: Record<string, AlpacaBar[]> }>(url);
    const series = raw.bars?.[sym] ?? raw.bars?.[symbol] ?? [];
    return series.map((b) => ({
      t: b.t,
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
    }));
  }

  async getOrderBook(symbol: string, _depth = 1): Promise<OrderBookSnapshot> {
    // Alpaca free tier exposes only L1 (top-of-book); we synthesise a
    // single-level book so the TUI can still render bid/ask without lying.
    const url = `${DATA_BASE}/stocks/${encodeURIComponent(symbol.toUpperCase())}/quotes/latest?feed=iex`;
    const raw = await this.request<{ quote?: AlpacaQuote }>(url);
    const q = raw.quote;
    const ts = q?.t ?? new Date().toISOString();
    return {
      symbol,
      ts,
      bids: q && q.bp > 0 ? [{ price: q.bp, size: q.bs }] : [],
      asks: q && q.ap > 0 ? [{ price: q.ap, size: q.as }] : [],
    };
  }

  async getNews(symbol: string, limit: number): Promise<NewsItem[]> {
    const params = new URLSearchParams({ symbols: symbol, limit: String(limit) });
    const url = `${NEWS_BASE}?${params.toString()}`;
    const raw = await this.request<{ news?: AlpacaNewsItem[] }>(url);
    return (raw.news ?? []).map((n) => ({
      title: n.headline,
      source: n.source,
      publishedAt: n.created_at,
      url: n.url,
      summary: n.summary,
    }));
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { ...init, headers: { ...this.headers, ...(init.headers ?? {}) } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Alpaca ${init.method ?? "GET"} ${url} -> ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Wire types — kept private to this module
// ---------------------------------------------------------------------------

interface AlpacaOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  filled_qty: string;
  status: string;
  submitted_at: string;
  filled_avg_price?: string;
}

interface AlpacaAccount {
  equity: string;
  cash: string;
  buying_power: string;
  currency?: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
  unrealized_pl: string;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaQuote {
  t: string;
  bp: number;
  bs: number;
  ap: number;
  as: number;
}

interface AlpacaNewsItem {
  headline: string;
  source: string;
  created_at: string;
  url: string;
  summary?: string;
}

function mapOrder(raw: AlpacaOrder): Order {
  return {
    id: raw.id,
    symbol: raw.symbol,
    side: raw.side,
    qty: Number(raw.qty),
    filledQty: Number(raw.filled_qty),
    status: raw.status,
    submittedAt: raw.submitted_at,
    filledAvgPrice: raw.filled_avg_price !== undefined ? Number(raw.filled_avg_price) : undefined,
  };
}
