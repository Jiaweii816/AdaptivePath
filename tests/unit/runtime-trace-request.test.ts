import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRequestSchema } from "@/server/agents/coach-agent/chat-reply";
import { reviewRequestSchema } from "@/server/agents/coach-agent/review-pipeline";
import { practiceRunRequestSchema } from "@/server/workbench/practice-run";
import { isTraceStoreCutoverEnabled } from "@/server/observability/runtime-trace-request";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtime trace action request contract", () => {
  it("keeps the completed trace-store cutover active", () => {
    expect(isTraceStoreCutoverEnabled()).toBe(true);
    expect(reviewRequestSchema.safeParse(reviewInput()).success).toBe(false);
    expect(chatRequestSchema.safeParse(chatInput()).success).toBe(false);
    expect(practiceRunRequestSchema.safeParse(practiceInput()).success).toBe(false);
  });

  it("requires browser and client clock context on all three paths when opted in", () => {
    for (const result of [
      reviewRequestSchema.safeParse(reviewInput()),
      chatRequestSchema.safeParse(chatInput()),
      practiceRunRequestSchema.safeParse(practiceInput()),
    ]) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
          expect.arrayContaining(["browserInstanceId", "clientOccurredAt"]),
        );
      }
    }
  });

  it("accepts the same trace action context on Review, Chat, and Practice Run", () => {
    const trace = {
      browserInstanceId: "tab-runtime-trace-123",
      clientOccurredAt: "2026-07-12T18:00:00.000Z",
    };

    expect(reviewRequestSchema.parse({ ...reviewInput(), ...trace })).toMatchObject(trace);
    expect(chatRequestSchema.parse({ ...chatInput(), ...trace })).toMatchObject(trace);
    expect(practiceRunRequestSchema.parse({ ...practiceInput(), ...trace })).toMatchObject(trace);
    expect(isTraceStoreCutoverEnabled()).toBe(true);
  });

  it("rejects malformed client timestamps", () => {
    expect(
      reviewRequestSchema.safeParse({
        ...reviewInput(),
        browserInstanceId: "tab-runtime-trace-123",
        clientOccurredAt: "yesterday",
      }).success,
    ).toBe(false);
  });
});

function reviewInput() {
  return {
    problemId: "problem-1",
    language: "Python",
    code: "class Solution: pass",
    selectedTestCaseIds: [],
  };
}

function chatInput() {
  return {
    problemId: "problem-1",
    message: "给我一个提示",
    language: "Python",
    code: "class Solution: pass",
    selectedTestCaseIds: [],
  };
}

function practiceInput() {
  return {
    problemId: "problem-1",
    language: "Python",
    code: "class Solution: pass",
    selectedTestCaseIds: [],
  };
}
