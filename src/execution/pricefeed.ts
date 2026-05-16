/**
 * Alpaca WebSocket price feed — real-time quotes, trades, and bar updates.
 *
 * Connects to Alpaca's streaming API, authenticates, subscribes to watchlist
 * symbols, and emits events for price changes. Falls back to the IEX feed
 * (free tier) by default.
 *
 * Supports:
 *   - Quote streaming (bid/ask/last)
 *   - Trade streaming (last trade price/size)
 *   - Bar/minute updates
 *   - Auto-reconnect with exponential backoff
 *   - Health monitoring
 *
 * Usage:
 *   const feed = new AlpacaPriceFeed({ apiKey, apiSecret });
 *   feed.onPrice((snapshot) => { ... });
 *   await feed.start(["SPY", "QQQ"]);
 *   // ... later
 *   feed.updateWatchlist(["AAPL", "MSFT"]);
 *   feed.stop();
 */

export interface PriceSnapshot {
  symbol: string;
  /** Best bid price (from quote stream), or last trade price if no quote. */
  bidPrice: number | null;
  bidSize: number | null;
  /** Best ask price (from quote stream), or last trade price if no ask. */
  askPrice: number | null;
  askSize: number | null;
  /** Last trade price (from trade stream). */
  lastTradePrice: number | null;
  lastTradeSize: number | null;
  lastTradeTimestamp: string | null;
  /** Last quote timestamp. */
  quoteTimestamp: string | null;
  /** Server timestamp of the most recent update. */
  updatedAt: string;
}

export interface PriceFeedStatus {
  connected: boolean;
  symbols: string[];
  reconnectAttempts: number;
  lastError: string | null;
  feed: "iex" | "sip";
}

export type PriceHandler = (snapshot: PriceSnapshot) => void;
export type StatusHandler = (status: PriceFeedStatus) => void;

export interface AlpacaPriceFeedOptions {
  apiKey: string;
  apiSecret: string;
  /** Feed to use: "iex" (free, default) or "sip" (paid, more symbols). */
  feed?: "iex" | "sip";
  /** Reconnect max delay in ms (default: 30s). */
  maxReconnectDelayMs?: number;
  /** Called on every price update. */
  onPrice?: PriceHandler;
  /** Called when connection status changes. */
  onStatus?: StatusHandler;
}

const STREAM_BASE = "wss://stream.data.alpaca.markets/v2";

// Alpaca WebSocket message types (subset we care about)
interface AlpacaQuote {
  T: "q";
  S: string;          // symbol
  bp: number;         // bid price
  bs: number;         // bid size
  ap: number;         // ask price
  as: number;         // ask size
  t: string;          // timestamp
  c?: string[];       // conditions
}

interface AlpacaTrade {
  T: "t";
  S: string;          // symbol
  p: number;          // price
  s: number;          // size
  t: string;          // timestamp
  c?: string[];       // conditions
  i?: number;         // trade id
}

interface AlpacaBar {
  T: "b";
  S: string;          // symbol
  o: number;          // open
  h: number;          // high
  l: number;          // low
  c: number;          // close
  v: number;          // volume
  t: string;          // timestamp
  n?: number;         // number of trades
}

interface AlpacaSuccess {
  T: "success";
  msg: string;
}

interface AlpacaError {
  T: "error";
  code: number;
  msg: string;
}

interface AlpacaSubscription {
  T: "subscription";
  trades?: string[];
  quotes?: string[];
  bars?: string[];
}

type AlpacaStreamMessage = AlpacaQuote | AlpacaTrade | AlpacaBar | AlpacaSuccess | AlpacaError | AlpacaSubscription;

export class AlpacaPriceFeed {
  private ws: WebSocket | null = null;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly feed: "iex" | "sip";
  private readonly maxReconnectDelayMs: number;

  private symbols: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private connected = false;
  private lastError: string | null = null;

  /** Latest price snapshot per symbol. */
  readonly prices = new Map<string, PriceSnapshot>();

  /** Handlers. */
  private readonly priceHandlers = new Set<PriceHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly onPriceExternal?: PriceHandler;
  private readonly onStatusExternal?: StatusHandler;

