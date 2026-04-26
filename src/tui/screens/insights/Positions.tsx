/**
 * Active positions — portfolio totals (stacked labels), searchable card list with
 * [@pppp606/ink-chart](https://github.com/pppp606/ink-chart) sparklines from
 * recent daily closes.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { Sparkline } from "@pppp606/ink-chart";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import type { AccountSummary, BrokerAdapter, Position } from "../../../execution/broker.js";
import type { Config } from "../../../config.js";

export const CHART_REFRESH_MS = 60_000;
const HISTORY_DAYS = 30;
const SPARK_W = 28;

export function fmtMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function aggregatePositions(positions: Position[]): {
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
} {
  let marketValue = 0;
  let costBasis = 0;
  let unrealizedPnl = 0;
  for (const p of positions) {
    marketValue += p.marketValue;
    costBasis += p.qty * p.avgEntryPrice;
    unrealizedPnl += p.unrealizedPnl;
  }
  return { marketValue, costBasis, unrealizedPnl };
}

export function roiPct(pos: Position): number {
  const cost = pos.qty * pos.avgEntryPrice;
  const absCost = Math.abs(cost);
  if (absCost < 1e-9) return 0;
  return (pos.unrealizedPnl / absCost) * 100;
}

export function filterPositions(positions: Position[], q: string): Position[] {
  const s = q.trim().toLowerCase();
  if (!s) return positions;
  return positions.filter((p) => p.symbol.toLowerCase().includes(s));
}

/** Stacked label/value rows so narrow terminals do not merge text. */
export function PortfolioSummary({
  positions,
  account,
}: {
  positions: Position[];
  account: AccountSummary | null;
}): React.ReactElement {
  const totals = aggregatePositions(positions);
  const cur = account?.currency ?? "USD";

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Text bold color={theme.color.primary}>
        Portfolio
      </Text>
      <Box marginTop={0}>
        <Text color={theme.color.muted}>Positions market value</Text>
        <Text bold>{fmtMoney(totals.marketValue, cur)}</Text>
      </Box>
      <Box marginTop={0}>
        <Text color={theme.color.muted}>Cost basis (invested)</Text>
        <Text bold>{fmtMoney(totals.costBasis, cur)}</Text>
      </Box>
      <Box marginTop={0}>
        <Text color={theme.color.muted}>Unrealized P&L</Text>
        <Text bold color={totals.unrealizedPnl >= 0 ? theme.color.success : theme.color.danger}>
          {totals.unrealizedPnl >= 0 ? "+" : ""}
          {fmtMoney(totals.unrealizedPnl, cur)}
        </Text>
      </Box>
      {account ? (
        <>
          <Box marginTop={0}>
            <Text color={theme.color.muted}>Cash</Text>
            <Text bold>{fmtMoney(account.cash, cur)}</Text>
          </Box>
          <Box marginTop={0}>
            <Text color={theme.color.muted}>Account equity</Text>
            <Text bold>{fmtMoney(account.equity, cur)}</Text>
          </Box>
        </>
      ) : (
        <Text dimColor color={theme.color.muted}>
          Account snapshot not loaded yet.
        </Text>
      )}
    </Box>
  );
}

