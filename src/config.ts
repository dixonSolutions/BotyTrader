/**
 * BotyTrader — config loader.
 *
 * Splits configuration into two layers:
 *   - config.toml : non-secret behaviour settings (safe to commit).
 *   - .env        : secrets (never commit).
 *
 * Validation is strict (Zod) with a second pass that escalates broker-specific
 * secrets to "required" only when their broker is actually selected. This keeps
 * unused fields optional without weakening security for the active path.
 *
 * The reasoning LLM is either a *local* Hugging Face / ONNX model
 * (`@huggingface/transformers`, cached on disk) or the **Hugging Face Inference
 * API** (`@huggingface/inference`, requires `HF_TOKEN` in `.env`). Set
 * `[model] id` in config.toml or under Config → Settings (active model).
 * Sentiment uses FinBERT only — Config → Models.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import TOML from "@iarna/toml";
import dotenv from "dotenv";
import { z } from "zod";

/**
 * Default ReAct system prompt for the local trading agent.
 *
 * Override with `[agent].system_prompt` in config.toml. The orchestrator
 * still validates the FINAL JSON object against `DecisionSchema`, so any
 * custom prompt MUST instruct the model to terminate with the same shape.
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = `You are BotyTrader, a disciplined trading assistant running locally.
You operate in a strict ReAct loop. On each turn produce EXACTLY ONE of:

  Thought: <one short sentence about what you need next>
  Action: tool_name({"arg": "value"})

OR, when you have enough evidence, terminate with:

  Final: {"action":"buy"|"sell"|"hold"|"close","symbol":"<ticker>","qty":<number>,"reasoning":"<one short paragraph>","confidence":<0..1>}

Rules:
- Use ONLY the tool names listed in the user message.
- Action arguments MUST be valid JSON on a single line.
- Do not invent fields. Do not output prose around Final.
- Prefer hold with low confidence when data is missing.`;

// ---------------------------------------------------------------------------
// config.toml schema
// ---------------------------------------------------------------------------

export const BrokerPlatformSchema = z.enum([
  "alpaca_paper",
  "alpaca_live",
  "coinbase",
  "binance",
]);
export type BrokerPlatform = z.infer<typeof BrokerPlatformSchema>;

/** Quantisation / dtype hint forwarded to `@huggingface/transformers`. */
export const ModelDtypeSchema = z.enum(["fp32", "fp16", "q8", "q4", "q4f16", "auto"]);
export type ModelDtype = z.infer<typeof ModelDtypeSchema>;

/** Inference device — `auto` lets transformers.js pick (WebGPU/CPU). */
export const ModelDeviceSchema = z.enum(["auto", "cpu", "wasm", "webgpu"]);
export type ModelDevice = z.infer<typeof ModelDeviceSchema>;

