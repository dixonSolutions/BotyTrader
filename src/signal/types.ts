/**
 * Signal module type definitions.
 *
 * Standard OHLCV bar format used across all indicators.
 */

/** OHLCV bar — standard financial data point */
export interface OhlcBar {
  /** Open price */
  o: number;
  /** High price */
  h: number;
  /** Low price */
  l: number;
  /** Close price */
  c: number;
  /** Volume */
  v: number;
  /** Optional timestamp (Unix ms) */
  t?: number;
}

/** OHLC data for indicator calculations (volume-agnostic) */
export interface OhlcData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  timestamps?: number[];
}

/** Convert array of bars to OHLCData structure */
export function barsToOhlc(bars: OhlcBar[]): OhlcData {
  return {
    opens: bars.map((b) => b.o),
    highs: bars.map((b) => b.h),
    lows: bars.map((b) => b.l),
    closes: bars.map((b) => b.c),
    volumes: bars.map((b) => b.v),
    timestamps: bars.map((b) => b.t).filter((t): t is number => t !== undefined),
  };
}

/** Indicator metadata for configuration tables */
export interface IndicatorMetadata {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Category for grouping */
  category: "Trend" | "Momentum" | "Volatility" | "Volume" | "Support" | "Complex";
  /** Default weight as decimal (0-1) */
  defaultWeight: number;
  /** Description of what this indicator measures */
  description: string;
  /** Buy signal logic description */
  buyLogic: string;
  /** Reference to industry standard formula source */
  formulaSource: string;
}

/** Complete metadata for all 10 technical indicators */
export const TECHNICAL_INDICATORS_METADATA: IndicatorMetadata[] = [
  {
    id: "sma",
    name: "Simple Moving Average",
    category: "Trend",
    defaultWeight: 0.15,
    description: "Average price over a specific number of periods. A smoothing tool that ignores short-term price spikes.",
    buyLogic: "Price > SMA (Long-term trend is up)",
    formulaSource: "Standard arithmetic mean",
  },
  {
    id: "ema",
    name: "Exponential Moving Average",
    category: "Trend",
    defaultWeight: 0.10,
    description: "Similar to SMA but gives more weight to recent price data. Reacts faster to price changes.",
    buyLogic: "Short EMA > Long EMA (Golden Cross)",
    formulaSource: "Multiplier = 2/(period+1)",
  },
  {
    id: "rsi",
    name: "Relative Strength Index",
    category: "Momentum",
    defaultWeight: 0.12,
    description: "Momentum oscillator (0-100) comparing recent gains to losses. Wilder smoothing method.",
    buyLogic: "RSI < 30 (Oversold) or RSI crossing above 50",
    formulaSource: "Wilder RSI (1978)",
  },
  {
    id: "macd",
    name: "MACD",
    category: "Momentum",
    defaultWeight: 0.10,
    description: "Moving Average Convergence Divergence. Shows trend momentum and direction changes.",
    buyLogic: "MACD line crosses above Signal line",
    formulaSource: "EMA(12) - EMA(26), Signal = EMA(9)",
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    category: "Volatility",
    defaultWeight: 0.08,
    description: "Volatility bands at SMA ± 2σ. Measures how stretched price is from average.",
    buyLogic: "Price touches Lower Band + bounces",
    formulaSource: "SMA ± (k × σ) where k=2",
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    category: "Momentum",
    defaultWeight: 0.08,
    description: "Compares closing price to price range. More sensitive than RSI for quick swings.",
    buyLogic: "%K line crosses above %D line below 20",
    formulaSource: "%K = (Close - Low) / (High - Low) × 100",
  },
  {
    id: "atr",
    name: "Average True Range",
    category: "Volatility",
    defaultWeight: 0.05,
    description: "Measures market volatility. Does not indicate direction, only magnitude of swings.",
    buyLogic: "Used to dampen other scores during high volatility",
    formulaSource: "Wilder smoothing of True Range",
  },
  {
    id: "obv",
    name: "On-Balance Volume",
    category: "Volume",
    defaultWeight: 0.12,
    description: "Cumulative volume based on price direction. Shows if Big Money is buying.",
    buyLogic: "OBV trending up while price is stable/up",
    formulaSource: "Granville OBV (1963)",
  },
  {
    id: "fibonacci",
    name: "Fibonacci Retracement",
    category: "Support",
    defaultWeight: 0.10,
    description: "Support/resistance levels based on Fibonacci sequence. Markets often pull back to 38.2%, 50%, 61.8%.",
    buyLogic: "Price within 2% of 0.618 Golden Pocket",
    formulaSource: "High - (High - Low) × ratio",
  },
  {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    category: "Complex",
    defaultWeight: 0.10,
    description: "Comprehensive all-in-one indicator from Japan. Five formulas for trend, support, and resistance.",
    buyLogic: "Price is above the Kumo Cloud",
    formulaSource: "Standard Ichimoku formulas (9,26,52)",
  },
];

/** Indicator table row format for UI display */
export interface IndicatorTableRow {
  number: number;
  indicator: string;
  weight: string;
  category: string;
  buyLogic: string;
  enabled: boolean;
}

/** Convert metadata to table rows */
export function getIndicatorTableRows(enabledMap: Record<string, boolean>): IndicatorTableRow[] {
  return TECHNICAL_INDICATORS_METADATA.map((ind, i) => ({
    number: i + 1,
    indicator: ind.name,
    weight: `${(ind.defaultWeight * 100).toFixed(0)}%`,
    category: ind.category,
    buyLogic: ind.buyLogic,
    enabled: enabledMap[ind.id] ?? true,
  }));
}
