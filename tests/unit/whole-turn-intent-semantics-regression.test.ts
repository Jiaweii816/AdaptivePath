import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import type { RespondTurnRequest } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

const CURRENT_CODE = {
  workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
} as const;

function responses(message: string): RespondTurnRequest[] {
  return compileTurnUnderstandingV2(message, CURRENT_CODE).requests.filter(
    (request): request is RespondTurnRequest => request.kind === "respond",
  );
}

describe("whole-turn new taxonomy regression", () => {
  it("grounds the reported LC128 turn as understand/current with profile basis", () => {
    expect(responses("结合我强项讲解这个题，眼熟但没思路")).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "current",
        basis: ["current_evidence", "learner_profile"],
        delivery: { depth: "normal", form: "prose" },
      }),
    ]);
  });

  it("attaches a profile-only lead-in to the real explanation request", () => {
    expect(
      responses(
        "你能结合我之前的强项，为我讲解一下这个题吗？我感觉很眼熟但是没思路",
      ),
    ).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "current",
        basis: ["current_evidence", "learner_profile"],
      }),
    ]);
  });

  it("classifies API recall as understand/api rather than learner history", () => {
    expect(responses("帮我回忆 Python 切片用法")).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "api",
        basis: ["current_evidence", "api_kb"],
      }),
    ]);
  });

  it("classifies a concrete TypeError as fix/current with API knowledge basis", () => {
    expect(responses("int(w-'a') 报 TypeError")).toEqual([
      expect.objectContaining({
        deliverable: "fix",
        target: "current",
        basis: expect.arrayContaining(["current_evidence", "api_kb"]),
      }),
    ]);
  });

  it("lets a concrete current-line anchor outrank a named concept", () => {
    expect(responses("为什么先检查 need 再放哈希表？只解释这点")).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "current",
        basis: ["current_evidence"],
      }),
    ]);
  });

  it("combines yesterday's problem basis with an API reminder", () => {
    expect(responses("最小栈让我想起昨天用的 heapq，帮我回忆")).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "api",
        basis: expect.arrayContaining(["past_problems", "api_kb"]),
      }),
    ]);
  });

  it("recognizes trace, improve, and current-plan understanding forms", () => {
    expect(responses('带我 walk through case "ccc"，看变量变化')).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        target: "current",
        delivery: expect.objectContaining({ form: "trace" }),
      }),
    ]);
    expect(responses("代码很零碎，有没有优雅写法")).toEqual([
      expect.objectContaining({ deliverable: "improve", target: "current" }),
    ]);
    expect(responses("没有标记访问，怎么防重复选中")).toEqual([
      expect.objectContaining({ deliverable: "understand", target: "current" }),
    ]);
  });

  it("extracts recommendation count without changing its target", () => {
    expect(responses("推荐两道同类题")).toEqual([
      expect.objectContaining({
        deliverable: "recommend",
        target: "current",
        basis: expect.arrayContaining(["practice_catalog"]),
        delivery: { depth: "normal", form: "prose", count: 2 },
      }),
    ]);
  });

  it.each([
    "你能为我推荐其他题目吗？",
    "推荐一些数组题目",
    "有没有别的题可以练？",
    "换一道类似题",
    "接下来做下一题",
    "再来一个进阶练习题",
  ])("recognizes natural Chinese practice recommendation: %s", (message) => {
    expect(responses(message)).toEqual([
      expect.objectContaining({
        deliverable: "recommend",
        target: "current",
        basis: expect.arrayContaining(["practice_catalog"]),
      }),
    ]);
  });

  it.each([
    "找这题的面试变体",
    "给我出两道变题",
    "这题有哪些 follow-up？",
    "Give me two variants of this problem.",
  ])("recognizes variant discovery as a practice recommendation: %s", (message) => {
    expect(responses(message)).toEqual([
      expect.objectContaining({
        deliverable: "recommend",
        target: "current",
        basis: expect.arrayContaining(["practice_catalog"]),
      }),
    ]);
  });

  it("does not mistake an explanation of a known variant for variant discovery", () => {
    expect(responses("这个变体怎么实现？")).not.toEqual([
      expect.objectContaining({ deliverable: "recommend" }),
    ]);
  });

  it.each([
    "你推荐这个题目的解法吗？",
    "推荐这个题目的思路",
    "你推荐哪种算法？",
  ])("does not confuse non-practice recommendations with catalog requests: %s", (message) => {
    expect(responses(message)).not.toEqual([
      expect.objectContaining({ deliverable: "recommend" }),
    ]);
  });

  it("keeps history as Basis when it serves a current solve", () => {
    const result = responses("guidance based on my problem history, help me solve this problem");
    expect(result).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        basis: expect.arrayContaining(["past_problems"]),
      }),
      expect.objectContaining({
        deliverable: "solve",
        target: "current",
        basis: expect.arrayContaining([
          "current_evidence",
          "past_problems",
        ]),
      }),
    ]);
  });

  it("preserves the §6 transfer query as two ordered requests", () => {
    const understanding = compileTurnUnderstandingV2(
      "结合我之前做过的 DP 买股票题，看看当前题和之前几题有何不同，我该如何用共同内核做这题",
      CURRENT_CODE,
    );
    expect(understanding.requests).toEqual([
      expect.objectContaining({
        id: "req0",
        kind: "respond",
        deliverable: "understand",
        target: "concept",
        basis: ["past_problems"],
        dependsOn: [],
      }),
      expect.objectContaining({
        id: "req1",
        kind: "respond",
        deliverable: "solve",
        target: "current",
        basis: expect.arrayContaining(["past_problems"]),
        delivery: expect.objectContaining({ depth: "hint" }),
        dependsOn: ["req0"],
      }),
    ]);
  });

  it("keeps solve plus concept-understanding as a true compound request", () => {
    const result = responses("再给更进一步提示…dp[i] 啥含义");
    expect(result).toEqual([
      expect.objectContaining({
        id: "req0",
        deliverable: "solve",
        target: "current",
        basis: ["current_evidence"],
        delivery: expect.objectContaining({ depth: "hint" }),
        dependsOn: [],
      }),
      expect.objectContaining({
        id: "req1",
        deliverable: "understand",
        target: "concept",
        basis: ["current_evidence"],
        dependsOn: ["req0"],
      }),
    ]);
  });

  it("preserves the complete learner-authored mistake-book content", () => {
    const message = "请收录进错题本，要点：哈希表";
    const understanding = compileTurnUnderstandingV2(message, {
      ...CURRENT_CODE,
      requestedActions: resolveRequestedActions(message),
    });
    expect(understanding.requests).toEqual([
      expect.objectContaining({
        kind: "persist",
        collection: "mistake_book",
        content: message,
      }),
    ]);
  });

  it("stops persist content before a later response request", () => {
    const message = "请收录进错题本，要点：哈希表，然后解释为什么";
    const understanding = compileTurnUnderstandingV2(message, {
      ...CURRENT_CODE,
      requestedActions: resolveRequestedActions(message),
    });
    expect(understanding.requests).toContainEqual(
      expect.objectContaining({
        kind: "persist",
        collection: "mistake_book",
        content: "请收录进错题本，要点：哈希表",
      }),
    );
  });

  it("merges repeated equivalent objectives independent of punctuation", () => {
    expect(
      responses("Diagnose why my current code fails. Diagnose what's wrong with my current code."),
    ).toHaveLength(1);
    expect(responses("解释这个边界；换句话说，说明这个边界为什么成立")).toHaveLength(1);
  });

  it("applies a detached Delivery fragment to the semantic request", () => {
    expect(responses("Explain the invariant. Use pseudocode. Keep it to one example.")).toEqual([
      expect.objectContaining({
        deliverable: "understand",
        delivery: { depth: "normal", form: "pseudocode", count: 1 },
      }),
    ]);
  });

  it("preserves execute -> respond -> persist order and verbatim content", () => {
    const message =
      "Run my current code; then explain the result; then please save the explanation to my knowledge handbook.";
    const understanding = compileTurnUnderstandingV2(message, {
      ...CURRENT_CODE,
      requestedActions: resolveRequestedActions(message),
    });
    expect(understanding.requests).toEqual([
      expect.objectContaining({ kind: "execute", target: "current", dependsOn: [] }),
      expect.objectContaining({ kind: "respond", deliverable: "understand", dependsOn: ["req0"] }),
      expect.objectContaining({
        kind: "persist",
        collection: "knowledge_handbook",
        content: "please save the explanation to my knowledge handbook.",
        dependsOn: ["req0", "req1"],
      }),
    ]);
  });

  describe("basis modifier scope", () => {
    const message = "基于我之前做过的 DP 题，解释 heapq，再推荐两道图题";

    it("does not spray api_kb onto an unrelated recommendation", () => {
      const recommend = responses(message).filter(
        (request) => request.deliverable === "recommend",
      );

      expect(recommend).toHaveLength(1);
      expect(recommend[0]?.basis).not.toContain("api_kb");
    });

    it("does not invent learner_profile without evidence", () => {
      for (const request of responses(message)) {
        expect(request.basis).not.toContain("learner_profile");
      }
    });

    it("still carries past_problems to the transfer target", () => {
      const understand = responses(message).find(
        (request) => request.target === "concept",
      );

      expect(understand?.basis).toContain("past_problems");
    });
  });

  it("preserves an API question before a same-clause handbook save", () => {
    const message = "Python 队列的语法是什么？请保存到知识手册";
    const understanding = compileTurnUnderstandingV2(message, {
      ...CURRENT_CODE,
      requestedActions: resolveRequestedActions(message),
    });

    expect(understanding.requests).toEqual([
      expect.objectContaining({
        kind: "respond",
        deliverable: "understand",
        target: "api",
        basis: expect.arrayContaining(["api_kb"]),
      }),
      expect.objectContaining({
        kind: "persist",
        collection: "knowledge_handbook",
      }),
    ]);
  });

  it("ignores action-looking strings inside protected code", () => {
    const message = "Explain this:\n```python\nlabel='run current code'\nnote='save to knowledge book'\n```";
    const understanding = compileTurnUnderstandingV2(message, CURRENT_CODE);
    expect(understanding.requests.some(({ kind }) => kind !== "respond")).toBe(false);
    expect(resolveRequestedActions(message)).toEqual([]);
  });
});
