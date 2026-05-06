/**
 * Check whether the deterministic engine can run (config + environment).
 */

import fs from "node:fs";
import path from "node:path";

import type { Config, Secrets } from "../config.js";
import { resolveTradingDatabasePath } from "../config.js";
import { brokerRequiredSecrets } from "../config.js";

export interface ReadinessResult {
  ok: boolean;
  issues: string[];
  /** Warnings that do not block. */
  warnings: string[];
}

export function checkTradingReadiness(
  config: Config,
  secrets: Secrets,
  opts: { hasAlpaca: boolean; sentimentModelLoadFailed?: string | null } = { hasAlpaca: true },
): ReadinessResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!config.trading.enabled) {
    return { ok: true, issues: [], warnings: ["Trading engine is disabled in config."] };
  }

  if (!config.strategy.simple.enabled) {
    warnings.push("Simple strategy is disabled — engine will not produce signals.");
  }

  if (!config.autotrade.enabled) {
    warnings.push("Autotrade is off — signals will be logged but orders will not be submitted.");
  }

  if (!opts.hasAlpaca) {
    issues.push("Simple stock trading requires an Alpaca broker (alpaca_paper or alpaca_live). Set broker in Config or use Trading paper/live.");
  } else {
    for (const k of brokerRequiredSecrets("alpaca_paper")) {
      const v = secrets[k as keyof Secrets];
      if (typeof v !== "string" || !v.trim()) {
        issues.push(`Missing ${String(k)} for Alpaca.`);
      }
    }
  }

  if (
    (config.sentiment.provider === "local_finbert" || config.sentiment.provider === "hybrid_finbert") &&
    !config.sentiment.model_id.trim()
  ) {
    issues.push("sentiment.model_id is empty for FinBERT (local or hybrid fallback).");
  }
  if (config.sentiment.provider === "huggingface_api" && !secrets.HF_TOKEN?.trim()) {
    issues.push("sentiment.provider is huggingface_api but HF_TOKEN is missing.");
  }
  if (config.sentiment.provider === "hybrid_finbert") {
    const den = Math.max(1, config.sentiment.hf_api_runs_denominator);
    const num = Math.min(config.sentiment.hf_api_runs_numerator, den);
    if (num >= den && !secrets.HF_TOKEN?.trim()) {
      issues.push(
        "sentiment.provider is hybrid_finbert with API on every batch, but HF_TOKEN is missing — set it in .env or Config → Secrets.",
      );
    } else if (!secrets.HF_TOKEN?.trim()) {
      warnings.push(
        "Hybrid FinBERT: HF_TOKEN missing — API slots use local ONNX only (read/write HF_TOKEN in .env).",
      );
    }
  }
  if (
    (config.sentiment.provider === "local_finbert" || config.sentiment.provider === "hybrid_finbert") &&
    opts.sentimentModelLoadFailed
  ) {
    warnings.push(`FinBERT: ${opts.sentimentModelLoadFailed} — sentiment treated as 0.`);
  }

  try {
    const abs = resolveTradingDatabasePath(config);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.accessSync(path.dirname(abs), fs.constants.W_OK);
  } catch (e) {
    issues.push(
      `Cannot create or write trading database directory: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const s = config.strategy.simple;
  const sum = s.technical_weight + s.sentiment_weight;
  if (Math.abs(sum - 1) > 0.01) {
    warnings.push(
      `technical_weight (${s.technical_weight}) + sentiment_weight (${s.sentiment_weight}) should often sum to 1.0 (currently ${sum.toFixed(2)}).`,
    );
  }

  return { ok: issues.length === 0, issues, warnings };
}
