/**
 * Simple ASCII progress bar for Ink.
 * Avoids ESM/CJS issues with external packages.
 */

import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

interface Props {
  /** Progress percentage (0-100) */
  percent: number;
  /** Width of the bar in characters */
  width?: number;
  /** Color for the filled portion */
  fillColor?: string;
  /** Color for the empty portion */
  emptyColor?: string;
  /** Show percentage text */
  showPercent?: boolean;
  /** Label to show before the bar */
  label?: string;
}

export function ProgressBar({
  percent,
  width = 30,
  fillColor = theme.color.success,
  emptyColor = theme.color.muted,
  showPercent = true,
  label,
}: Props): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  return (
    <Box flexDirection="row">
      {label ? (
        <Text color={theme.color.text}>
          {label}{" "}
        </Text>
      ) : null}
      <Text color={fillColor}>{"█".repeat(filled)}</Text>
      <Text color={emptyColor}>{"░".repeat(empty)}</Text>
      {showPercent ? (
        <Text color={theme.color.text}>
          {" "}
          {clamped.toFixed(0)}%
        </Text>
      ) : null}
    </Box>
  );
}
