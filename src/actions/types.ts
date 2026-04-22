/**
 * Decision JSON — the agent's structured output, parsed and validated by the
 * orchestrator BEFORE any side-effecting action runs.
 */

import { z } from "zod";

export const DecisionSchema = z.object({
  action: z.enum(["buy", "sell", "hold", "close"]),
  symbol: z.string().min(1),
  qty: z.number().nonnegative(),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  limitPrice: z.number().positive().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;
