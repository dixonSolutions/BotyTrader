/**
 * Gemini Embedding API client.
 *
 * Single-responsibility wrapper around the Google Generative AI SDK.
 * Returns a dense vector for any input string.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface Embedder {
  embed(text: string): Promise<number[]>;
  dimensions(): number | null;
}

export interface EmbedderOptions {
  apiKey: string;
  model: string;
}

export class GeminiEmbedder implements Embedder {
  private readonly client: GoogleGenerativeAI;
  private readonly modelId: string;
  private dim: number | null = null;

  constructor(opts: EmbedderOptions) {
    this.client = new GoogleGenerativeAI(opts.apiKey);
    this.modelId = opts.model;
  }

  async embed(text: string): Promise<number[]> {
    const model = this.client.getGenerativeModel({ model: this.modelId });
    const result = await model.embedContent(text);
    const values = result.embedding.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Gemini embedding returned an empty vector.");
    }
    if (this.dim === null) this.dim = values.length;
    return values;
  }

  dimensions(): number | null {
    return this.dim;
  }
}