/** Where the ReAct “pilot” LLM runs — local ONNX/transformers.js vs HF serverless API. */
export const ModelProviderSchema = z.enum(["local", "huggingface_api"]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/** Simple strategy paper vs live — maps to Alpaca broker platform. */
export const TradingModeSchema = z.enum(["paper", "live"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

export const SentimentProviderSchema = z.enum([
  "local_finbert",
  "huggingface_api",
  /** Mix of HF Inference API and local ONNX per `hf_api_runs_*` (see config.example.toml). */
  "hybrid_finbert",
  "disabled",
]);
export type SentimentProvider = z.infer<typeof SentimentProviderSchema>;

export const ConfigSchema = z.object({
  gemini: z.object({
    embedding_model: z.string().min(1).default("text-embedding-004"),
  }),
  /**
   * Reasoning model — local (transformers.js + disk cache) or Hugging Face
   * Inference API. `id` is the active HF model id in both cases.
   */
  model: z
    .object({
      provider: ModelProviderSchema.default("local"),
      id: z.string().default(""),
      dtype: ModelDtypeSchema.default("q4"),
      device: ModelDeviceSchema.default("auto"),
      max_new_tokens: z.number().int().positive().default(512),
      cache_dir: z.string().default(".cache/models"),
    })
    .default({}),
  huggingface: z.object({
    bucket_name: z.string().min(1),
    endpoint: z.string().url().default("https://huggingface.co"),
    region: z.string().default("us-east-1"),
  }),
  broker: z.object({
    platform: BrokerPlatformSchema,
  }),
  /**
   * Deterministic stock trading engine (Alpaca) — see docs/simple-strategy.md.
   * `trading.mode` is kept in sync with `broker.platform` for paper/live.
   */
  trading: z
    .object({
      enabled: z.boolean().default(true),
      mode: TradingModeSchema.default("paper"),
      /** Default: ~/.config/trading-cli/trades.db — tilde expanded at resolve time. */
      database_path: z.string().min(1).default("~/.config/trading-cli/trades.db"),
      /**
       * Multiplier on conviction-sized buy notional (see config.example.toml [trading]).
       * 1.0 = full formula; 0.5 = half the computed dollar amount per buy.
       */
      positioning_scalar: z.number().min(0).max(10).default(1),
    })
    .default({}),
  /** Simple technical + FinBERT hybrid strategy parameters. */
  strategy: z
    .object({
      simple: z
        .object({
          enabled: z.boolean().default(true),
          technical_weight: z.number().min(0).max(1).default(0.6),
          sentiment_weight: z.number().min(0).max(1).default(0.4),
          buy_threshold: z.number().default(0.5),
          /**
           * Optional “soft” buy band (hybrid on [-1,1], must be **less** than `buy_threshold`).
           * When set: between `buy_trim_threshold` and `buy_threshold` → scale **buy notional** linearly up to the usual formula at the top of the band; `hybrid > buy_threshold` → full notional. When omitted, only `hybrid > buy_threshold` triggers a buy (legacy).
           */
          buy_trim_threshold: z.number().optional(),
          /** Hybrid at or below this → sell entire position (when trim is unset, same as legacy single sell line). */
          sell_threshold: z.number().default(-0.3),
          /**
           * Optional “soft” sell band (hybrid on [-1,1], must be **greater** than `sell_threshold`).
           * When set: between `sell_trim_threshold` and `sell_threshold` → scale sell size linearly;
           * at or below `sell_threshold` → full exit. When omitted, only `hybrid < sell_threshold` triggers a full sell.
           */
          sell_trim_threshold: z.number().optional(),
          sma_fast_period: z.number().int().positive().default(20),
          sma_slow_period: z.number().int().positive().default(50),
          rsi_period: z.number().int().positive().default(14),
          /** Fraction of price — spread below this between SMAs counts as neutral crossover. */
          sma_neutral_band: z.number().min(0).max(0.1).default(0.001),
        })
        .default({}),
    })
    .default({}),
  /**
   * Technical indicator configuration — 10 indicators with configurable weights.
   * Each indicator can be enabled/disabled and has adjustable parameters.
   */
  indicators: z
    .object({
      /** Simple Moving Average — trend following indicator */
      sma: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.15),
          period: z.number().int().positive().default(50),
          fast_period: z.number().int().positive().default(20),
        })
        .default({}),
      /** Exponential Moving Average — faster-reacting trend indicator */
      ema: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.10),
          fast_period: z.number().int().positive().default(12),
          slow_period: z.number().int().positive().default(26),
        })
        .default({}),
      /** Relative Strength Index — momentum oscillator (0-100) */
      rsi: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.12),
          period: z.number().int().positive().default(14),
          oversold: z.number().min(0).max(100).default(30),
          overbought: z.number().min(0).max(100).default(70),
        })
        .default({}),
      /** MACD — Moving Average Convergence Divergence */
      macd: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.10),
          fast_period: z.number().int().positive().default(12),
          slow_period: z.number().int().positive().default(26),
          signal_period: z.number().int().positive().default(9),
        })
        .default({}),
      /** Bollinger Bands — volatility-based support/resistance */
      bollinger: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.08),
          period: z.number().int().positive().default(20),
          std_dev: z.number().positive().default(2.0),
        })
        .default({}),
      /** Stochastic Oscillator — momentum indicator comparing close to range */
      stochastic: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.08),
          k_period: z.number().int().positive().default(14),
          d_period: z.number().int().positive().default(3),
          oversold: z.number().min(0).max(100).default(20),
          overbought: z.number().min(0).max(100).default(80),
        })
        .default({}),
      /** Average True Range — volatility measurement (used as dampener) */
      atr: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.05),
          period: z.number().int().positive().default(14),
          high_volatility_threshold: z.number().positive().default(0.05),
        })
        .default({}),
      /** On-Balance Volume — volume flow indicator */
      obv: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.12),
        })
        .default({}),
      /** Fibonacci Retracement — support/resistance levels */
      fibonacci: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.10),
          levels: z.array(z.number().min(0).max(1)).default([0.236, 0.382, 0.5, 0.618, 0.786]),
          proximity_threshold: z.number().min(0).max(0.1).default(0.02),
        })
        .default({}),
      /** Ichimoku Cloud — comprehensive trend/support/resistance */
      ichimoku: z
        .object({
          enabled: z.boolean().default(true),
          weight: z.number().min(0).max(1).default(0.10),
          tenkan_period: z.number().int().positive().default(9),
          kijun_period: z.number().int().positive().default(26),
          senkou_b_period: z.number().int().positive().default(52),
          displacement: z.number().int().positive().default(26),
        })
        .default({}),
    })
    .default({}),
  sentiment: z
    .object({
      provider: SentimentProviderSchema.default("local_finbert"),
      /**
       * Sentiment repo id. Use `ProsusAI/finbert` for API + docs; local Node
       * loads the Transformers.js ONNX port `Xenova/finbert` automatically.
       */
      model_id: z.string().min(1).default("ProsusAI/finbert"),
      /** Hours until sentiment_cache rows are ignored (re-score). */
      cache_ttl_hours: z.number().positive().default(24),
      /**
       * When `provider === hybrid_finbert`: out of every `hf_api_runs_denominator`
       * sentiment batches (one symbol’s news pass), use HF Inference for the first
       * `hf_api_runs_numerator` batches. Example: 1 / 2 → API on half the batches.
       */
      hf_api_runs_numerator: z.number().int().min(0).max(20).default(1),
      hf_api_runs_denominator: z.number().int().min(1).max(20).default(2),
    })
    .superRefine((s, ctx) => {
      if (s.hf_api_runs_numerator > s.hf_api_runs_denominator) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "hf_api_runs_numerator must be <= hf_api_runs_denominator",
          path: ["hf_api_runs_numerator"],
        });
      }
    })
    .default({}),
  schedule: z.object({
    agent_interval_seconds: z.number().int().positive().default(300),
    exit_monitor_interval_seconds: z.number().int().positive().default(30),
    portfolio_cycle_seconds: z.number().int().positive().default(300),
    candidate_cycle_seconds: z.number().int().positive().default(1800),
  }),
  risk: z.object({
    max_position_pct: z.number().nonnegative().default(10),
    min_confidence_to_trade: z.number().min(0).max(1).default(0.6),
    stop_loss_pct: z.number().nonnegative().default(2),
    take_profit_pct: z.number().nonnegative().default(5),
  }),
  /**
   * Symbols the simple strategy evaluates on the candidate cycle — at least one
   * non-empty ticker is required when this config loads.
   */
  watchlist: z.object({
    symbols: z
      .array(z.string())
      .default([])
      .transform((symbols) =>
        Array.from(
          new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter((x) => x.length > 0)),
        ),
      )
      .pipe(z.array(z.string().min(1)).min(1, "watchlist.symbols must list at least one stock ticker")),
  }),
  autotrade: z.object({
    enabled: z.boolean().default(false),
  }),
  features: z
    .object({
      /** When false, skip RAG search, memory sync/writes, and do not call Gemini/HF for memory (keys may remain in `.env`). */
      memory_enabled: z.boolean().default(true),
      /** When false, the brave_web_search tool is not offered to the model (BRAVE_API_KEY may remain in `.env`). */
      web_search_enabled: z.boolean().default(false),
    })
    .default({}),
  agent: z
    .object({
      system_prompt: z.string().min(1).default(DEFAULT_AGENT_SYSTEM_PROMPT),
      /** Hard cap on ReAct iterations per cycle. */
      max_iterations: z.number().int().positive().default(8),
      /**
       * How much to favour qualitative sentiment/news vs quantitative technicals
       * when they conflict (0 = all technical, 1 = all sentiment). Injected into
       * the cycle prompt; tools still supply raw facts.
       */
      sentiment_weight: z.number().min(0).max(1).default(0.35),
    })
    .default({}),
  /**
   * Autonomous optimizer — feature snapshots, walk-forward challengers, learning-rate config updates.
   */
  optimization: z
    .object({
      enabled: z.boolean().default(false),
      /** `daily` or a weekday name (lowercase): sunday … saturday. */
      schedule_day: z
        .enum([
          "daily",
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ])
        .default("daily"),
      /** Local hour 0–23 to run the optimization cycle. */
      schedule_hour: z.number().int().min(0).max(23).default(2),
      lookback_days: z.number().int().positive().default(14),
      challenger_count: z.number().int().positive().max(500).default(50),
      /** Gaussian mutation scale for weight nudges. */
      mutation_rate: z.number().positive().max(0.5).default(0.02),
      learning_rate: z.number().min(0).max(1).default(0.1),
      improvement_threshold: z.number().min(0).max(2).default(0.1),
      max_single_weight: z.number().min(0.05).max(1).default(0.3),
      stress_test_enabled: z.boolean().default(true),
      shadow_capture_range: z.number().min(0).max(1).default(0.2),
      /** Hours until outcome % is recorded (matches snapshot exit window). */
      exit_window_hours: z.number().int().positive().default(48),
      /**
       * Challenger / snapshot metadata: hysteresis-style threshold (0–100) stored on feature snapshots.
       * Tuned by the walk-forward optimizer when gates pass.
       */
      challenger_swap_threshold: z.number().int().min(0).max(100).default(10),
      /**
       * Challenger tuning: minimum rank-style score (0–100) used when mutating challenger bundles.
       */
      challenger_min_entry_score: z.number().int().min(0).max(100).default(75),
      /** Minimum completed snapshots before running optimization. */
      min_snapshots: z.number().int().positive().default(10),
      /** How often to backfill snapshot outcomes from `price_history` (minutes). */
      outcome_monitor_interval_minutes: z.number().int().positive().default(30),
    })
    .default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// .env / SecretsSchema
