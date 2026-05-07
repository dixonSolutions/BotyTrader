/**
 * Professional portfolio dashboard for the Insights > Portfolio tab.
 *
 * Keeps the first viewport focused on account health, open exposure, risk, and
 * post-trade outcomes without depending on terminal props Ink does not support.
 */

import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { Sparkline } from "@pppp606/ink-chart";

import { theme } from "../../theme.js";
import type { Config } from "../../../config.js";
import type { AccountSummary, Order, Position } from "../../../execution/broker.js";
import { reconstructClosedTrades, formatDuration, type PerformanceMetrics } from "../../../metrics.js";
import { aggregatePositions, filterPositions, fmtMoney, roiPct } from "./Positions.js";

interface Props {
  account: AccountSummary | null;
  positions: Position[];
  orders: Order[];
  performance: PerformanceMetrics;
  equityHistory: { ts: string; equity: number }[];
  config: Config;
  symbolsFilter: string;
}

export function PortfolioDashboard({
  account,
  positions,
  orders,
  performance,
  equityHistory,
  config,
  symbolsFilter,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const narrow = cols < 100;
  const currency = account?.currency ?? "USD";
  const totals = aggregatePositions(positions);
  const filteredPositions = useMemo(
    () => filterPositions(positions, symbolsFilter),
    [positions, symbolsFilter],
  );
  const closedTrades = useMemo(() => reconstructClosedTrades(orders).slice(-8).reverse(), [orders]);

  return (
    <Box flexDirection="column">
      <BigPicture account={account} totals={totals} performance={performance} currency={currency} narrow={narrow} />
      <PerformanceStrip performance={performance} equityHistory={equityHistory} currency={currency} />
      <OpenPositionsTable
        positions={filteredPositions}
        equity={account?.equity ?? null}
        currency={currency}
        config={config}
      />
      <RiskExposure positions={positions} account={account} config={config} currency={currency} />
      <ClosedTradesTable trades={closedTrades} currency={currency} closedTradeCount={performance.closedTrades} />
    </Box>
  );
}

function BigPicture({
  account,
  totals,
  performance,
  currency,
  narrow,
}: {
  account: AccountSummary | null;
  totals: ReturnType<typeof aggregatePositions>;
  performance: PerformanceMetrics;
  currency: string;
  narrow: boolean;
}): React.ReactElement {
  const dayAbs = performance.dailyPnlAbs;
  const dayPct = performance.dailyPnlPct;
  const dayUp = (dayAbs ?? 0) >= 0;
  const upnlUp = totals.unrealizedPnl >= 0;

  const cells = [
    {
      label: "Total Account Value",
      value: account ? fmtMoney(account.equity, currency) : "—",
      color: theme.color.primary,
      detail: "liquid equity",
    },
    {
      label: "Day's Change",
      value: dayAbs == null ? "—" : `${dayUp ? "+" : ""}${fmtMoney(dayAbs, currency)}`,
      color: dayUp ? theme.color.success : theme.color.danger,
      detail: dayPct == null ? "—" : `${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%`,
    },
    {
      label: "Total Unrealized P/L",
      value: `${upnlUp ? "+" : ""}${fmtMoney(totals.unrealizedPnl, currency)}`,
      color: upnlUp ? theme.color.success : theme.color.danger,
      detail: "open positions",
    },
    {
      label: "Buying Power / Cash",
      value: account ? fmtMoney(account.buyingPower, currency) : "—",
      color: theme.color.text,
      detail: account ? `cash ${fmtMoney(account.cash, currency)}` : "not loaded",
    },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.color.primary}>
          Big Picture
        </Text>
        <Text color={theme.color.muted}> · account pulse</Text>
      </Box>
      <Box flexDirection={narrow ? "column" : "row"} justifyContent="space-between">
        {cells.map((cell) => (
          <Box key={cell.label} flexDirection="column" minWidth={narrow ? 0 : 22} marginRight={narrow ? 0 : 2}>
            <Text color={theme.color.muted}>{cell.label}</Text>
            <Text bold color={cell.color}>
              {cell.value}
            </Text>
            <Text color={theme.color.muted}>{cell.detail}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function PerformanceStrip({
  performance,
  equityHistory,
  currency,
}: {
  performance: PerformanceMetrics;
  equityHistory: { ts: string; equity: number }[];
  currency: string;
}): React.ReactElement {
  const equitySeries = equityHistory.map((s) => s.equity).slice(-40);
  const spark = equitySeries.length >= 2 ? (
    <Sparkline data={equitySeries} width={24} mode="block" />
  ) : (
    <Text color={theme.color.muted}>not enough equity history</Text>
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.muted} marginTop={1} paddingX={1}>
      <Text bold color={theme.color.primary}>
        Performance Analytics
      </Text>
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        <Metric label="Equity Curve" value={spark} />
        <Metric label="Risk/Reward" value={fmtRatio(performance.profitFactor)} color={ratioColor(performance.profitFactor)} />
        <Metric label="Win Rate" value={fmtPct(performance.winRatePct)} color={winRateColor(performance.winRatePct)} />
        <Metric label="Drawdown" value={fmtPct(performance.maxDrawdownPct)} color={drawdownColor(performance.maxDrawdownPct)} />
        <Metric label="Sharpe" value={fmtRatio(performance.sharpe)} color={sharpeColor(performance.sharpe)} />
      </Box>
      <Text color={theme.color.muted}>
        Day P/L {performance.dailyPnlAbs == null ? "—" : fmtMoney(performance.dailyPnlAbs, currency)} · closed trades {performance.closedTrades}
      </Text>
    </Box>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string | React.ReactElement;
  color?: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column" minWidth={18} marginRight={2} marginBottom={1}>
      <Text color={theme.color.muted}>{label}</Text>
      {typeof value === "string" ? (
        <Text bold color={color ?? theme.color.text}>
          {value}
        </Text>
      ) : (
        value
      )}
    </Box>
  );
}

function OpenPositionsTable({
  positions,
  equity,
  currency,
  config,
}: {
  positions: Position[];
  equity: number | null;
  currency: string;
  config: Config;
}): React.ReactElement {
  const rows = positions.slice(0, 12);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.muted} marginTop={1} paddingX={1}>
      <Text bold color={theme.color.primary}>
        Open Positions
      </Text>
      {rows.length === 0 ? (
        <Text color={theme.color.muted}>No open positions match this filter.</Text>
      ) : (
        <>
          <TableHeader columns={["Symbol", "Qty", "Avg Fill", "Market", "Unrealized", "Alloc", "SL/TP"]} widths={[9, 12, 12, 12, 15, 9, 12]} />
          {rows.map((p) => {
            const mark = p.qty !== 0 ? p.marketValue / p.qty : 0;
            const allocation = equity && equity > 0 ? (Math.abs(p.marketValue) / equity) * 100 : null;
            const pnlPct = roiPct(p);
            const pnlColor = p.unrealizedPnl >= 0 ? theme.color.success : theme.color.danger;
            return (
              <Box key={p.symbol} flexDirection="row">
                <Cell width={9} bold color={theme.color.primary}>{p.symbol}</Cell>
                <Cell width={12}>{fitNumber(p.qty)}</Cell>
                <Cell width={12}>{fmtMoney(p.avgEntryPrice, currency)}</Cell>
                <Cell width={12}>{fmtMoney(mark, currency)}</Cell>
                <Cell width={15} color={pnlColor}>
                  {p.unrealizedPnl >= 0 ? "+" : ""}{fmtMoney(p.unrealizedPnl, currency)} {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                </Cell>
                <Cell width={9} color={allocationColor(allocation)}>{allocation == null ? "—" : `${allocation.toFixed(1)}%`}</Cell>
                <Cell width={12} color={theme.color.muted}>
                  -{config.risk.stop_loss_pct}% / +{config.risk.take_profit_pct}%
                </Cell>
              </Box>
            );
          })}
          {positions.length > rows.length ? (
            <Text color={theme.color.muted}>{positions.length - rows.length} more positions hidden by viewport.</Text>
          ) : null}
        </>
      )}
    </Box>
  );
}

function RiskExposure({
  positions,
  account,
  config,
  currency,
}: {
  positions: Position[];
  account: AccountSummary | null;
  config: Config;
  currency: string;
}): React.ReactElement {
  const equity = account?.equity ?? 0;
  const totals = aggregatePositions(positions);
  const cash = account?.cash ?? 0;
  const investedPct = equity > 0 ? (Math.abs(totals.marketValue) / equity) * 100 : 0;
  const cashPct = equity > 0 ? (cash / equity) * 100 : 0;
  const sorted = [...positions].sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  const top = sorted[0] ?? null;
  const topPct = top && equity > 0 ? (Math.abs(top.marketValue) / equity) * 100 : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.muted} marginTop={1} paddingX={1}>
      <Text bold color={theme.color.primary}>
        Risk Management & Exposure
      </Text>
      <ExposureBar label="Invested" pct={investedPct} color={theme.color.primary} value={fmtMoney(totals.marketValue, currency)} />
      <ExposureBar label="Cash" pct={cashPct} color={theme.color.success} value={fmtMoney(cash, currency)} />
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        <Text color={theme.color.muted}>Largest position </Text>
        <Text color={allocationColor(topPct)}>{top ? `${top.symbol} ${topPct?.toFixed(1) ?? "—"}%` : "—"}</Text>
        <Text color={theme.color.muted}> · max per name </Text>
        <Text color={theme.color.text}>{config.risk.max_position_pct}%</Text>
        <Text color={theme.color.muted}> · stop/take </Text>
        <Text color={theme.color.text}>-{config.risk.stop_loss_pct}% / +{config.risk.take_profit_pct}%</Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap">
        <Text color={theme.color.muted}>Sector exposure </Text>
        <Text color={theme.color.text}>—</Text>
        <Text color={theme.color.muted}> · beta/correlation </Text>
        <Text color={theme.color.text}>—</Text>
      </Box>
    </Box>
  );
}

function ExposureBar({
  label,
  pct,
  color,
  value,
}: {
  label: string;
  pct: number;
  color: string;
  value: string;
}): React.ReactElement {
  const width = 24;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (
    <Box flexDirection="row" marginTop={1}>
      <Cell width={10} color={theme.color.muted}>{label}</Cell>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={theme.color.subtle}>{"░".repeat(width - filled)}</Text>
      <Text color={theme.color.text}> {pct.toFixed(1)}%</Text>
      <Text color={theme.color.muted}> · {value}</Text>
    </Box>
  );
}

function ClosedTradesTable({
  trades,
  currency,
  closedTradeCount,
}: {
  trades: ReturnType<typeof reconstructClosedTrades>;
  currency: string;
  closedTradeCount: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.muted} marginTop={1} paddingX={1}>
      <Text bold color={theme.color.primary}>
        Historical Logs
      </Text>
      {trades.length === 0 ? (
        <Text color={theme.color.muted}>No closed trades reconstructed from filled orders yet.</Text>
      ) : (
        <>
          <TableHeader columns={["Symbol", "Side", "Qty", "Entry", "Exit", "Realized", "Duration"]} widths={[9, 7, 10, 11, 11, 13, 10]} />
          {trades.map((t, idx) => (
            <Box key={`${t.symbol}-${t.closedAt}-${idx}`} flexDirection="row">
              <Cell width={9} bold color={theme.color.primary}>{t.symbol}</Cell>
              <Cell width={7}>{t.side}</Cell>
              <Cell width={10}>{fitNumber(t.qty)}</Cell>
              <Cell width={11}>{fmtMoney(t.entryPrice, currency)}</Cell>
              <Cell width={11}>{fmtMoney(t.exitPrice, currency)}</Cell>
              <Cell width={13} color={t.pnl >= 0 ? theme.color.success : theme.color.danger}>
                {t.pnl >= 0 ? "+" : ""}{fmtMoney(t.pnl, currency)}
              </Cell>
              <Cell width={10}>{formatDuration(t.durationMs)}</Cell>
            </Box>
          ))}
          <Text color={theme.color.muted}>
            Showing latest {trades.length} of {closedTradeCount} closed trade{closedTradeCount === 1 ? "" : "s"} · fees —
          </Text>
        </>
      )}
    </Box>
  );
}

