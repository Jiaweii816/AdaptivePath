import Anthropic from "@anthropic-ai/sdk";
import { loadLocalEnv } from "@/lib/env";

/** AdaptivePath Biology coach — Anthropic Messages API. The key comes only from the environment. */
export function createBiologyCoachClient(): Anthropic {
  loadLocalEnv();
  const apiKey = process.env.LLM_BIOLOGY_API_KEY?.trim();
  if (!apiKey) throw new Error("LLM_BIOLOGY_API_KEY is required for the Biology coach LLM provider.");
  return new Anthropic({ apiKey, baseURL: process.env.LLM_BIOLOGY_BASE_URL?.trim() || undefined });
}
