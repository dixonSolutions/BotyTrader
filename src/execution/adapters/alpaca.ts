/**
 * Alpaca adapter — paper or live, selected by `broker.platform` in config.toml.
 *
 * Uses Alpaca's REST endpoints directly (no SDK dependency) so the binary
 * stays small and the surface stays explicit. All authenticated calls go
 * through `request()` which centralises auth headers and error handling.
 */

import type {
  AccountSummary,
  AssetInfo,
  BrokerAdapter,
  CashActivity,
  NewsItem,
  NewsSearchOpts,
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
    const isFractional = req.qty % 1 !== 0;
    const type = isFractional ? "market" : (req.type ?? "market");
    const body = {
      symbol: req.symbol,
      qty: req.qty,
      side: req.side,
      type,
      time_in_force: req.timeInForce ?? "day",
      ...(!isFractional && req.limitPrice !== undefined ? { limit_price: req.limitPrice } : {}),
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

  /**
   * Dividends, dividend withholdings, and cash interest — mirrors Alpaca’s
   * account activity feed (newest first).
   */
  async listCashActivities(opts?: { limit?: number }): Promise<CashActivity[]> {
    const pageSize = Math.min(Math.max(1, opts?.limit ?? 40), 100);
    const params = new URLSearchParams({
      activity_types: "DIV,DIVNRA,INT",
      direction: "desc",
      page_size: String(pageSize),
    });
    const raw = await this.request<AlpacaActivity[]>(
      `${this.tradingBase}/account/activities?${params.toString()}`,
    );
    return raw.map(mapCashActivity);
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

  async listAssets(opts?: { assetClass?: string }): Promise<AssetInfo[]> {
    const params = new URLSearchParams({
      status: "active",
      asset_class: opts?.assetClass ?? "us_equity",
      tradable: "true",
    });
    const raw = await this.request<AlpacaAsset[]>(
      `${this.tradingBase}/assets?${params.toString()}`,
    );
    return raw
      .filter((a) => a.tradable && a.status === "active" && /^[A-Z]{1,5}$/.test(a.symbol))
      .map(mapAsset);
  }

  async getAsset(symbol: string): Promise<AssetInfo | null> {
    try {
      const raw = await this.request<AlpacaAsset>(
        `${this.tradingBase}/assets/${symbol.toUpperCase()}`,
      );
      return mapAsset(raw);
    } catch {
      return null;
    }
  }

  /**
   * Bulk multi-symbol OHLCV bars — batched in groups of 100 to stay within
   * Alpaca's URL length limits. Uses the same IEX feed as getPriceHistory.
   */
  async getBulkBars(symbols: string[], days: number): Promise<Map<string, PriceBar[]>> {
    const BATCH_SIZE = 100;
    const result = new Map<string, PriceBar[]>();
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const params = new URLSearchParams({
        symbols: batch.join(","),
        timeframe: "1Day",
        start: start.toISOString(),
        end: end.toISOString(),
        limit: "10000",
        adjustment: "raw",
        feed: "iex",
        sort: "asc",
      });
      try {
        const raw = await this.request<{ bars?: Record<string, AlpacaBar[]> }>(
          `${DATA_BASE}/stocks/bars?${params.toString()}`,
        );
        for (const [sym, bars] of Object.entries(raw.bars ?? {})) {
          result.set(sym.toUpperCase(), bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
        }
      } catch {
        /* skip failed batch — non-fatal */
      }
    }

    return result;
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
    const cap = Math.min(Math.max(1, limit), 50);
    const params = new URLSearchParams({ symbols: symbol, limit: String(cap) });
    const { items } = await this.fetchNewsPage(params);
    return items;
  }

  /**
   * News by ticker(s) or keywords. Pages at 50/request until Alpaca returns no
   * `next_page_token`. Keyword mode fetches the full unfiltered timeline then
   * filters client-side (Alpaca has no full-text query param).
   */
  async searchNews(query: string, opts?: NewsSearchOpts): Promise<NewsItem[]> {
    const q = query.trim();
    if (!q) return [];
    const symbolCsv = parseSymbolCsvFromQuery(q);
    const base = new URLSearchParams({ sort: "desc" });
    if (symbolCsv) {
      base.set("symbols", symbolCsv);
    }
    const all = await this.fetchAllNewsPages(base);
    let out: NewsItem[];
    if (symbolCsv) {
      out = all;
    } else {
      const tokens = normalizeSearchTokens(q);
      if (tokens.length === 0) return [];
      out = all.filter((it) => articleMatchesTokens(it, tokens));
    }
    const cap = opts?.maxArticles;
    if (cap !== undefined && cap > 0 && out.length > cap) {
      return out.slice(0, cap);
    }
    return out;
  }

  /** One GET; Alpaca returns up to 50 rows plus an optional pagination token. */
  private async fetchNewsPage(
    params: URLSearchParams,
  ): Promise<{ items: NewsItem[]; nextPageToken: string | null }> {
    const url = `${NEWS_BASE}?${params.toString()}`;
    const raw = await this.request<AlpacaNewsResponse>(url);
    const items = (raw.news ?? []).map(mapNewsItem);
    const tok = raw.next_page_token;
    const nextPageToken =
      tok == null || tok === "" ? null : typeof tok === "string" ? tok : String(tok);
    return { items, nextPageToken };
  }

  /**
   * Follow `page_token` until exhausted. Hard cap prevents runaway loops if the
   * API misbehaves (50 rows × 200 pages = 10,000 articles max).
   */
  private async fetchAllNewsPages(base: URLSearchParams): Promise<NewsItem[]> {
    const MAX_PAGES = 200;
    const aggregated: NewsItem[] = [];
    const seen = new Set<string>();
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams(base);
      params.set("limit", "50");
      if (pageToken) {
        params.set("page_token", pageToken);
      }
      const { items, nextPageToken } = await this.fetchNewsPage(params);
      for (const it of items) {
        const key = `${it.publishedAt}\t${it.url}\t${it.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        aggregated.push(it);
      }
      if (!nextPageToken || items.length === 0) {
        break;
      }
      pageToken = nextPageToken;
    }
    return aggregated;
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

/** Subset of Alpaca account activity objects we map into {@link CashActivity}. */
interface AlpacaActivity {
  id: string;
  activity_type: string;
  transaction_time?: string;
  date?: string;
  net_amount: string;
  symbol?: string;
  description?: string;
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
  symbols?: string[];
}

interface AlpacaNewsResponse {
  news?: AlpacaNewsItem[];
  next_page_token?: string | null;
}

interface AlpacaAsset {
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  fractionable: boolean;
}

function mapAsset(a: AlpacaAsset): AssetInfo {
  return {
    symbol: a.symbol,
    name: a.name,
    tradable: a.tradable,
    marginable: a.marginable,
    fractionable: a.fractionable,
  };
}

function mapNewsItem(n: AlpacaNewsItem): NewsItem {
  return {
    title: n.headline,
    source: n.source,
    publishedAt: n.created_at,
    url: n.url,
    summary: n.summary,
    symbols: n.symbols,
  };
}

/** `AAPL`, `AAPL,MSFT`, ` brk.b , XOM ` → uppercased CSV for Alpaca `symbols`. */
function parseSymbolCsvFromQuery(raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;
  if (q.includes(",")) {
    const parts = q
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    if (!parts.every((p) => /^[A-Za-z0-9.^]{1,24}$/.test(p))) return null;
    return parts.map((p) => p.toUpperCase()).join(",");
  }
  if (!/\s/.test(q) && /^[A-Za-z][A-Za-z0-9.]{0,23}$/.test(q)) {
    return q.toUpperCase();
  }
  return null;
}

function normalizeSearchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function articleMatchesTokens(it: NewsItem, tokens: string[]): boolean {
  const blob = `${it.title} ${it.summary ?? ""}`.toLowerCase();
  return tokens.every((t) => blob.includes(t));
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

function mapCashActivity(raw: AlpacaActivity): CashActivity {
  const ts = raw.transaction_time ?? raw.date ?? new Date().toISOString();
  return {
    id: raw.id,
    activityType: raw.activity_type,
    ts,
    netAmount: Number(raw.net_amount),
    symbol: raw.symbol,
    description: raw.description,
  };
}