// ---------------------------------------------------------------------------

const optionalEnvKey = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

export const SecretsSchema = z.object({
  /**
   * Optional HF access token — only required for *gated* model repositories
   * (most public ONNX chat models do not need it).
   */
  HF_TOKEN: optionalEnvKey,
  /** Required only when `features.memory_enabled` is true. */
  GEMINI_API_KEY: optionalEnvKey,
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_API_SECRET: z.string().optional(),
  COINBASE_API_KEY: z.string().optional(),
  COINBASE_API_SECRET: z.string().optional(),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  /** Used when `features.web_search_enabled` is true (optional otherwise). */
  BRAVE_API_KEY: optionalEnvKey,
});
export type Secrets = z.infer<typeof SecretsSchema>;

/** Human-readable description for each secret — surfaced in the TUI Setup wizard. */
export const SECRET_DESCRIPTIONS: Record<keyof Secrets, string> = {
  HF_TOKEN:
    "Hugging Face access token (https://huggingface.co/settings/tokens) — paste into .env as HF_TOKEN=... or Config → Secrets. Needed for sentiment via HF Inference (huggingface_api / hybrid_finbert API slots), reasoning when model.provider = huggingface_api, gated Hub downloads, and memory when enabled.",
  GEMINI_API_KEY:
    "Google Gemini API key — embeddings; required when features.memory_enabled is true (https://aistudio.google.com).",
  ALPACA_API_KEY: "Alpaca API key (paper or live, per config.toml).",
  ALPACA_API_SECRET: "Alpaca API secret (matches ALPACA_API_KEY).",
  COINBASE_API_KEY: "Coinbase Advanced Trade API key.",
  COINBASE_API_SECRET: "Coinbase Advanced Trade API secret.",
  BINANCE_API_KEY: "Binance API key.",
  BINANCE_API_SECRET: "Binance API secret.",
  BRAVE_API_KEY: "Brave Search API key — required when features.web_search_enabled is true.",
};

