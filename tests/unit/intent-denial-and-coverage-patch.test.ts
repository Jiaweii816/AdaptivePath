import { describe, expect, it } from "vitest";

import { buildContextPlanV2 } from "@/server/agents/coach-agent/turn-understanding-v2/context-plan-v2";
import { contentUnitsOf } from "@/server/agents/coach-agent/turn-understanding-v2/coverage/content-units";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";

const workspace = { hasCurrentCode: true, hasAssistantCandidate: false };
const compile = (message: string) => compileTurnUnderstandingV2(message, { workspace });

function shapeOf(message: string) {
  const understanding = compile(message);
  return {
    denials: understanding.categoryDenials
      .map((denial) => `${denial.category}:${denial.value}`)
      .sort(),
    basis: [...new Set(understanding.requests.flatMap((request) =>
      request.kind === "respond" ? request.basis : [],
    ))].sort(),
  };
}

describe("P0 denial scope does not spill onto unrelated axes", () => {
  it.each(["不要运行我的代码，只解释思路", "别跑我的代码", "不要保存我的代码"])(
    "never denies the target axis: %s",
    (message) => {
      expect(compile(message).categoryDenials).not.toContainEqual(
        expect.objectContaining({ category: "target" }),
      );
    },
  );

  it("still denies the effect the learner actually refused", () => {
    expect(compile("不要运行我的代码，只解释思路").categoryDenials).toContainEqual(
      expect.objectContaining({ category: "effect", value: "execute" }),
    );
  });
});

describe("P1 a denied basis closes the context, not only the tools", () => {
  it.each([
    "别看我以前做过的题",
    "不要查我以前犯过的错",
    "不要查我以前犯过的错，直接解释当前边界",
  ])("keeps learner history out of the prompt: %s", (message) => {
    const understanding = compile(message);
    const tools = deriveToolEligibilityV2(understanding);
    expect(understanding.categoryDenials.length).toBeGreaterThan(0);
    expect(tools).not.toContain("past_mistake_recall");
    expect(tools).not.toContain("past_problem_recall");
    expect(tools).not.toContain("recall_learning_experience");
    expect(buildContextPlanV2(understanding).episodes).toBe(false);
    for (const request of understanding.requests) {
      if (request.kind !== "respond") continue;
      expect(request.basis).not.toContain("past_mistakes");
      expect(request.basis).not.toContain("past_problems");
    }
  });

  it("drops a recall request that lost the history it asked for", () => {
    const requests = compile("不要查我以前犯过的错，直接解释当前边界").requests;
    expect(requests.some((request) =>
      request.kind === "respond" && request.deliverable === "recall",
    )).toBe(false);
    expect(requests.some((request) =>
      request.kind === "respond" && request.deliverable === "understand",
    )).toBe(true);
  });

  it("still injects history when nothing denies it", () => {
    expect(buildContextPlanV2(compile("我以前是不是也栽在这种边界上？")).episodes).toBe(true);
  });

  it("keeps the learner's own code when only execution is denied", () => {
    expect(buildContextPlanV2(compile("不要运行我的代码，只解释思路")).currentCode).toBe(true);
  });
});

describe("P2 coverage does not under-score an understood turn", () => {
  it.each([
    "don't run it, just tell me what is wrong with my code",
    "不要运行我的代码，只解释思路",
  ])("counts an explicit denial as understood: %s", (message) => {
    expect(compile(message).coverage.resolution).toBe("resolved");
  });

  it("does not treat an interrogative as a function word", () => {
    expect(compile("为什么这里会越界").coverage.coveredUnitCount).toBeGreaterThan(0);
  });

  it("keeps an english contraction as one unit", () => {
    expect(contentUnitsOf("don't run it")).toHaveLength(2);
  });
});

describe("P3 bilingual symmetry", () => {
  it.each([
    ["查一下我以前犯过的错", "check my past mistakes"],
    ["别看我以前犯过的错", "don't look at my past mistakes"],
    ["看看我之前做过的类似题", "show my past problems"],
    ["别翻我以前做过的题", "don't look at my past problems"],
  ] as const)("compiles the same shape for %s / %s", (han, latin) => {
    expect(shapeOf(latin)).toEqual(shapeOf(han));
  });
});
