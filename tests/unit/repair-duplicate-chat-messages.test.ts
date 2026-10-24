import { describe, expect, it } from "vitest";
import { findDuplicateUserMessages } from "@/../scripts/repair-duplicate-chat-messages";

const message = (sequence: number, role: string, contentMarkdown: string) => ({
  id: `m${sequence}`,
  sessionId: "s1",
  sequence,
  role,
  contentMarkdown,
});

describe("findDuplicateUserMessages", () => {
  it("flags the earlier of two adjacent identical user messages", () => {
    const rows = [
      message(1, "user", "跑一下我的代码"),
      message(2, "user", "跑一下我的代码"),
      message(3, "assistant", "好的"),
    ];
    expect(findDuplicateUserMessages(rows).map((row) => row.id)).toEqual(["m1"]);
  });

  it("keeps identical user messages that are not adjacent", () => {
    // 学习者隔了一轮又问了同一句话 —— 这是真实历史，不是 bug 残留。
    const rows = [
      message(1, "user", "跑一下我的代码"),
      message(2, "assistant", "好的"),
      message(3, "user", "跑一下我的代码"),
    ];
    expect(findDuplicateUserMessages(rows)).toEqual([]);
  });

  it("keeps adjacent user messages with different content", () => {
    const rows = [
      message(1, "user", "跑一下我的代码"),
      message(2, "user", "顺便解释一下时间复杂度"),
    ];
    expect(findDuplicateUserMessages(rows)).toEqual([]);
  });
});
