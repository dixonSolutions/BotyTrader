/**
 * Market & strategy context for the focus symbol.
 *
 * Pulls fresh data on a fixed cadence rather than per render so cycling the
 * focus symbol stays cheap. Stats use stacked label/value rows so text does
 * not collide on narrow panes.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import type { BrokerAdapter, OrderBookSnapshot, PriceBar } from "../../../execution/broker.js";
import { atr, rsi, rsiSignal, sma } from "../../../signal/technical.js";

interface Props {
  broker: BrokerAdapter;
  symbol: string | null;
}

const REFRESH_MS = 10_000;

export function MarketContext({ broker, symbol }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const [bars, setBars] = useState<PriceBar[]>([]);
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setBars([]);
    setBook(null);
    setError(null);
    if (!symbol) return;

    let cancelled = false;
    const refresh = async (): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const [history, ob] = await Promise.all([
          broker.getPriceHistory(symbol, 60).catch(() => []),
          broker.getOrderBook ? broker.getOrderBook(symbol).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setBars(history);
        setBook(ob);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
      }
    };

    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [broker, symbol]);

  if (!symbol) {
    return (
      <Panel title="Market context">
        <Text color={theme.color.muted}>Add a symbol to the watchlist to see context.</Text>
      </Panel>
    );
  }

  const closes = bars.map((b) => b.c);
  const last = closes[closes.length - 1] ?? null;
  const rsiVal = rsi(closes, 14);
  const sig = rsiSignal(rsiVal);
  const sma20 = sma(closes, 20);
  const atrVal = atr(bars, 14);
  const w = stdout.columns ?? 80;

  return (
    <Panel title={`Market context · ${symbol}`}>
      <StatBlock label="Last close" value={last === null ? "—" : last.toFixed(2)} maxWidth={w - 4} />
      <StatBlock
        label="RSI(14)"
        value={rsiVal === null ? "—" : `${rsiVal.toFixed(1)} (${sig})`}
        valueColor={signalColor(sig)}
        maxWidth={w - 4}
      />
      <StatBlock label="SMA(20)" value={sma20 === null ? "—" : sma20.toFixed(2)} maxWidth={w - 4} />
      <StatBlock label="ATR(14)" value={atrVal === null ? "—" : atrVal.toFixed(2)} maxWidth={w - 4} />
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Order book (top of book)</Text>
        <BookView snapshot={book} />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.color.danger}>{error}</Text>
        </Box>
      ) : null}
    </Panel>
  );
}

function StatBlock({
  label,
  value,
  valueColor,
  maxWidth,
}: {
  label: string;
  value: string;
  valueColor?: string;
  maxWidth: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text color={theme.color.muted}>{label}</Text>
      <Box width={maxWidth}>
        <Text color={valueColor ?? theme.color.text} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    </Box>
  );
}

function signalColor(sig: ReturnType<typeof rsiSignal>): string | undefined {
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

function BookView({ snapshot }: { snapshot: OrderBookSnapshot | null }): React.ReactElement {
  if (!snapshot || (snapshot.bids.length === 0 && snapshot.asks.length === 0)) {
    return <Text color={theme.color.muted}>Order book unavailable for this adapter.</Text>;
  }
  const bid = snapshot.bids[0];
  const ask = snapshot.asks[0];
  const total = (bid?.size ?? 0) + (ask?.size ?? 0);
  const bidPct = total > 0 ? (bid?.size ?? 0) / total : 0.5;
  const width = 20;
  const bidWidth = Math.round(bidPct * width);
  const askWidth = width - bidWidth;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap">
        <Text color={theme.color.success}>
          BID {bid ? `${bid.price.toFixed(2)} × ${bid.size}` : "—"}
        </Text>
        <Text color={theme.color.muted}> · </Text>
        <Text color={theme.color.danger}>
          ASK {ask ? `${ask.price.toFixed(2)} × ${ask.size}` : "—"}
        </Text>
      </Box>
      <Box>
        <Text color={theme.color.success}>{"█".repeat(bidWidth)}</Text>
        <Text color={theme.color.danger}>{"█".repeat(askWidth)}</Text>
      </Box>
    </Box>
  );
}
