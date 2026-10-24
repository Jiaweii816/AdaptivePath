import { describe, expect, it } from "vitest";
import {
  applyCampaignPolicyGuard,
  buildCampaignCoachingPromptBlock,
  deriveCampaignCoachingPolicy,
  projectCampaignMemoryAssembly,
  projectCampaignMemoryBrief,
  type CampaignCoachingContext,
} from "@/server/campaign/coaching";
import { buildResponsePlanV2 } from "@/server/agents/coach-agent/response-policy/response-plan-v2";
import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import type { TurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import type { CoachMemoryAssembly } from "@/server/memory";
import { coachMemoryBrief, teachableMemory } from "../coach-memory-brief-test-helpers";

const noRequests = {
  explicitFullRequest: false,
  explicitHistoryRequest: false,
  explicitProfileRequest: false,
  explicitPatternRequest: false,
};

describe("Campaign coaching policy matrix", () => {
  it("keeps ordinary workbenches on the existing defaults", () => {
    expect(policy(null)).toMatchObject({
      coachingMode: "ordinary",
      defaultDisclosureDepth: "normal",
      effectiveDisclosureCeiling: "guided",
      automaticTechnicalMemoryCueBudget: 2,
      mayProactivelyNameNode: true,
    });
  });

  it.each([
    ["advance", "guided_learning", "normal", 1, true, false, false],
    ["target", "transfer_practice", "hint", 1, true, true, false],
    ["remedial", "targeted_repair", "hint", 1, true, false, true],
    ["probe", "assessment_probe", "hint", 0, false, false, false],
    ["mixed", "interview_mix", "hint", 0, false, false, false],
  ] as const)(
    "projects %s without changing tool authorization",
    (role, mode, depth, memoryBudget, nameNode, transfer, repair) => {
      expect(policy(role)).toMatchObject({
        coachingMode: mode,
        defaultDisclosureDepth: depth,
        automaticTechnicalMemoryCueBudget: memoryBudget,
        mayProactivelyNameNode: nameNode,
        shouldPromptTransfer: transfer,
        shouldFocusRepairCause: repair,
      });
    },
  );

  it.each(["probe", "mixed"] as const)(
    "restores ordinary review behavior after a %s task is settled",
    (role) => {
      expect(policy(role, { settled: true })).toMatchObject({
        coachingMode: "ordinary",
        automaticTechnicalMemoryCueBudget: 2,
        mayProactivelyNameNode: true,
        mayProactivelyNamePattern: true,
      });
    },
  );

  it("honors explicit full, history/profile, and pattern requests without a confirmation state", () => {
    const fullProbe = policy("probe", {
      requests: { ...noRequests, explicitFullRequest: true },
      disclosureCeiling: "full_code",
    });
    expect(fullProbe).toMatchObject({
      effectiveDisclosureCeiling: "full_code",
      explicitDisclosureOverride: true,
      shouldWarnAssessmentContamination: true,
      mayProactivelyNamePattern: true,
    });
    expect(
      policy("probe", {
        requests: { ...noRequests, explicitHistoryRequest: true },
      }).shouldWarnAssessmentContamination,
    ).toBe(true);
    expect(
      policy("probe", {
        requests: { ...noRequests, explicitProfileRequest: true },
      }).shouldWarnAssessmentContamination,
    ).toBe(true);
    expect(
      policy("mixed", {
        requests: { ...noRequests, explicitPatternRequest: true },
      }),
    ).toMatchObject({
      mayProactivelyNameNode: true,
      mayProactivelyNamePattern: true,
    });
  });

  it("produces the same stable fingerprint for the same input and changes it by role/settled state", () => {
    expect(policy("probe").fingerprint).toBe(policy("probe").fingerprint);
    expect(policy("probe").fingerprint).not.toBe(policy("mixed").fingerprint);
    expect(policy("probe").fingerprint).not.toBe(
      policy("probe", { settled: true }).fingerprint,
    );
  });
});

describe("role-aware final memory projection", () => {
  const brief = coachMemoryBrief({
    teachableMemories: [
      teachableMemory({
        kind: "recurring_mistake",
        cue: "Check the boundary before moving the pointer.",
      }),
      teachableMemory({
        kind: "successful_transfer",
        cue: "The learner transferred a monotonic invariant before.",
      }),
    ],
    teachingStrategy: "Ask for one invariant.",
    domainReferences: [
      { title: "Reference", content: "technical", sourceLabel: "Handbook" },
    ],
  });

  it("returns the identical ordinary brief", () => {
    expect(projectCampaignMemoryBrief(brief, policy(null))).toBe(brief);
  });

  it("uses at most one transfer/repair-relevant cue and no extra domain dump", () => {
    const target = projectCampaignMemoryBrief(brief, policy("target"));
    const remedial = projectCampaignMemoryBrief(brief, policy("remedial"));
    expect(target.teachableMemories).toHaveLength(1);
    expect(target.teachableMemories[0]?.kind).toBe("successful_transfer");
    expect(remedial.teachableMemories[0]?.kind).toBe("recurring_mistake");
    expect(target.domainReferences).toEqual([]);
  });

  it.each(["probe", "mixed"] as const)(
    "projects zero automatic technical cues for unsettled %s",
    (role) => {
      const projected = projectCampaignMemoryBrief(brief, policy(role));
      expect(projected.teachableMemories).toEqual([]);
      expect(projected.domainReferences).toEqual([]);
      expect(projected.teachingStrategy).toBeUndefined();
      expect(projected.outputPreferences).toEqual(brief.outputPreferences);
    },
  );

  it("includes policy in a Campaign SessionPlan fingerprint while ordinary stays unchanged", () => {
    const assembly = {
      queryPlan: {} as CoachMemoryAssembly["queryPlan"],
      candidates: [],
      candidateFingerprint: "memory-fingerprint",
      brief,
      decisions: [],
    };
    expect(projectCampaignMemoryAssembly(assembly, policy(null))).toBe(assembly);
    expect(
      projectCampaignMemoryAssembly(assembly, policy("probe"))
        .candidateFingerprint,
    ).not.toBe(assembly.candidateFingerprint);
    expect(
      projectCampaignMemoryAssembly(assembly, policy("probe", { settled: true })),
    ).toBe(assembly);
  });
});

describe("Campaign response plan, prompt, and guard", () => {
  it("adds policy to the existing ResponsePlanV2 without changing objectives", () => {
    const campaignCoaching = context("target");
    const understanding = turnUnderstanding();
    const plan = buildResponsePlanV2(understanding, {
      campaignCoaching,
    } as CoachChatInput);
    expect(plan.objectives).toEqual(understanding.requests);
    expect(plan.campaignPolicy).toBe(campaignCoaching.policy);
  });

  it("renders a compact trusted role block without ids or repair codes", () => {
    const lines = buildCampaignCoachingPromptBlock(
      context("remedial", {
        repairReason: "A recent transfer attempt exposed an unstable condition.",
      }),
    ).join("\n");
    expect(lines).toContain("role: remedial");
    expect(lines).toContain("Trusted repair focus");
    expect(lines).not.toContain("task-item");
    expect(lines).not.toContain("attempt-");
    expect(lines).not.toContain("target_negative");
  });

  it("blocks a complete target implementation for an unsettled probe", () => {
    const result = applyCampaignPolicyGuard({
      reply:
        "```python\nclass Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n```",
      responseLanguage: "zh",
      context: context("probe"),
      problemMethodName: "twoSum",
    });
    expect(result).toMatchObject({
      replaced: true,
      reason: "probe_full_solution",
    });
    expect(result.reply).not.toContain("class Solution");
  });

  it("allows explicit probe full code and deterministically prepends the warning", () => {
    const result = applyCampaignPolicyGuard({
      reply: "```python\nclass Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n```",
      responseLanguage: "zh",
      context: context("probe", {
        policy: policy("probe", {
          requests: { ...noRequests, explicitFullRequest: true },
          disclosureCeiling: "full_code",
        }),
      }),
      problemMethodName: "twoSum",
    });
    expect(result.replaced).toBe(false);
    expect(result.prependedWarning).toBe(true);
    expect(result.reply).toMatch(/^这会降低本次盲区探测的有效性/);
    expect(result.reply).toContain("class Solution");
  });

  it("blocks only exact mixed node labels unless the learner explicitly asks for the pattern", () => {
    const generic = applyCampaignPolicyGuard({
      reply: "这是哈希映射与计数节点。先建表。",
      responseLanguage: "zh",
      context: context("mixed"),
      problemMethodName: "twoSum",
    });
    expect(generic).toMatchObject({
      replaced: true,
      reason: "mixed_node_disclosure",
    });
    const vocabulary = applyCampaignPolicyGuard({
      reply: "可以先考虑哈希表保存已经看过的值。",
      responseLanguage: "zh",
      context: context("mixed"),
      problemMethodName: "twoSum",
    });
    expect(vocabulary.replaced).toBe(false);
    const explicit = applyCampaignPolicyGuard({
      reply: "对，这是哈希映射与计数节点。",
      responseLanguage: "zh",
      context: context("mixed", {
        policy: policy("mixed", {
          requests: { ...noRequests, explicitPatternRequest: true },
        }),
      }),
      problemMethodName: "twoSum",
    });
    expect(explicit.replaced).toBe(false);
  });

  it("does not alter clean ordinary responses", () => {
    expect(
      applyCampaignPolicyGuard({
        reply: "先检查当前条件。",
        responseLanguage: "zh",
        context: null,
        problemMethodName: "twoSum",
      }),
    ).toMatchObject({ replaced: false, prependedWarning: false });
  });
});

function policy(
  role: "advance" | "target" | "remedial" | "probe" | "mixed" | null,
  overrides: {
    settled?: boolean;
    requests?: typeof noRequests;
    disclosureCeiling?: "guided" | "full_code";
  } = {},
) {
  return deriveCampaignCoachingPolicy({
    campaignContext: role
      ? {
          slotRole: role,
          settled: overrides.settled ?? false,
          nodeKind: "transferable",
          nodeNameInternal: "哈希映射与计数",
          nodeLabelAliasesInternal: ["哈希映射与计数", "Hash Mapping and Counting"],
          coreInvariantInternal: "Choose stable keys.",
          ...(role === "remedial"
            ? { repairReason: "Check the unstable update order." }
            : {}),
        }
      : null,
    requests: overrides.requests ?? noRequests,
    disclosureCeiling: overrides.disclosureCeiling ?? "guided",
  });
}

function context(
  role: "advance" | "target" | "remedial" | "probe" | "mixed",
  overrides: Partial<CampaignCoachingContext> = {},
): CampaignCoachingContext {
  return {
    taskItemId: "task-item-1",
    attemptId: "attempt-1",
    slotRole: role,
    settled: false,
    nodeKind: "transferable",
    nodeNameInternal: "哈希映射与计数",
    nodeLabelAliasesInternal: ["哈希映射与计数", "Hash Mapping and Counting"],
    coreInvariantInternal: "Choose stable keys.",
    policy: policy(role),
    ...overrides,
  };
}

function turnUnderstanding(): TurnUnderstandingV2 {
  return {
    schemaVersion: "v2",
    clauses: [{ id: "c0", text: "hint", start: 0, end: 4 }],
    coverage: {
      queryScript: "latin",
      contentUnitCount: 1,
      coveredUnitCount: 1,
      ratio: 1,
      resolution: "trivial",
    },
    requests: [
      {
        id: "r0",
        kind: "respond",
        deliverable: "solve",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "hint", form: "prose" },
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
    ],
    disclosure: { ceiling: "guided", source: "default" },
    categoryDenials: [],
    effectDenials: [],
    languageScope: { supportedLanguage: "python" },
    affect: "none",
    discourse: {
      repeatSignals: [],
      continuationSignals: [],
      referentSignals: [],
    },
    route: { kind: "fast_path", escalationReasons: [] },
  };
}
