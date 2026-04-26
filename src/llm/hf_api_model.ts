/**
 * Hugging Face Inference API — chat/text generation for the ReAct agent when
 * config.model.provider === "huggingface_api".
 *
 * Uses `@huggingface/inference` against HF serverless / router. Requires
 * `HF_TOKEN` in the environment (enforced by loadSecrets at startup).
 */

import { HfInference } from "@huggingface/inference";

import type { Config, Secrets } from "../config.js";
import type { ChatMessage, GenerateOptions } from "./local_model.js";

function mergeSystemMessages(messages: ChatMessage[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (m.role === "system" && last?.role === "system") {
      last.content += "\n\n" + content;
    } else {
      out.push({ role: m.role, content });
    }
  }
  return out;
}

function messagesToSinglePrompt(messages: ChatMessage[]): string {
  return mergeSystemMessages(messages)
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join("\n\n");
}

function applyStops(text: string, stops: string[]): string {
  if (stops.length === 0) return text;
  let cut = text.length;
  for (const s of stops) {
    if (!s) continue;
    const idx = text.indexOf(s);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return text.slice(0, cut);
}

/**
 * One assistant turn via Inference API (chat endpoint first, text-generation fallback).
 */
export async function generateChatViaHfApi(
  config: Config,
  secrets: Secrets,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  const token = secrets.HF_TOKEN?.trim();
  if (!token) {
    throw new Error("HF_TOKEN is required for Hugging Face Inference API (model.provider = huggingface_api).");
  }
  const model = config.model.id.trim();
  if (!model) {
    throw new Error("No Hugging Face model id configured. Set model.id in config.toml or Config → Settings → Active local model.");
  }

  const maxTokens = opts.maxNewTokens ?? config.model.max_new_tokens;
  const stop = opts.stop ?? [];
  const hf = new HfInference(token);
  const mapped = mergeSystemMessages(messages);

  try {
    const res = await hf.chatCompletion({
      model,
      messages: mapped.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      temperature: opts.doSample ? 0.7 : 0,
      stop: stop.length ? stop : undefined,
    });
    const text = res.choices?.[0]?.message?.content ?? "";
    return applyStops(typeof text === "string" ? text : "", stop);
  } catch {
    const prompt = messagesToSinglePrompt(messages);
    const out = await hf.textGeneration({
      model,
      inputs: prompt,
      parameters: {
        max_new_tokens: maxTokens,
        return_full_text: false,
        do_sample: opts.doSample ?? false,
        stop,
      },
    });
    const gen = typeof out?.generated_text === "string" ? out.generated_text : "";
    return applyStops(gen, stop);
  }
}