/** Names of secrets required for a given broker platform. */
export function brokerRequiredSecrets(platform: BrokerPlatform): (keyof Secrets)[] {
  switch (platform) {
    case "alpaca_paper":
    case "alpaca_live":
      return ["ALPACA_API_KEY", "ALPACA_API_SECRET"];
    case "coinbase":
      return ["COINBASE_API_KEY", "COINBASE_API_SECRET"];
    case "binance":
      return ["BINANCE_API_KEY", "BINANCE_API_SECRET"];
  }
}

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

export interface Paths {
  root: string;
  configToml: string;
  envFile: string;
}

export function resolvePaths(root = process.cwd()): Paths {
  return {
    root,
    configToml: path.join(root, "config.toml"),
    envFile: path.join(root, ".env"),
  };
}

/** Absolute model cache directory derived from `config.model.cache_dir`. */
export function resolveModelCacheDir(config: Config, paths: Paths = resolvePaths()): string {
  const dir = config.model.cache_dir;
  return path.isAbsolute(dir) ? dir : path.join(paths.root, dir);
}

/**
 * Expands `~/…` to the user home and resolves relative paths against the project root.
 */
export function expandUserPath(p: string): string {
  const raw = p.trim();
  if (!raw.startsWith("~")) return raw;
  if (raw === "~" || raw === `~${path.sep}`) return os.homedir();
  if (raw.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

/**
 * Resolves `trading.database_path` to an absolute path.
 */
export function resolveTradingDatabasePath(config: Config, paths: Paths = resolvePaths()): string {
  const raw = expandUserPath(config.trading.database_path);
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.join(paths.root, raw);
  return path.normalize(abs);
}

/**
 * When broker is Alpaca, mirror `broker.platform` into `trading.mode` (paper vs live).
 * Call after `loadConfig` so a single file edit stays consistent.
 */
export function syncTradingModeFromBroker(config: Config): void {
  if (config.broker.platform === "alpaca_paper") config.trading.mode = "paper";
  else if (config.broker.platform === "alpaca_live") config.trading.mode = "live";
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadConfig(paths: Paths = resolvePaths()): Config {
  if (!fs.existsSync(paths.configToml)) {
    // Fall back to example so first-run is not fatal; user is told to copy it.
    const example = process.env.BOTYTRADER_EXAMPLE_CONFIG
      ? path.resolve(process.env.BOTYTRADER_EXAMPLE_CONFIG)
      : path.join(paths.root, "config.example.toml");
    if (!fs.existsSync(example)) {
      throw new Error(
        `config.toml not found at ${paths.configToml} and no config.example.toml to fall back to.`,
      );
    }
    fs.copyFileSync(example, paths.configToml);
  }
  const raw = fs.readFileSync(paths.configToml, "utf8");
  const parsed = TOML.parse(raw) as unknown;
  const config = ConfigSchema.parse(parsed);
  syncTradingModeFromBroker(config);
  return config;
}

/** Result of secrets validation — either OK with values, or missing key list for the wizard. */
export type SecretsResult =
  | { ok: true; secrets: Secrets }
  | { ok: false; missing: (keyof Secrets)[] };

export function loadSecrets(
  config: Config,
  paths: Paths = resolvePaths(),
): SecretsResult {
  if (fs.existsSync(paths.envFile)) {
    dotenv.config({ path: paths.envFile, override: false });
  }

  const result = SecretsSchema.safeParse(process.env);
  const requiredForBroker = brokerRequiredSecrets(config.broker.platform);

  const missing = new Set<keyof Secrets>();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") missing.add(key as keyof Secrets);
    }
  }
  for (const key of requiredForBroker) {
    const v = process.env[key];
    if (!v || v.trim() === "") missing.add(key);
  }

  if (config.features.memory_enabled) {
    for (const key of ["GEMINI_API_KEY", "HF_TOKEN"] as const) {
      const v = process.env[key];
      if (!v || v.trim() === "") missing.add(key);
    }
  }
  if (config.model.provider === "huggingface_api") {
    const v = process.env.HF_TOKEN;
    if (!v || v.trim() === "") missing.add("HF_TOKEN");
  }
  if (config.sentiment.provider === "huggingface_api") {
    const v = process.env.HF_TOKEN;
    if (!v || v.trim() === "") missing.add("HF_TOKEN");
  }
  if (config.features.web_search_enabled) {
    const v = process.env.BRAVE_API_KEY;
    if (!v || v.trim() === "") missing.add("BRAVE_API_KEY");
  }

  if (missing.size === 0) {
    // Re-parse to coerce types now that all required keys exist.
    return { ok: true, secrets: SecretsSchema.parse(process.env) };
  }
  return { ok: false, missing: Array.from(missing) };
}

// ---------------------------------------------------------------------------
// Persisting secrets back to .env (Setup wizard / Secrets screen)
// ---------------------------------------------------------------------------

/**
 * Upsert one or more keys into .env without disturbing comments or unrelated
 * keys. Creates the file if missing.
 */
export function writeEnv(updates: Partial<Record<keyof Secrets, string>>, paths: Paths = resolvePaths()): void {
  let content = fs.existsSync(paths.envFile)
    ? fs.readFileSync(paths.envFile, "utf8")
    : "";

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      if (content.length > 0 && !content.endsWith("\n")) content += "\n";
      content += line + "\n";
    }
    process.env[key] = value;
  }

  fs.writeFileSync(paths.envFile, content, { mode: 0o600 });
}

/** Persist non-secret config changes back to config.toml. */
export function writeConfig(config: Config, paths: Paths = resolvePaths()): void {
  // Cast through unknown — Config matches TOML's JsonMap shape at runtime.
  const serialised = TOML.stringify(config as unknown as TOML.JsonMap);
  fs.writeFileSync(paths.configToml, serialised);
}