  constructor(opts: AlpacaPriceFeedOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.feed = opts.feed ?? "iex";
    this.maxReconnectDelayMs = opts.maxReconnectDelayMs ?? 30_000;
    this.onPriceExternal = opts.onPrice;
    this.onStatusExternal = opts.onStatus;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start connecting and subscribing to the given symbols. */
  async start(symbols: string[]): Promise<void> {
    this.symbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  /** Update the watchlist — resubscribes if connected. */
  updateWatchlist(symbols: string[]): void {
    this.symbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscription();
    }
  }

  /** Get latest price for a symbol (null if not tracked). */
  getPrice(symbol: string): PriceSnapshot | null {
    return this.prices.get(symbol.toUpperCase()) ?? null;
  }

  /** Quick last-price lookup (bid or last trade). */
  getLastPrice(symbol: string): number | null {
    const p = this.prices.get(symbol.toUpperCase());
    if (!p) return null;
    return p.bidPrice ?? p.lastTradePrice ?? null;
  }

  /** Current status snapshot. */
  getStatus(): PriceFeedStatus {
    return {
      connected: this.connected,
      symbols: [...this.symbols],
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      feed: this.feed,
    };
  }

  /** Subscribe to price updates. */
  onPrice(handler: PriceHandler): () => void {
    this.priceHandlers.add(handler);
    return () => this.priceHandlers.delete(handler);
  }

  /** Subscribe to status changes. */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** Graceful disconnect. */
  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "Client shutdown");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.setConnected(false);
  }

  /** Drop all cached price data. */
  clearCache(): void {
    this.prices.clear();
  }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close(1000, "Reconnecting");
      } catch { /* ignore */ }
      this.ws = null;
    }

    const url = `${STREAM_BASE}/${this.feed}`;

    try {
      const ws = new WebSocket(url);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket connection timeout")), 10_000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket connection failed"));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          if (!this.connected) {
            reject(new Error("WebSocket closed before auth"));
          }
        };
      });

      this.ws = ws;
      this.reconnectAttempts = 0;

      // Send auth
      await this.sendAuth(ws);

      // Wire up message handler
      ws.onmessage = (event: MessageEvent) => {
        try {
          const messages: AlpacaStreamMessage[] = JSON.parse(event.data as string);
          for (const msg of messages) {
            this.handleMessage(msg);
          }
        } catch (e) {
          // Ignore parse errors on individual messages
        }
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.connected = false;
          this.setConnected(false);
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };

      this.connected = true;
      this.setConnected(true);
      this.setLastError(null);

      // Subscribe to symbols
      this.sendSubscription();
    } catch (e) {
      this.setLastError(e instanceof Error ? e.message : String(e));
      this.scheduleReconnect();
    }
  }

  private async sendAuth(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Auth timeout")), 5_000);

      const handler = (event: MessageEvent) => {
        try {
          const messages = JSON.parse(event.data as string);
          for (const msg of messages) {
            if (msg.T === "success" && msg.msg?.includes("authenticated")) {
              clearTimeout(timeout);
              ws.onmessage = null; // remove temp handler
              resolve();
              return;
            }
            if (msg.T === "error") {
              clearTimeout(timeout);
              ws.onmessage = null;
              reject(new Error(`Auth error: ${msg.msg}`));
              return;
            }
          }
        } catch { /* ignore */ }
      };

      ws.onmessage = handler;
      ws.send(JSON.stringify({ action: "auth", key: this.apiKey, secret: this.apiSecret }));
    });
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const active = this.symbols;
    if (active.length === 0) return;

    const msg = {
      action: "subscribe",
      quotes: active,
      trades: active,
    };

    this.ws.send(JSON.stringify(msg));
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private handleMessage(msg: AlpacaStreamMessage): void {
    switch (msg.T) {
      case "q":
        this.handleQuote(msg);
        break;
      case "t":
        this.handleTrade(msg);
        break;
      case "b":
        this.handleBar(msg);
        break;
      case "error":
        this.setLastError(`Stream error ${msg.code}: ${msg.msg}`);
        break;
      // success and subscription are handled during auth/init
    }
  }

  private handleQuote(q: AlpacaQuote): void {
    const existing = this.prices.get(q.S) ?? this.emptySnapshot(q.S);
    existing.bidPrice = q.bp;
    existing.bidSize = q.bs;
    existing.askPrice = q.ap;
    existing.askSize = q.as;
    existing.quoteTimestamp = q.t;
    existing.updatedAt = new Date().toISOString();
    this.prices.set(q.S, existing);
    this.emitPrice(existing);
  }

  private handleTrade(t: AlpacaTrade): void {
    const existing = this.prices.get(t.S) ?? this.emptySnapshot(t.S);
    existing.lastTradePrice = t.p;
    existing.lastTradeSize = t.s;
    existing.lastTradeTimestamp = t.t;
    if (existing.bidPrice === null) existing.bidPrice = t.p;
    if (existing.askPrice === null) existing.askPrice = t.p;
    existing.updatedAt = new Date().toISOString();
    this.prices.set(t.S, existing);
    this.emitPrice(existing);
  }

  private handleBar(b: AlpacaBar): void {
    // We track the close as a rough "current price" from bar updates
    const existing = this.prices.get(b.S) ?? this.emptySnapshot(b.S);
    if (existing.lastTradePrice === null) {
      existing.lastTradePrice = b.c;
    }
    existing.updatedAt = new Date().toISOString();
    this.prices.set(b.S, existing);
    this.emitPrice(existing);
  }

  // -----------------------------------------------------------------------
  // Reconnect
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)),
      this.maxReconnectDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  // -----------------------------------------------------------------------
  // State helpers
  // -----------------------------------------------------------------------

  private emptySnapshot(symbol: string): PriceSnapshot {
    return {
      symbol,
      bidPrice: null,
      bidSize: null,
      askPrice: null,
      askSize: null,
      lastTradePrice: null,
      lastTradeSize: null,
      lastTradeTimestamp: null,
      quoteTimestamp: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private setConnected(connected: boolean): void {
    this.connected = connected;
    this.emitStatus();
  }

  private setLastError(error: string | null): void {
    this.lastError = error;
    this.emitStatus();
  }

  private emitPrice(snapshot: PriceSnapshot): void {
    for (const handler of this.priceHandlers) {
      try { handler(snapshot); } catch { /* handler error */ }
    }
    this.onPriceExternal?.(snapshot);
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const handler of this.statusHandlers) {
      try { handler(status); } catch { /* handler error */ }
    }
    this.onStatusExternal?.(status);
  }
}
