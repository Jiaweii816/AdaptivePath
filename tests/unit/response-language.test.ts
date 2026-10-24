import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  inferResponseLanguage,
  loadLatestVisibleUserMessageForReview,
} from "@/server/agents/coach-agent/review-pipeline";

describe("coach response language", () => {
  it("binds an English user message to English even with a Chinese profile", () => {
    expect(
      inferResponseLanguage({
        userQuestion: "Could you explain tuple and save it to my knowledge book?",
        explanationStyle: ["Chinese explanation during testing"],
        outputPreferences: ["中文回答"],
      }),
    ).toBe("en");
  });

  it("binds a Chinese user message to Chinese even with an English profile", () => {
    expect(
      inferResponseLanguage({
        userQuestion: "请解释一下 tuple。",
        explanationStyle: ["English explanations"],
        outputPreferences: [],
      }),
    ).toBe("zh");
  });

  it("uses profile language only when no user message is available", () => {
    expect(
      inferResponseLanguage({
        explanationStyle: ["Chinese explanation during testing"],
        outputPreferences: [],
      }),
    ).toBe("zh");
    expect(
      inferResponseLanguage({
        explanationStyle: ["Concise explanations"],
        outputPreferences: [],
      }),
    ).toBe("en");
  });

  it("uses an explicit API language only when no user message is available", () => {
    expect(
      inferResponseLanguage({
        explicit: "zh",
        explanationStyle: [],
        outputPreferences: [],
      }),
    ).toBe("zh");
  });

  it("does not let a stale explicit value override the current user message", () => {
    expect(
      inferResponseLanguage({
        explicit: "zh",
        userQuestion: "This message is English.",
        explanationStyle: [],
        outputPreferences: [],
      }),
    ).toBe("en");
  });

  it("loads only the latest visible user message for review fallback", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "session-1",
      clearedBeforeSequence: 4,
    });
    const findFirst = vi.fn().mockResolvedValue({
      contentMarkdown: "Please review this in English.",
    });
    const db = {
      chatSession: { findUnique },
      chatMessage: { findFirst },
    } as unknown as PrismaClient;

    await expect(
      loadLatestVisibleUserMessageForReview(db, {
        userId: "user-1",
        problemId: "problem-1",
      }),
    ).resolves.toBe("Please review this in English.");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        role: "user",
        memoryOrigin: "test",
        sequence: { gt: 4 },
      },
      orderBy: { sequence: "desc" },
      select: { contentMarkdown: true },
    });
  });
});
