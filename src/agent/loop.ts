/**
 * Agent loop — ONE cycle of RAG → local or HF Inference API LLM (ReAct) → decision JSON.
 *
 * Architecture (matches the docs/agent-cycle.md description):
 *
 *   1. System prompt  : enumerates available MCP tool names + JSON schemas.
 *   2. Inference      : the local model emits Thought / Action / Final.
 *   3. Parsing        : we regex Action lines, JSON-parse the args.
 *   4. Execution      : MCP tool dispatch in-process (`callTool`).
 *   5. Observation    : tool result is fed back as the next user turn.
 *
 * The loop never executes orders or writes memory directly — those are
 * orchestrator actions invoked AFTER decision validation. This separation is
 * what lets risk gates and the autotrade flag be enforced in one place.
 */

import { DecisionSchema, type Decision } from "../actions/types.js";
import type { Config, Secrets } from "../config.js";
import { generateAgentTurn, type ChatMessage } from "../llm/inference.js";
import type { WorkingMemoryStore } from "../memory/disabled_store.js";
import { callTool } from "../mcp/server.js";
import { toolsForRuntime } from "../mcp/tools/index.js";
import type { ToolContext } from "../mcp/tools/index.js";

export interface CycleResult {
  decision: Decision;
  toolCalls: { name: string; args: unknown }[];
  rawDecisionText: string;
}

export interface RunCycleOptions {
  symbol: string;
  config: Config;
  secrets: Secrets;
  ctx: ToolContext;
  memory: WorkingMemoryStore;
  /** Hard cap on tool-call iterations to keep cycles bounded. */
  maxIterations?: number;
  /** Optional callback for streaming agent steps to the TUI. */
  onStep?: (step: AgentStep) => void;
}

export type AgentStep =
  | { kind: "rag"; hits: number }
  | { kind: "model_response"; content: string }
  | { kind: "tool_call"; name: string; args: unknown }
  | { kind: "tool_result"; name: string; ok: boolean }
  | { kind: "decision"; decision: Decision };