export function PositionsCards({
  positions,
  symbolsFilter,
  config,
  equity,
  broker,
  contentWidth,
}: {
  positions: Position[];
  symbolsFilter: string;
  config: Config;
  equity: number | null;
  broker: BrokerAdapter;
  contentWidth: number;
}): React.ReactElement {
  const filtered = useMemo(() => filterPositions(positions, symbolsFilter), [positions, symbolsFilter]);
  const [closesBySymbol, setClosesBySymbol] = useState<Record<string, number[]>>({});
  const [chartsLoading, setChartsLoading] = useState(false);

  const symKey = useMemo(
    () =>
      positions
        .map((p) => `${p.symbol}:${p.qty}:${p.marketValue.toFixed(2)}`)
        .sort()
        .join("|"),
    [positions],
  );

  useEffect(() => {
    if (positions.length === 0) {
      setClosesBySymbol({});
      setChartsLoading(false);
      return;
    }
    let cancelled = false;

    async function load(): Promise<void> {
      setChartsLoading(true);
      const entries = await Promise.all(
        positions.map(async (p) => {
          try {
            const bars = await broker.getPriceHistory(p.symbol, HISTORY_DAYS);
            const closes = bars.map((b) => b.c).filter((c) => Number.isFinite(c));
            if (closes.length >= 2) {
              return [p.symbol, closes] as const;
            }
            const mark = p.qty !== 0 ? p.marketValue / p.qty : p.avgEntryPrice;
            return [p.symbol, [p.avgEntryPrice, mark]] as const;
          } catch {
            const mark = p.qty !== 0 ? p.marketValue / p.qty : p.avgEntryPrice;
            return [p.symbol, [p.avgEntryPrice, mark]] as const;
          }
        }),
      );
      if (!cancelled) {
        setClosesBySymbol(Object.fromEntries(entries));
        setChartsLoading(false);
      }
    }

    void load();
    const id = setInterval(() => void load(), CHART_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [broker, positions, symKey]);

  if (filtered.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color={theme.color.muted}>
          {positions.length === 0 ? "No open positions." : "No positions match this search."}
        </Text>
      </Box>
    );
  }

  const w = Math.max(40, contentWidth);

  return (
    <Box flexDirection="column">
      {filtered.map((p) => (
        <PositionCard
          key={p.symbol}
          pos={p}
          config={config}
          equity={equity}
          closes={closesBySymbol[p.symbol] ?? []}
          chartsLoading={chartsLoading}
          maxInnerWidth={w}
        />
      ))}
    </Box>
  );
}

/** Legacy full panel (single scroll parent). Prefer PortfolioSummary + PositionsCards in Insights. */
export function Positions(props: {
  positions: Position[];
  config: Config;
  equity: number | null;
  account: AccountSummary | null;
  broker: BrokerAdapter;
}): React.ReactElement {
  return (
    <Panel title="Active positions">
      <PortfolioSummary positions={props.positions} account={props.account} />
      <PositionsCards
        positions={props.positions}
        symbolsFilter=""
        config={props.config}
        equity={props.equity}
        broker={props.broker}
        contentWidth={72}
      />
    </Panel>
  );
}

function PositionCard({
  pos,
  config,
  equity,
  closes,
  chartsLoading,
  maxInnerWidth,
}: {
  pos: Position;
  config: Config;
  equity: number | null;
  closes: number[];
  chartsLoading: boolean;
  maxInnerWidth: number;
}): React.ReactElement {
  const mark = pos.qty !== 0 ? pos.marketValue / pos.qty : 0;
  const cost = pos.qty * pos.avgEntryPrice;
  const invested = Math.abs(cost);
  const currentVal = Math.abs(pos.marketValue);
  const roi = roiPct(pos);
  const up = pos.unrealizedPnl >= 0;
  const trendColor = up ? theme.color.success : theme.color.danger;
  const sizePct = equity && equity > 0 ? (Math.abs(pos.marketValue) / equity) * 100 : null;
  const stopPct = config.risk.stop_loss_pct;
  const takePct = config.risk.take_profit_pct;
  const sparkW = Math.min(SPARK_W, Math.max(12, maxInnerWidth - 24));

  const spark =
    !chartsLoading && closes.length > 0 ? (
      <Box flexDirection="row" alignItems="center">
        <Box marginRight={1}>
          <Sparkline data={closes} width={sparkW} mode="block" />
        </Box>
        <Text bold color={trendColor}>
          {up ? "↑" : "↓"}
        </Text>
      </Box>
    ) : (
      <Text dimColor color={theme.color.muted}>
        {chartsLoading ? "Loading chart…" : "—"}
      </Text>
    );

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor={theme.color.subtle}
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text bold color={theme.color.text}>
          {pos.symbol}
        </Text>
        <Text bold color={trendColor}>
          {roi >= 0 ? "+" : ""}
          {roi.toFixed(2)}% ROI
        </Text>
      </Box>
      <Box flexDirection="row" marginTop={0} alignItems="center">
        <Box marginRight={2}>{spark}</Box>
        <Box flexDirection="column">
          <Text color={theme.color.muted}>
            Invested <Text color={theme.color.text}>{fmtMoney(invested)}</Text>
          </Text>
          <Text color={theme.color.muted}>
            Value <Text color={theme.color.text}>{fmtMoney(currentVal)}</Text>
          </Text>
          <Text color={theme.color.muted}>
            UPNL{" "}
            <Text color={trendColor} bold>
              {pos.unrealizedPnl >= 0 ? "+" : ""}
              {fmtMoney(pos.unrealizedPnl)}
            </Text>
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="row" flexWrap="wrap">
        <Text color={theme.color.muted}>
          Qty {pos.qty} · Entry {pos.avgEntryPrice.toFixed(2)} · Mark {mark.toFixed(2)}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        <Text color={sizePctColor(sizePct, config.risk.max_position_pct)}>
          {sizePct === null ? "Size —" : `Size ${sizePct.toFixed(1)}% of equity`}
        </Text>
        <Text color={theme.color.muted}> · SL −{stopPct}% / TP +{takePct}%</Text>
      </Box>
    </Box>
  );
}

function sizePctColor(size: number | null, max: number): string | undefined {
  if (size === null) return theme.color.muted;
  if (size > max) return theme.color.danger;
  if (size > max * 0.75) return theme.color.warn;
  return theme.color.muted;
}
