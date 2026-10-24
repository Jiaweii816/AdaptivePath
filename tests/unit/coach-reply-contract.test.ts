import { describe, expect, it } from "vitest";
import {
  assertCoachReplyContract,
  validateCoachReplyContract,
} from "@/server/agents/coach-agent/coach-reply-contract";

const freeFormReply = [
  "你把进位算了两遍:cur1 分支先更新了 carry,cur2 分支又用 carry*10 想还原。",
  "走一遍 [2,4,9]+[5,6,4,9]:第 3 位 value 变成 3,于是多出一个 3。",
  "最小改法:循环里只算一次 total。改完用同一个用例重跑确认。",
].join("\n");

describe("coach reply contract", () => {
  it("accepts a free-form soft-beat reply", () => {
    expect(validateCoachReplyContract(freeFormReply)).toEqual({ valid: true });
  });

  it("accepts a short reply with no fixed section headings", () => {
    expect(validateCoachReplyContract("一句话根因 + 最小改法。")).toEqual({
      valid: true,
    });
  });

  it("accepts the read-only examiner headings without requiring five sections", () => {
    const examinerReply = [
      "### 评测状态",
      "本地可见测试通过,但不代表官方判定。",
      "### 我作为考官读到的",
      "没读出明确正确性问题。",
      "### 你现在可以怎么做",
      "去 LeetCode 官方评测确认。",
    ].join("\n");

    expect(validateCoachReplyContract(examinerReply)).toEqual({ valid: true });
  });

  it("fails forbidden hidden-test or official-success copy", () => {
    expect(() =>
      assertCoachReplyContract(`${freeFormReply}\nGuaranteed acceptance.`),
    ).toThrow(/forbidden copy/i);
  });

  it("fails an over-length reply", () => {
    expect(validateCoachReplyContract("水".repeat(2000)).valid).toBe(false);
  });

  it("fails an empty reply", () => {
    expect(validateCoachReplyContract("   ").valid).toBe(false);
  });
});
