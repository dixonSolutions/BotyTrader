/**
 * ASCII sparkline — compact equity curve for the Insights vital-signs row.
 * Pure rendering; no Ink-specific state. Empty data renders a flat line of
 * the requested width so layout stays stable.
 */

import React from "react";
import { Text } from "ink";

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

interface Props {
  values: number[];
  width?: number;
  color?: string;
}

export function Sparkline({ values, width = 40, color = "white" }: Props): React.ReactElement {
  if (values.length === 0) {
    return <Text color={color}>{"─".repeat(width)}</Text>;
  }
  const sliced = values.length > width ? values.slice(values.length - width) : values;
  const min = Math.min(...sliced);
  const max = Math.max(...sliced);
  const range = max - min;
  const chars = sliced.map((v) => {
    if (range === 0) return BARS[0];
    const idx = Math.round(((v - min) / range) * (BARS.length - 1));
    return BARS[Math.max(0, Math.min(BARS.length - 1, idx))];
  });
  // Left-pad so width stays stable even with short series.
  const pad = "─".repeat(Math.max(0, width - chars.length));
  return <Text color={color}>{pad + chars.join("")}</Text>;
}
