import OpenAI from "openai";
import { loadLocalEnv } from "@/lib/env";
import type { ProviderUsage } from "@/server/llm/trace-context";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-v4";
export const DEFAULT_EMBEDDING_DIM = 1024;

export type EmbedClient = {
  model: string;
  dim: number;
  embed: (texts: string[]) => Promise<number[][]>;
  embedWithUsage?: (texts: string[]) => Promise<{
    vectors: number[][];
    usage?: ProviderUsage | null;
    responseModel?: string | null;
  }>;
};

export function isEmbeddingConfigured(): boolean {
  loadLocalEnv();
  return Boolean(process.env.EMBEDDING_API_KEY?.trim());
}

export function getEmbeddingDim(): number {
  loadLocalEnv();
  const parsed = Number.parseInt(process.env.EMBEDDING_DIM ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMBEDDING_DIM;
}

export function createEmbedClient(): EmbedClient {
  loadLocalEnv();
  const apiKey = process.env.EMBEDDING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("EMBEDDING_API_KEY is required for the embedding provider.");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.EMBEDDING_BASE_URL?.trim() || undefined,
  });
  const model = process.env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dim = getEmbeddingDim();
  const embedWithUsage: EmbedClient["embedWithUsage"] = async (texts) => {
    const response = await client.embeddings.create({
      model,
      input: texts,
      dimensions: dim,
    });

    return {
      vectors: response.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding),
      usage: response.usage ?? null,
      responseModel: (response as { model?: string }).model ?? model,
    };
  };

  return {
    model,
    dim,
    embedWithUsage,
    async embed(texts) {
      return (await embedWithUsage(texts)).vectors;
    },
  };
}

export function createFakeEmbedClient(dim = 8): EmbedClient {
  return {
    model: "fake-embedding",
    dim,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(dim).fill(0);

        for (let i = 0; i < text.length; i += 1) {
          const code = text.charCodeAt(i);
          vector[(code * 31 + i) % dim] += (code % 13) + 1;
        }

        const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
        return vector.map((v) => v / norm);
      });
    },
  };
}
