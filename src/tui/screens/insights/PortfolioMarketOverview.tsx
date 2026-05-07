/**
 * Real-time market overview for all positions and watchlist symbols.
 *
 * Fetches bulk market data on a cadence and renders a dashboard table.
 * Replaces the focus-symbol-centric MarketContext when the user wants
 * a global view of their portfolio's pulse.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { Box, Text, useStdout, type DOMElement } from "ink";
import { VirtualList, type VirtualListRef } from "ink-virtual-list";
import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { theme } from "../../theme.js";
import type { BrokerAdapter, PriceBar, Position } from "../../../execution/broker.js";
import { atr, rsi, rsiSignal, sma } from "../../../signal/technical.js";
import { fmtMoney } from "./Positions.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";

interface Props {
  broker: BrokerAdapter;
  positions: Position[];
  watchlist: string[];
  wheelCaptureRef?: RefObject<DOMElement | null>;
}

interface SymbolRealTime {
  symbol: string;
  last: number | null;
  rsi: number | null;
  rsiSig: string;
  sma20: number | null;
  atr: number | null;
  upnl: number | null;
  qty: number;
}

const REFRESH_MS = 15_000;
const HISTORY_DAYS = 30;

export function PortfolioMarketOverview({ broker, positions, watchlist, wheelCaptureRef }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const listRef = useRef<VirtualListRef>(null);
  const defaultWheelRef = useRef<DOMElement | null>(null);
  const wheelRef = wheelCaptureRef ?? defaultWheelRef;
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [data, setData] = useState<Record<string, SymbolRealTime>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inFlight = useRef(false);

  const allSymbols = useMemo(() => {
    const syms = new Set([...positions.map((p) => p.symbol), ...watchlist]);
    return Array.from(syms).sort();
  }, [positions, watchlist]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      if (inFlight.current || allSymbols.length === 0) return;
      inFlight.current = true;
      if (Object.keys(data).length === 0) setLoading(true);

      try {
        const bulkBars = await (broker.getBulkBars
          ? broker.getBulkBars(allSymbols, HISTORY_DAYS)
          : Promise.resolve(new Map<string, PriceBar[]>()));

        if (cancelled) return;

        const nextData: Record<string, SymbolRealTime> = {};
        const posMap = new Map(positions.map((p) => [p.symbol, p]));

        for (const symbol of allSymbols) {
          const bars = bulkBars.get(symbol) ?? [];
          const pos = posMap.get(symbol);
          const closes = bars.map((b) => b.c);
          const last = closes[closes.length - 1] ?? (pos ? pos.marketValue / pos.qty : null);
          const rsiVal = rsi(closes, 14);
          const sig = rsiSignal(rsiVal);
          const sma20 = sma(closes, 20);
          const ohlcBars = bars.map((b) => ({ ...b, t: new Date(b.t).getTime() }));
          const atrVal = atr(ohlcBars, 14);

          nextData[symbol] = {
            symbol,
            last,
            rsi: rsiVal,
            rsiSig: sig,
            sma20,
            atr: atrVal,
            upnl: pos ? pos.unrealizedPnl : null,
            qty: pos ? pos.qty : 0,
          };
        }

        setData(nextData);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    };

    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [broker, allSymbols]);

  /** Wheel scroll handler for virtual list navigation */
  useEffect(() => {
    const onScroll = (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null || allSymbols.length === 0) return;
      const box = getTerminalCellBounds(wheelRef);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;

      setSelectedIndex((prev) => {
        if (dir === "scrollup") return Math.max(0, prev - 1);
        return Math.min(allSymbols.length - 1, prev + 1);
      });
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, allSymbols.length, wheelRef]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, allSymbols.length - 1)));
  }, [allSymbols.length]);

  const rows = allSymbols.map((s) => data[s]).filter(Boolean) as SymbolRealTime[];
  const w = stdout.columns ?? 80;
  const listHeight = Math.min(rows.length, 12);

  if (loading && rows.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color={theme.color.muted}>Loading real-time market data for {allSymbols.length} symbols…</Text>
      </Box>
    );
  }

  return (
    <Box ref={wheelRef as any} flexDirection="column" borderStyle="round" borderColor={theme.color.muted} marginTop={1}>
      <Box marginLeft={1}>
        <Text bold color={theme.color.primary}>
          Portfolio Real-Time Monitor
        </Text>
      </Box>

      <Box flexDirection="row" paddingX={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={theme.color.subtle}>
        <HeaderCell text="Symbol" width={10} />
        <HeaderCell text="Price" width={10} />
        <HeaderCell text="RSI(14)" width={15} />
        <HeaderCell text="SMA(20)" width={10} />
        <HeaderCell text="ATR(14)" width={10} />
        <HeaderCell text="UPNL" width={12} />
        <HeaderCell text="Status" width={10} />
      </Box>

      <Box height={listHeight} flexDirection="column" paddingX={1}>
        {rows.length === 0 ? (
          <Text color={theme.color.muted}>No market data available.</Text>
        ) : (
          <VirtualList
            ref={listRef}
            items={rows}
            height={listHeight}
            renderItem={({ item }) => <RowView item={item} width={w} />}
            selectedIndex={selectedIndex}
          />
        )}
      </Box>

      {error ? (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.color.danger}>Error: {error}</Text>
        </Box>
      ) : null}

      <Box paddingX={1} marginTop={0}>
        <Text dimColor color={theme.color.muted}>
          Refreshes every {REFRESH_MS / 1000}s · All holdings + watchlist · RSI color: oversold=green, overbought=red
        </Text>
      </Box>
    </Box>
  );
}

