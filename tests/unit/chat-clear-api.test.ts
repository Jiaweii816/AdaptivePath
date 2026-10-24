import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const clearCoachChatHistory = vi.fn();

vi.mock("@/server/agents/coach-agent/clear-chat-history", () => ({
  clearCoachChatHistory,
}));

describe("coach chat clear API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears by chatSessionId", async () => {
    clearCoachChatHistory.mockResolvedValue({
      ok: true,
      chatSessionId: "session-1",
      clearedBeforeSequence: 5,
      clearedAt: "2026-06-19T10:00:00.000Z",
      hiddenMessageCount: 5,
    });
    const { POST } = await import("../../app/api/coach/chat/clear/route");
    const response = await POST(
      new Request("http://localhost/api/coach/chat/clear", {
        method: "POST",
        body: JSON.stringify({ chatSessionId: "session-1" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      chatSessionId: "session-1",
      clearedBeforeSequence: 5,
      clearedAt: "2026-06-19T10:00:00.000Z",
      hiddenMessageCount: 5,
    });
    expect(clearCoachChatHistory).toHaveBeenCalledWith({
      chatSessionId: "session-1",
    });
  });

  it("clears by problem identity and allows no-op responses", async () => {
    clearCoachChatHistory.mockResolvedValue({
      ok: true,
      chatSessionId: null,
      clearedBeforeSequence: 0,
      clearedAt: null,
      hiddenMessageCount: 0,
    });
    const { POST } = await import("../../app/api/coach/chat/clear/route");
    const response = await POST(
      new Request("http://localhost/api/coach/chat/clear", {
        method: "POST",
        body: JSON.stringify({
          problemId: "problem-1",
          problemSlug: "two-sum",
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      chatSessionId: null,
      clearedBeforeSequence: 0,
      clearedAt: null,
      hiddenMessageCount: 0,
    });
    expect(clearCoachChatHistory).toHaveBeenCalledWith({
      problemId: "problem-1",
      problemSlug: "two-sum",
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("../../app/api/coach/chat/clear/route");
    const response = await POST(
      new Request("http://localhost/api/coach/chat/clear", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Malformed JSON request body.",
    });
    expect(clearCoachChatHistory).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid clear requests", async () => {
    clearCoachChatHistory.mockRejectedValue(new z.ZodError([]));
    const { POST } = await import("../../app/api/coach/chat/clear/route");
    const response = await POST(
      new Request("http://localhost/api/coach/chat/clear", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid clear chat request.",
    });
  });
});
