/**
 * View models for technical score breakdown (pre-shaped strings for any UI layer).
 * All arithmetic for “adjusted” contributions lives here, not in the TUI.
 */

import type { IndicatorValues, TechnicalScoreResult } from "../../signal/technicalScore.js";

export interface TechnicalIndicatorDisplayRow {
  name: string;
  /** Indicator signal in roughly [-1, 1] (ATR row shows dampener 0–1). */
  actualDisplay: string;
  /** Enabled weight as % of configured validity. */
  weightDisplay: string;
  /** Contribution to raw composite before ATR dampener, or ATR note. */
  adjustedDisplay: string;
  enabled: boolean;
  /** Pre-spaced metrics line for monospace UIs. */
  paddedMetricsLine: string;
}

export function formatSignedTwoDecimals(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function padDisplayCell(s: string, w: number): string {
  const t = s.length > w ? s.slice(0, w) : s;
  return t + " ".repeat(Math.max(0, w - t.length));
}

function sumScoringIndicatorWeights(iv: IndicatorValues): number {
  const parts = [
    iv.sma,
    iv.ema,
    iv.rsi,
    iv.macd,
    iv.bollinger,
    iv.stochastic,
    iv.obv,
    iv.fibonacci,
    iv.ichimoku,
  ];
  return parts.reduce((s, p) => s + (p.weight > 0 ? p.weight : 0), 0);
}

/**
 * Flatten {@link TechnicalScoreResult} into display rows (all 10 indicators).
 * “Adjusted” is contribution to the pre-dampener composite: score×weight / Σweights.
 */
export function buildTechnicalIndicatorDisplayRows(result: TechnicalScoreResult): TechnicalIndicatorDisplayRow[] {
  const iv = result.indicators;
  const totalW = sumScoringIndicatorWeights(iv);

  const scoringRow = (name: string, score: number, weight: number): TechnicalIndicatorDisplayRow => {
    const enabled = weight > 0;
    const adj = enabled && totalW > 0 ? formatSignedTwoDecimals((score * weight) / totalW) : "—";
    const actualDisplay = enabled ? formatSignedTwoDecimals(score) : "—";
    const weightDisplay = enabled ? `${(weight * 100).toFixed(0)}%` : "off";
    return {
      name,
      actualDisplay,
      weightDisplay,
      adjustedDisplay: adj,
      enabled,
      paddedMetricsLine: `${padDisplayCell(actualDisplay, 10)} ${padDisplayCell(weightDisplay, 8)} ${adj}`,
    };
  };

  const rows: TechnicalIndicatorDisplayRow[] = [
    scoringRow("SMA", iv.sma.score, iv.sma.weight),
    scoringRow("EMA", iv.ema.score, iv.ema.weight),
    scoringRow("RSI", iv.rsi.score, iv.rsi.weight),
    scoringRow("MACD", iv.macd.score, iv.macd.weight),
    scoringRow("Bollinger", iv.bollinger.score, iv.bollinger.weight),
    scoringRow("Stochastic", iv.stochastic.score, iv.stochastic.weight),
    scoringRow("OBV", iv.obv.score, iv.obv.weight),
    scoringRow("Fibonacci", iv.fibonacci.score, iv.fibonacci.weight),
    scoringRow("Ichimoku", iv.ichimoku.score, iv.ichimoku.weight),
  ];

  const atrOn = iv.atr.weight > 0;
  const atrActual = atrOn ? iv.atr.dampener.toFixed(2) : "—";
  const atrWeight = atrOn ? `${(iv.atr.weight * 100).toFixed(0)}%` : "off";
  const atrAdj = atrOn
    ? `raw ${formatSignedTwoDecimals(result.rawScore)} → ×${result.volatilityDampener.toFixed(2)}`
    : "—";
  rows.push({
    name: "ATR (volatility)",
    actualDisplay: atrActual,
    weightDisplay: atrWeight,
    adjustedDisplay: atrAdj,
    enabled: atrOn,
    paddedMetricsLine: `${padDisplayCell(atrActual, 10)} ${padDisplayCell(atrWeight, 8)} ${atrAdj}`,
  });

  return rows;
}

/** Shown when full-indicator OHLC history was unavailable for this row. */
export const TECHNICAL_POPOVER_INSUFFICIENT_DATA_MESSAGE =
  "Full per-indicator breakdown needs 80+ daily bars. Weights and thresholds still follow your config; this row used the simplified technical path.";

export function buildTechnicalPopoverSubtitle(
  symbol: string,
  compositeTechnicalScore: number,
): string {
  return `${symbol} · composite ${formatSignedTwoDecimals(compositeTechnicalScore)}`;
}

/** Pre-aligned inner table header for the technical popover. */
export const TECHNICAL_POPOVER_COLUMN_HEADER_LINE = `${padDisplayCell("Category", 12)} ${padDisplayCell("Actual", 10)} ${padDisplayCell("Weight", 8)} Adj. to composite`;

export function technicalPopoverSeparatorDashCount(tableHeaderLine: string, terminalCols: number): number {
  const inner = Math.min(56, Math.max(44, terminalCols - 10));
  return Math.min(inner, tableHeaderLine.length + 8);
}