export async function runCycle(opts: RunCycleOptions): Promise<CycleResult> {
  const { symbol, config, secrets, ctx, memory, onStep } = opts;
  const maxIterations = opts.maxIterations ?? config.agent.max_iterations;

  // ---- RAG ----------------------------------------------------------------
  const ragQuery = `Trading context for ${symbol}. Recent decisions and lessons.`;
  const hits = config.features.memory_enabled
    ? await memory.search(ragQuery, 5).catch(() => [])
    : [];
  onStep?.({ kind: "rag", hits: hits.length });

  const ragBlock = !config.features.memory_enabled
    ? "Long-term memory is disabled in config (features.memory_enabled = false)."
    : hits.length === 0
      ? "No prior memories available."
      : hits
          .map((h, i) => `[memory ${i + 1} score=${h.score.toFixed(3)}]\n${h.record.text}`)
          .join("\n\n");

  // ---- Tool catalogue (advertised to the model) ---------------------------
  const tools = toolsForRuntime(config, secrets);
  const toolCatalogue = tools
    .map((t) => `- ${t.name}: ${t.description}\n    args schema: ${JSON.stringify(t.inputSchema)}`)
    .join("\n");

  const sw = config.agent.sentiment_weight;
  const techPct = (1 - sw) * 100;
  const sentPct = sw * 100;
  const blendLine =
    `Signal blend (user-tuned): treat quantitative technical evidence with ~${techPct.toFixed(0)}% weight ` +
    `and qualitative sentiment / news context with ~${sentPct.toFixed(0)}% weight when they conflict. ` +
    `Briefly say which stream you favour in Thought before Final.`;

  const messages: ChatMessage[] = [
    { role: "system", content: config.agent.system_prompt },
    {
      role: "system",
      content: `Available tools:\n${toolCatalogue}\n\nWatchlist: ${config.watchlist.symbols.join(", ")}\nFocus symbol: ${symbol}\nAutotrade: ${config.autotrade.enabled}\nMin confidence to trade: ${config.risk.min_confidence_to_trade}\n${blendLine}\n\n--- Retrieved memories ---\n${ragBlock}`,
    },
    { role: "user", content: `Run one trading cycle for ${symbol} now. Begin with Thought:` },
  ];

  const toolCalls: CycleResult["toolCalls"] = [];

  for (let i = 0; i < maxIterations; i++) {
    const text = await generateAgentTurn(config, secrets, messages, {
      // Stop as soon as the model starts a fresh "user" turn or proposes a
      // second action — keeps the trace tight and predictable.
      stop: ["\nObservation:", "\nUser:", "\nuser:"],
    });
    onStep?.({ kind: "model_response", content: text });
    messages.push({ role: "assistant", content: text });

    const final = parseFinal(text);
    if (final) {
      const decision = validateDecision(final, symbol);
      onStep?.({ kind: "decision", decision });
      return { decision, toolCalls, rawDecisionText: text };
    }

    const action = parseAction(text);
    if (!action) {
      // Reprompt: nudge the model toward the contract instead of giving up.
      messages.push({
        role: "user",
        content:
          "Your last message did not contain `Action:` or `Final:`. Reply with EXACTLY one Action line OR a Final JSON object. Do not add prose.",
      });
      continue;
    }

    onStep?.({ kind: "tool_call", name: action.name, args: action.args });
    toolCalls.push({ name: action.name, args: action.args });

    let resultText: string;
    let ok = true;
    try {
      const result = await callTool(action.name, action.args, ctx, config);
      resultText = JSON.stringify(result);
    } catch (err) {
      ok = false;
      resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    onStep?.({ kind: "tool_result", name: action.name, ok });

    messages.push({
      role: "user",
      content: `Observation: ${truncate(resultText, 6_000)}`,
    });
  }

  // Safety fallback — model never converged.
  const fallback: Decision = {
    action: "hold",
    symbol,
    qty: 0,
    reasoning: `Agent exceeded ${maxIterations} iterations without producing a Final decision.`,
    confidence: 0,
  };
  onStep?.({ kind: "decision", decision: fallback });
  return { decision: fallback, toolCalls, rawDecisionText: "" };
}

// ---------------------------------------------------------------------------
// ReAct parsing
// ---------------------------------------------------------------------------

interface ParsedAction {
  name: string;
  args: unknown;
}

const ACTION_RE = /Action:\s*([A-Za-z0-9_.-]+)\s*\(([\s\S]*?)\)\s*$/m;
const ACTION_JSON_RE = /Action:\s*([A-Za-z0-9_.-]+)\s*(\{[\s\S]*?\})\s*$/m;
const FINAL_RE = /Final:\s*([\s\S]+)$/;

function parseAction(text: string): ParsedAction | null {
  // Form 1: `Action: tool_name({...})` — preferred shape from the system prompt.
  const m1 = text.match(ACTION_RE);
  if (m1) {
    const [, name, body] = m1;
    return { name, args: parseArgs(body) };
  }
  // Form 2: `Action: tool_name {...}` — many models drop the parentheses.
  const m2 = text.match(ACTION_JSON_RE);
  if (m2) {
    const [, name, body] = m2;
    return { name, args: parseArgs(body) };
  }
  return null;
}

function parseArgs(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed || trimmed === "()" || trimmed === "{}") return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models emit single-quoted JSON — try a forgiving fallback.
    try {
      return JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
      return {};
    }
  }
}

function parseFinal(text: string): unknown | null {
  const match = text.match(FINAL_RE);
  const candidate = match ? match[1] : text;
  return extractJsonObject(candidate);
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const slice = fenceMatch ? fenceMatch[1] : trimmed;
  const start = slice.indexOf("{");
  const end = slice.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(slice.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validateDecision(json: unknown, fallbackSymbol: string): Decision {
  const result = DecisionSchema.safeParse(json);
  if (result.success) return result.data;
  return {
    action: "hold",
    symbol: fallbackSymbol,
    qty: 0,
    reasoning: `Decision JSON failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    confidence: 0,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
