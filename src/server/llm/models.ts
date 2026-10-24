import { loadLocalEnv } from "@/lib/env";

export const DEFAULT_REVIEW_MODEL = "deepseek-v4-flash";
export const DEFAULT_CHAT_MODEL = "deepseek-v4-flash";
export const DEFAULT_CHAT_THINKING_MODEL = "deepseek-v4-pro";
export const DEFAULT_REVIEW_THINKING_MODEL = DEFAULT_CHAT_THINKING_MODEL;
export const DEFAULT_INTERVIEW_MODEL = "deepseek-v4-flash";
export const DEFAULT_MEMORY_MODEL = "qwen3-8b";
/** Small non-thinking Qwen model with DashScope strict JSON Schema support. */
export const DEFAULT_CHAT_ASSEMBLER_MODEL = "qwen3.8-flash";
export const DEFAULT_STRATEGIST_MODEL = DEFAULT_CHAT_THINKING_MODEL;

/** LLM #1 — diagnoseAndReply — DeepSeek V4 Flash */
export function getReviewModel(): string {
  loadLocalEnv();
  return (
    process.env.LLM_REVIEW_MODEL ||
    process.env.LLM_CHAT_MODEL ||
    DEFAULT_REVIEW_MODEL
  );
}

/** LLM #1a — failed Review/static diagnosis — DeepSeek V4 Pro thinking */
export function getReviewThinkingModel(): string {
  loadLocalEnv();
  return (
    process.env.LLM_REVIEW_THINKING_MODEL ||
    process.env.LLM_CHAT_THINKING_MODEL ||
    DEFAULT_REVIEW_THINKING_MODEL
  );
}

/** LLM #2 — chatReply agentic loop — DeepSeek V4 Flash */
export function getChatModel(): string {
  loadLocalEnv();
  return process.env.LLM_CHAT_MODEL || DEFAULT_CHAT_MODEL;
}

/** LLM #2a — chat walkthrough deep reasoning — DeepSeek V4 Pro thinking */
export function getChatThinkingModel(): string {
  loadLocalEnv();
  return process.env.LLM_CHAT_THINKING_MODEL || DEFAULT_CHAT_THINKING_MODEL;
}

/** LLM #2b — mock interview foreground turns — DeepSeek V4 Flash */
export function getInterviewModel(): string {
  loadLocalEnv();
  return (
    process.env.LLM_INTERVIEW_MODEL ||
    process.env.LLM_CHAT_MODEL ||
    DEFAULT_INTERVIEW_MODEL
  );
}

/** LLM #3 — MemoryAgent consolidation/reflection — Qwen3-8B */
export function getMemoryModel(): string {
  loadLocalEnv();
  return process.env.LLM_MEMORY_MODEL || DEFAULT_MEMORY_MODEL;
}

/**
 * Semantic assembly is a tiny typed classification task, not MemoryAgent
 * consolidation. Keep its model independently configurable so strict-output
 * support never silently changes the background MemoryAgent model.
 */
export function getChatAssemblerModel(): string {
  loadLocalEnv();
  return process.env.LLM_CHAT_ASSEMBLER_MODEL || DEFAULT_CHAT_ASSEMBLER_MODEL;
}

/** Campaign Strategist — single structured planning call. */
export function getStrategistModel(): string {
  loadLocalEnv();
  return process.env.LLM_STRATEGIST_MODEL || DEFAULT_STRATEGIST_MODEL;
}
