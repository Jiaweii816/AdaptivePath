import OpenAI from "openai";
import { loadLocalEnv } from "@/lib/env";

function createClient(
  apiKeyVars: string[],
  baseUrlVars: string[],
  label: string,
  options: { maxRetries?: number; timeout?: number } = {},
): OpenAI {
  loadLocalEnv();
  const apiKey = firstConfiguredEnv(apiKeyVars);
  if (!apiKey) {
    throw new Error(
      `${apiKeyVars.join(" or ")} is required for the ${label} LLM provider.`,
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: firstConfiguredEnv(baseUrlVars),
    ...options,
  });
}

/** LLM #1 — diagnoseAndReply — DeepSeek V4 */
export function createReviewClient(): OpenAI {
  return createClient(
    ["LLM_REVIEW_API_KEY", "LLM_CHAT_API_KEY"],
    ["LLM_REVIEW_BASE_URL", "LLM_CHAT_BASE_URL"],
    "review",
    { maxRetries: 0, timeout: 25_000 },
  );
}

/** LLM #2 — chatReply agentic loop — DeepSeek V4 */
export function createChatClient(): OpenAI {
  return createClient(["LLM_CHAT_API_KEY"], ["LLM_CHAT_BASE_URL"], "chat");
}

/** LLM #2b — mock interview foreground turns — DeepSeek V4 */
export function createInterviewClient(): OpenAI {
  return createClient(
    ["LLM_INTERVIEW_API_KEY", "LLM_CHAT_API_KEY"],
    ["LLM_INTERVIEW_BASE_URL", "LLM_CHAT_BASE_URL"],
    "interview",
  );
}

/** LLM #3 — MemoryAgent consolidation/reflection — Qwen3-8B (DashScope) */
export function createMemoryClient(): OpenAI {
  return createClient(
    ["LLM_MEMORY_API_KEY"],
    ["LLM_MEMORY_BASE_URL"],
    "memory",
  );
}

/** Campaign Strategist — one non-streaming structured proposal call. */
export function createStrategistClient(): OpenAI {
  return createClient(
    ["LLM_STRATEGIST_API_KEY", "LLM_CHAT_API_KEY"],
    ["LLM_STRATEGIST_BASE_URL", "LLM_CHAT_BASE_URL"],
    "campaign strategist",
    { maxRetries: 0, timeout: 30_000 },
  );
}

function firstConfiguredEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}
