/**
 * Block-style progress bar for Ink (maps to PrimeNG ProgressBar “filled” track in spirit).
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

const FILLED = "\u2588";
const TRACK = "\u2591";

export interface TerminalProgressBarProps {
  /** 0..1, or null for indeterminate (pulsing empty bar). */
  fraction: number | null;
  /** Total bar width in character cells. */
  width: number;
  /** Optional right-side label (e.g. bytes). */
  suffix?: string;
}

export function TerminalProgressBar({
  fraction,
  width,
  suffix,
}: TerminalProgressBarProps): React.ReactElement {
  const w = Math.max(8, Math.floor(width));
  const f = fraction == null ? null : Math.max(0, Math.min(1, fraction));
  const filledCells = f == null ? Math.floor(w * 0.35) : Math.round(f * w);
  const bar = FILLED.repeat(filledCells) + TRACK.repeat(Math.max(0, w - filledCells));
  const pct = f == null ? "…" : `${Math.round(f * 100)}%`;
  const p = theme.primengDark;

  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text color={p.progressFill}>{bar}</Text>
      <Text>
        {" "}
        <Text bold color={p.progressLabel}>
          {pct}
        </Text>
        {suffix ? (
          <>
            {" "}
            <Text dimColor color={p.subtitle}>
              {suffix}
            </Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}