function HeaderCell({ text, width }: { text: string; width: number }): React.ReactElement {
  return (
    <Box width={width}>
      <Text bold color={theme.color.muted}>
        {text}
      </Text>
    </Box>
  );
}

function RowView({ item }: { item: SymbolRealTime; width: number }): React.ReactElement {
  const rsiCol = signalColor(item.rsiSig);
  const smaTrend = item.last && item.sma20 ? (item.last > item.sma20 ? "↑" : "↓") : "—";
  const smaCol = smaTrend === "↑" ? theme.color.success : smaTrend === "↓" ? theme.color.danger : theme.color.muted;

  return (
    <Box flexDirection="row">
      <Box width={10}>
        <Text bold color={item.qty !== 0 ? theme.color.primary : theme.color.text}>
          {item.symbol}
        </Text>
      </Box>
      <Box width={10}>
        <Text>{item.last?.toFixed(2) ?? "—"}</Text>
      </Box>
      <Box width={15}>
        <Text color={rsiCol}>{item.rsi?.toFixed(1) ?? "—"}</Text>
        <Text color={theme.color.muted}> ({item.rsiSig})</Text>
      </Box>
      <Box width={10}>
        <Text color={smaCol}>{smaTrend}</Text>
        <Text color={theme.color.muted}> {item.sma20?.toFixed(1) ?? "—"}</Text>
      </Box>
      <Box width={10}>
        <Text>{item.atr?.toFixed(2) ?? "—"}</Text>
      </Box>
      <Box width={12}>
        <Text color={item.upnl && item.upnl >= 0 ? theme.color.success : theme.color.danger}>
          {item.upnl !== null ? (item.upnl >= 0 ? "+" : "") + fmtMoney(item.upnl) : "—"}
        </Text>
      </Box>
      <Box width={10}>
        <Text color={item.qty !== 0 ? theme.color.success : theme.color.muted}>
          {item.qty !== 0 ? `In Pos` : "Watch"}
        </Text>
      </Box>
    </Box>
  );
}

function signalColor(sig: string): string | undefined {
  switch (sig) {
    case "oversold":
      return theme.color.success;
    case "overbought":
      return theme.color.danger;
    case "neutral":
      return theme.color.warn;
    default:
      return undefined;
  }
}
