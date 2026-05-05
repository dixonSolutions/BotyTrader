/**
 * Generate mutated weight / execution-parameter bundles for walk-forward search.
 */

import type { Config } from "../../config.js";
import type { ChallengerBundle, IndicatorWeights } from "./types.js";
import { ALL_INDICATOR_WEIGHT_KEYS } from "./types.js";
import { readIndicatorWeightsFromConfig } from "./repositories.js";

function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = 1 - rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeWeights(w: IndicatorWeights, fallback: IndicatorWeights): IndicatorWeights {
  const keys = [...ALL_INDICATOR_WEIGHT_KEYS];
  let sum = 0;
  for (const k of keys) {
    sum += Math.max(0, w[k]);
  }
  if (sum <= 0) return { ...fallback };
  const out = { ...w };
  for (const k of keys) {
    out[k] = Math.max(0, out[k]! / sum);
  }
  return out;
}

/**
 * Produce `count` challenger bundles by perturbing champion weights and execution params.
 */
export function generateChallengers(
  config: Config,
  count: number,
  mutationRate: number,
  rng: () => number = Math.random,
): ChallengerBundle[] {
  const champion = readIndicatorWeightsFromConfig(config);
  const s = config.strategy.simple;
  const o = config.optimization;
  const exitH = o.exit_window_hours ?? 48;
  const minEntry = o.challenger_min_entry_score ?? 75;

  const bundles: ChallengerBundle[] = [];
  for (let i = 0; i < count; i++) {
    const w: IndicatorWeights = { ...champion };
    for (const k of ALL_INDICATOR_WEIGHT_KEYS) {
      const noise = gaussian(rng) * mutationRate;
      w[k] = clamp((w[k] ?? 0) + noise, 0, 1);
    }
    const nw = normalizeWeights(w, champion);

    const buyNudge = gaussian(rng) * mutationRate * 0.15;
    const buyThreshold = clamp(s.buy_threshold + buyNudge, -0.95, 0.95);

    const swapNudge = gaussian(rng) * mutationRate * 5;
    const swapThreshold = clamp(Math.round(o.challenger_swap_threshold + swapNudge), 0, 100);

    const exitNudge = Math.round(gaussian(rng) * mutationRate * 24);
    const exitWindowHours = clamp(Math.round(exitH + exitNudge), 6, 240);

    const entryNudge = gaussian(rng) * mutationRate * 10;
    const minEntryScore = clamp(Math.round(minEntry + entryNudge), 40, 95);

    bundles.push({
      weights: nw,
      buyThreshold,
      exitWindowHours,
      swapThreshold,
      minEntryScore,
    });
  }
  return bundles;
}
