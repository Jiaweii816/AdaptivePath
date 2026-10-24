import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";

const workspace = { hasCurrentCode: true, hasAssistantCandidate: false };

function responses(message: string) {
  return compileTurnUnderstandingV2(message, { workspace }).requests.filter(
    (request) => request.kind === "respond",
  );
}

describe("Turn Understanding V2 adversarial boundaries", () => {
  it.each([
    ["我的代码还是报错，为什么这里会失败？", "fix"],
    ["我准备先排序再双指针，这个思路为什么可行？", "understand"],
    ["已经能跑了，有没有更优雅、更省空间的写法？", "improve"],
  ] as const)("applies §4.6 priority: %s", (message, deliverable) => {
    const result = responses(message);
    expect(result).not.toHaveLength(0);
    expect(result.every((request) => request.deliverable === deliverable)).toBe(true);
  });

  it("does not confuse algorithm verbs with execution authorization", () => {
    const understanding = compileTurnUnderstandingV2(
      "这个算法运行时间为什么是 O(n)？",
      { workspace },
    );
    expect(understanding.requests.some(({ kind }) => kind === "execute")).toBe(false);
    expect(understanding.route.escalationReasons).toContain("low_coverage");
  });

  it("lets run_denied veto runner authorization while retaining the response", () => {
    const understanding = compileTurnUnderstandingV2(
      "不要运行我的代码，只解释为什么这个思路可行",
      { workspace },
    );
    expect(understanding.effectDenials).toEqual([
      expect.objectContaining({ effect: "execute" }),
    ]);
    expect(understanding.requests).toEqual([
      expect.objectContaining({ kind: "respond", deliverable: "understand" }),
    ]);
    expect(understanding.route).toEqual({
      kind: "fast_path",
      escalationReasons: [],
    });
  });

  describe("execute denial vetoes every capability branch", () => {
    it.each([
      "不要跑，帮我看看代码哪里错了",
      "别运行，直接说说怎么优化这段",
      "don't run it, just tell me what is wrong with my code",
    ])("keeps runner capabilities closed for: %s", (message) => {
      const understanding = compileTurnUnderstandingV2(message, { workspace });

      expect(understanding.effectDenials).toContainEqual(
        expect.objectContaining({ effect: "execute" }),
      );
      expect(deriveToolEligibilityV2(understanding)).not.toContain(
        "verify_proposed_repair",
      );
      expect(deriveToolEligibilityV2(understanding)).not.toContain("run_current_code");
    });
  });

  it("slow-routes a genuinely ambiguous execution target", () => {
    const understanding = compileTurnUnderstandingV2("运行一下", {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: true },
    });
    expect(understanding.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["effect_ambiguity"],
    });
  });

  it("preserves execute -> fix ordering", () => {
    const understanding = compileTurnUnderstandingV2(
      "先运行我的代码，然后解释为什么失败",
      { workspace },
    );
    expect(understanding.requests).toEqual([
      expect.objectContaining({ kind: "execute", target: "current", dependsOn: [] }),
      expect.objectContaining({ kind: "respond", deliverable: "fix", dependsOn: ["req0"] }),
    ]);
  });

  it("keeps disclosure independent from Delivery", () => {
    const denied = compileTurnUnderstandingV2("不要给完整代码，只给伪代码提示", {
      workspace,
    });
    expect(denied.disclosure).toMatchObject({ ceiling: "guided", source: "explicit_deny" });
    expect(denied.requests).toEqual([
      expect.objectContaining({
        kind: "respond",
        deliverable: "solve",
        delivery: { depth: "hint", form: "pseudocode" },
      }),
    ]);
  });
});
