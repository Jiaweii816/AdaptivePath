import { describe, expect, it } from "vitest";
import {
  bucketByRecency,
  type ChatHistorySession,
} from "@/features/chat-history/chat-history-data";

const base: Omit<ChatHistorySession, "id" | "createdAt" | "updatedAt"> = {
  title: "T",
  primaryLanguage: "Python",
  problem: {
    id: "p",
    slug: "s",
    title: "T",
    leetcodeNumber: 1,
    difficulty: "Easy",
  },
  problemHistoryHref: null,
  replay: [],
  messageCount: 0,
  status: "in_progress",
};

function session(id: string, updatedAt: Date): ChatHistorySession {
  return { ...base, id, createdAt: updatedAt, updatedAt };
}

describe("chat history recency buckets", () => {
  it("groups sessions into Today / Yesterday / This Week / Earlier", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    const sessions = [
      session("today", new Date("2026-06-10T09:00:00Z")),
      session("yest", new Date("2026-06-09T09:00:00Z")),
      session("week", new Date("2026-06-06T09:00:00Z")),
      session("old", new Date("2026-05-01T09:00:00Z")),
    ];
    const buckets = bucketByRecency(sessions, now);
    expect(buckets.map((b) => b.label)).toEqual([
      "Today",
      "Yesterday",
      "This Week",
      "Earlier",
    ]);
    expect(buckets[0].sessions[0].id).toBe("today");
    expect(buckets[3].sessions[0].id).toBe("old");
  });

  it("omits empty buckets", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    const buckets = bucketByRecency(
      [session("today", new Date("2026-06-10T08:00:00Z"))],
      now,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("Today");
  });
});
