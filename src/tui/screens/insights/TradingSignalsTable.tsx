/**
 * Recent rows from the `signals` SQLite table — ink-table, local timestamps.
 */

import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";

import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { ScrollRegion } from "../../components/ScrollRegion.js";
import { theme } from "../../theme.js";
import type { SignalRow } from "../../../trading/types.js";
import { formatInsightLocalShort } from "./insightFormatters.js";

function scoreTxt(n: number | null): string {
  return n === null || Number.isNaN(n) ? "—" : n.toFixed(2);
}

const SIGNAL_COLUMNS = ["Time (local)", "Sym", "Act", "Tech", "Sent", "Final", "OK"] as const;

function signalToRow(s: SignalRow, timeW: number, symW: number): AppTableRow {
  const t = formatInsightLocalShort(s.createdAt);
  const time = t.length > timeW ? `${t.slice(0, timeW - 1)}…` : t;
  const sym = s.symbol.length > symW ? `${s.symbol.slice(0, symW - 1)}…` : s.symbol;
  return {
    "Time (local)": time,
    Sym: sym,
    Act: s.action.toUpperCase(),
    Tech: scoreTxt(s.technicalScore),
    Sent: scoreTxt(s.sentimentScore),
    Final: scoreTxt(s.hybridScore),
    OK: s.executed ? "Y" : "N",
  };
}

interface Props {
  signals: SignalRow[];
  dbOpenError: string | null;
  viewportRows: number;
}

export function TradingSignalsTable({ signals, dbOpenError, viewportRows }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const timeW = Math.min(22, Math.max(16, Math.floor(cols * 0.22)));
  const symW = 6;

  const data = useMemo(
    () => signals.map((s) => signalToRow(s, timeW, symW)),
    [signals, timeW, symW],
  );

  const scrollH = Math.max(viewportRows, 14);

  const hint = dbOpenError ? (
    <Text color={theme.color.danger}>Database unavailable — signals not loaded.</Text>
  ) : signals.length === 0 ? (
    <Text dimColor>No signals recorded yet (run trading cycles with DB open).</Text>
  ) : null;

  return (
    <Box flexDirection="column" paddingX={1} paddingBottom={1}>
      {hint}
      <Box height={scrollH} minHeight={scrollH} flexDirection="column" marginTop={0}>
        {signals.length > 0 ? (
          <Box flexGrow={1} minHeight={0} flexDirection="column">
            <ScrollRegion showScrollbar>
              <AppTable data={data} columns={[...SIGNAL_COLUMNS]} padding={1} />
            </ScrollRegion>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
