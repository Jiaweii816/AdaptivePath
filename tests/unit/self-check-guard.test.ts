import { describe, expect, it } from "vitest";
import { sanitizeSelfCheck } from "@/server/agents/coach-agent/self-check-guard";

const good = {
  question: "棋盘求最少步数为什么用 BFS？蛇/梯子在落点时生效会连锁吗？",
  answer:
    "等权图最短路用 BFS；落点有蛇梯则到达其目的地，只触发一次。\n```py\nfor nxt in range(cur + 1, cur + 7): ...\n```",
};

describe("sanitizeSelfCheck", () => {
  it("keeps a clean method/pattern card", () => {
    expect(sanitizeSelfCheck(good)).toEqual(good);
  });

  it("rejects leaked system or pipeline text", () => {
    expect(
      sanitizeSelfCheck({
        question: good.question,
        answer:
          "Evidence-only review generated because the coach model did not return usable structured JSON.",
      }),
    ).toBeNull();
  });

  it("rejects the banned filler tail", () => {
    expect(
      sanitizeSelfCheck({
        question: "自查：X 里，遇到「Y」时，你应该先检查哪条规则？",
        answer:
          "修正规则：Z。正确思路是先锁定这题的关键决策，再用一个失败用例验证。",
      }),
    ).toBeNull();
  });

  it("rejects raw runner output", () => {
    expect(
      sanitizeSelfCheck({
        question:
          "遇到「Wrong Answer: expected [[1,2]], actual [[3,10],[3,10]]」时？",
        answer: good.answer,
      }),
    ).toBeNull();
  });

  it("rejects runtime error and internal diagnostic tag residue", () => {
    expect(
      sanitizeSelfCheck({
        question: "遇到 KeyError: 0 时应该检查什么？",
        answer: good.answer,
      }),
    ).toBeNull();
    expect(
      sanitizeSelfCheck({
        question: good.question,
        answer: "run_status_runtime_error 表示这次运行失败。",
      }),
    ).toBeNull();
  });

  it("rejects null or empty fields", () => {
    expect(sanitizeSelfCheck(null)).toBeNull();
    expect(sanitizeSelfCheck({ question: " ", answer: good.answer })).toBeNull();
  });
});
