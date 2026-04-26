/**
 * Unified entry for one agent LLM completion — local transformers.js or HF Inference API.
 */

import type { Config, Secrets } from "../config.js";
import { generateChatViaHfApi } from "./hf_api_model.js";
import { generateChat as generateChatLocal, type ChatMessage, type GenerateOptions } from "./local_model.js";

export type { ChatMessage, GenerateOptions } from "./local_model.js";

export async function generateAgentTurn(
  config: Config,
  secrets: Secrets,
  messages: ChatMessage[],
  opts: GenerateOptions = {},
): Promise<string> {
  if (config.model.provider === "huggingface_api") {
    return generateChatViaHfApi(config, secrets, messages, opts);
  }
  return generateChatLocal(config, messages, opts);
}
