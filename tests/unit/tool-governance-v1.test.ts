import { describe, expect, it } from "vitest";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { buildTurnCapabilityPolicy } from "@/server/agents/coach-agent/turn-capability-policy";
import { planChatCapabilities } from "@/server/agents/coach-agent/capability-planner";
import { discoverChatCapability } from "@/server/agents/coach-agent/capability-discovery";

function setup(message: string) {
  const understanding = compileTurnUnderstandingV2(message, { workspace: { hasCurrentCode: true, hasAssistantCandidate: false } });
  const policy = buildTurnCapabilityPolicy({
    understanding,
    requestedActions: [],
    message,
    resources: { userId: "u", problemId: "p", chatSessionId: "s", memoryOrigin: "test" },
  });
  return { understanding, policy };
}

describe("tool governance V1", () => {
  it("pins discovery and learning experience while preloading a hint deterministically", () => {
    const { understanding, policy } = setup("给我一点二分提示");
    const plan = planChatCapabilities({ understanding, policy, message: "给我一点二分提示", hasCurrentProblem: true, hasProblemTags: true });
    expect(plan.initialLoadedTools).toEqual(expect.arrayContaining(["discover_capability", "recall_learning_experience", "get_algorithm_hint"]));
    expect(plan.optionalScores.find((item) => item.toolName === "get_algorithm_hint")?.score).toBe(65);
  });

  it("does not let discovery grant current-code execution", () => {
    const { policy } = setup("解释一下这段代码");
    expect(discoverChatCapability({ need: "run the current code to get actual output", policy }).status).toBe("requires_explicit_user_grant");
  });

  it("uses the raw learner phrasing to distinguish solved-history recall from practice", () => {
    const { policy } = setup("Can you connect this to a problem I solved before?");
    expect(
      discoverChatCapability({
        need: "find similar problems I solved previously",
        policy,
      }).matchedCapabilities,
    ).toEqual([
      expect.objectContaining({
        capabilityId: "memory.history.problems.read",
        status: "loaded",
      }),
    ]);
  });

  it.each([
    "给我推荐两道变题",
    "找这题的变式",
    "我想看变形题",
    "看看相关面经",
    "What follow-ups might appear in an interview?",
  ])("loads public interview-variant search for %s", (message) => {
    const { understanding, policy } = setup(message);
    const plan = planChatCapabilities({
      understanding,
      policy,
      message,
      hasCurrentProblem: true,
      hasProblemTags: true,
    });

    expect(plan.initialLoadedTools).toContain("search_interview_variant_candidates");
  });

  it("enforces an explicit history denial during discovery", () => {
    const { policy } = setup("不要查历史，只分析当前代码");
    expect(discoverChatCapability({ need: "check whether I made this kind of mistake before", policy }).status).toBe("policy_denied");
  });

  it("enforces English history and web-search denials before discovery", () => {
    const history = setup("Do not look at my history; explain only the current code.").policy;
    const web = setup("Do not search the web; explain possible variations yourself.").policy;

    expect(history.hardDenies.history).toBe(true);
    expect(
      discoverChatCapability({
        need: "check whether I made this kind of mistake before",
        policy: history,
      }).status,
    ).toBe("policy_denied");
    expect(web.hardDenies.openWorld).toBe(true);
    expect(
      discoverChatCapability({
        need: "find interview variants for this problem",
        policy: web,
      }).status,
    ).toBe("policy_denied");
  });
});
