/**
 * Active positions table — entry vs mark, unrealised PnL, position size,
 * and the configured SL/TP distance from the current mark.
 *
 * Mark price is approximated from `marketValue / qty` because the broker
 * adapter doesn't surface a live mark separately on every poll.
 */

import React from "react";
import { Box, Text } from "ink";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import type { Position } from "../../../execution/broker.js";
import type { Config } from "../../../config.js";

interface Props {
  positions: Position[];
  config: Config;
  equity: number | null;
}

export function Positions({ positions, config, equity }: Props): React.ReactElement {
  return (
    <Panel title="Active positions">
      <Header />
      {positions.length === 0 ? (
        <Box marginTop={1}>
          <Text color={theme.color.muted}>No open positions.</Text>
        </Box>
      ) : (
        positions.map((p) => <Row key={p.symbol} pos={p} config={config} equity={equity} />)
      )}
    </Panel>
  );
}

function Header(): React.ReactElement {
  return (
    <Box>
      <Text color={theme.color.muted}>{col("SYMBOL", 8)}</Text>
      <Text color={theme.color.muted}>{col("QTY", 7, "right")}</Text>
      <Text color={theme.color.muted}>{col("ENTRY", 10, "right")}</Text>
      <Text color={theme.color.muted}>{col("MARK", 10, "right")}</Text>
      <Text color={theme.color.muted}>{col("UPNL", 12, "right")}</Text>
      <Text color={theme.color.muted}>{col("SIZE %", 8, "right")}</Text>
      <Text color={theme.color.muted}>{col("SL → TP", 16, "right")}</Text>
    </Box>
  );
}

function Row({
  pos,
  config,
  equity,
}: {
  pos: Position;
  config: Config;
  equity: number | null;
}): React.ReactElement {
  const mark = pos.qty !== 0 ? pos.marketValue / pos.qty : 0;
  const sizePct = equity && equity > 0 ? (Math.abs(pos.marketValue) / equity) * 100 : null;
  const stopPct = config.risk.stop_loss_pct;
  const takePct = config.risk.take_profit_pct;
  const pnlColor = pos.unrealizedPnl >= 0 ? theme.color.success : theme.color.danger;

  return (
    <Box>
      <Text>{col(pos.symbol, 8)}</Text>
      <Text>{col(pos.qty.toString(), 7, "right")}</Text>
      <Text>{col(pos.avgEntryPrice.toFixed(2), 10, "right")}</Text>
      <Text>{col(mark.toFixed(2), 10, "right")}</Text>
      <Text color={pnlColor}>
        {col(`${pos.unrealizedPnl >= 0 ? "+" : ""}${pos.unrealizedPnl.toFixed(2)}`, 12, "right")}
      </Text>
      <Text color={sizePctColor(sizePct, config.risk.max_position_pct)}>
        {col(sizePct === null ? "—" : `${sizePct.toFixed(1)}%`, 8, "right")}
      </Text>
      <Text color={theme.color.muted}>{col(`-${stopPct}% / +${takePct}%`, 16, "right")}</Text>
    </Box>
  );
}

function col(text: string, width: number, align: "left" | "right" = "left"): string {
  if (text.length >= width) return text.slice(0, width);
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

function sizePctColor(size: number | null, max: number): string | undefined {
  if (size === null) return undefined;
  if (size > max) return theme.color.danger;
  if (size > max * 0.75) return theme.color.warn;
  return undefined;
}
