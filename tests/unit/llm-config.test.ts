import { afterEach, describe, expect, it, vi } from "vitest";

const envKeys = [
  "LLM_REVIEW_API_KEY",
  "LLM_REVIEW_BASE_URL",
  "LLM_REVIEW_MODEL",
  "LLM_REVIEW_THINKING_MODEL",
  "LLM_CHAT_API_KEY",
  "LLM_CHAT_BASE_URL",
  "LLM_CHAT_MODEL",
  "LLM_CHAT_THINKING_MODEL",
  "LLM_INTERVIEW_API_KEY",
  "LLM_INTERVIEW_BASE_URL",
  "LLM_INTERVIEW_MODEL",
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.resetModules();

  for (const key of envKeys) {
    const value = originalEnv[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("LLM configuration", () => {
  it("lets the review client reuse the chat DeepSeek key and endpoint", async () => {
    process.env.LLM_REVIEW_API_KEY = "";
    process.env.LLM_REVIEW_BASE_URL = "";
    process.env.LLM_CHAT_API_KEY = "shared-deepseek-key";
    process.env.LLM_CHAT_BASE_URL = "https://api.deepseek.com";

    const { createReviewClient } = await import("@/server/llm/client");
    const client = createReviewClient();

    expect(client.apiKey).toBe("shared-deepseek-key");
    expect(client.baseURL).toBe("https://api.deepseek.com");
    expect(client.timeout).toBe(25_000);
    expect(client.maxRetries).toBe(0);
  });

  it("uses DeepSeek V4 Flash as the default foreground model", async () => {
    delete process.env.LLM_REVIEW_MODEL;
    delete process.env.LLM_CHAT_MODEL;
    delete process.env.LLM_INTERVIEW_MODEL;

    const {
      DEFAULT_REVIEW_MODEL,
      DEFAULT_CHAT_MODEL,
      DEFAULT_INTERVIEW_MODEL,
      getReviewModel,
      getChatModel,
      getInterviewModel,
    } = await import("@/server/llm/models");

    expect(DEFAULT_REVIEW_MODEL).toBe("deepseek-v4-flash");
    expect(DEFAULT_CHAT_MODEL).toBe("deepseek-v4-flash");
    expect(DEFAULT_INTERVIEW_MODEL).toBe("deepseek-v4-flash");
    expect(getReviewModel()).toBe("deepseek-v4-flash");
    expect(getChatModel()).toBe("deepseek-v4-flash");
    expect(getInterviewModel()).toBe("deepseek-v4-flash");
  });

  it("lets the review model inherit LLM_CHAT_MODEL", async () => {
    delete process.env.LLM_REVIEW_MODEL;
    process.env.LLM_CHAT_MODEL = "deepseek-v4-flash-custom";

    const { getReviewModel } = await import("@/server/llm/models");

    expect(getReviewModel()).toBe("deepseek-v4-flash-custom");
  });

  it("uses a separate chat thinking model with a DeepSeek V4 Pro default", async () => {
    delete process.env.LLM_CHAT_THINKING_MODEL;

    const { getChatThinkingModel, DEFAULT_CHAT_THINKING_MODEL } = await import(
      "@/server/llm/models"
    );

    expect(DEFAULT_CHAT_THINKING_MODEL).toBe("deepseek-v4-pro");
    expect(getChatThinkingModel()).toBe("deepseek-v4-pro");

    process.env.LLM_CHAT_THINKING_MODEL = "deepseek-v4-pro-custom";

    expect(getChatThinkingModel()).toBe("deepseek-v4-pro-custom");
  });

  it("uses a separate Review thinking model with chat thinking fallback", async () => {
    delete process.env.LLM_REVIEW_THINKING_MODEL;
    delete process.env.LLM_CHAT_THINKING_MODEL;

    const { getReviewThinkingModel, DEFAULT_REVIEW_THINKING_MODEL } =
      await import("@/server/llm/models");

    expect(DEFAULT_REVIEW_THINKING_MODEL).toBe("deepseek-v4-pro");
    expect(getReviewThinkingModel()).toBe("deepseek-v4-pro");

    process.env.LLM_CHAT_THINKING_MODEL = "deepseek-v4-chat-thinking";
    expect(getReviewThinkingModel()).toBe("deepseek-v4-chat-thinking");

    process.env.LLM_REVIEW_THINKING_MODEL = "deepseek-v4-review-thinking";
    expect(getReviewThinkingModel()).toBe("deepseek-v4-review-thinking");
  });

  it("lets the interview client reuse the chat DeepSeek key and endpoint", async () => {
    process.env.LLM_INTERVIEW_API_KEY = "";
    process.env.LLM_INTERVIEW_BASE_URL = "";
    process.env.LLM_CHAT_API_KEY = "shared-deepseek-key";
    process.env.LLM_CHAT_BASE_URL = "https://api.deepseek.com";

    const { createInterviewClient } = await import("@/server/llm/client");
    const client = createInterviewClient();

    expect(client.apiKey).toBe("shared-deepseek-key");
    expect(client.baseURL).toBe("https://api.deepseek.com");
  });

  it("lets the interview model inherit LLM_CHAT_MODEL", async () => {
    delete process.env.LLM_INTERVIEW_MODEL;
    process.env.LLM_CHAT_MODEL = "deepseek-v4-flash-custom";

    const { getInterviewModel } = await import("@/server/llm/models");

    expect(getInterviewModel()).toBe("deepseek-v4-flash-custom");
  });
});