function TableHeader({ columns, widths }: { columns: string[]; widths: number[] }): React.ReactElement {
  return (
    <Box flexDirection="row" marginTop={1}>
      {columns.map((col, i) => (
        <Cell key={col} width={widths[i] ?? 10} bold color={theme.color.muted}>
          {col}
        </Cell>
      ))}
    </Box>
  );
}

function Cell({
  width,
  children,
  color,
  bold,
}: {
  width: number;
  children: React.ReactNode;
  color?: string;
  bold?: boolean;
}): React.ReactElement {
  return (
    <Box width={width} flexShrink={0}>
      <Text color={color ?? theme.color.text} bold={bold}>
        {children}
      </Text>
    </Box>
  );
}

function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(2)}%`;
}

function fmtRatio(n: number | null): string {
  if (n == null) return "—";
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(2);
}

function fitNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function ratioColor(n: number | null): string | undefined {
  if (n == null) return theme.color.muted;
  if (!Number.isFinite(n) || n >= 1.75) return theme.color.success;
  if (n >= 1) return theme.color.warn;
  return theme.color.danger;
}

function winRateColor(n: number | null): string | undefined {
  if (n == null) return theme.color.muted;
  if (n >= 55) return theme.color.success;
  if (n >= 45) return theme.color.warn;
  return theme.color.danger;
}

function drawdownColor(n: number | null): string | undefined {
  if (n == null) return theme.color.muted;
  if (n <= 5) return theme.color.success;
  if (n <= 15) return theme.color.warn;
  return theme.color.danger;
}

function sharpeColor(n: number | null): string | undefined {
  if (n == null) return theme.color.muted;
  if (n >= 1) return theme.color.success;
  if (n >= 0) return theme.color.warn;
  return theme.color.danger;
}

function allocationColor(n: number | null): string | undefined {
  if (n == null) return theme.color.muted;
  if (n > 20) return theme.color.danger;
  if (n > 12) return theme.color.warn;
  return theme.color.success;
}
