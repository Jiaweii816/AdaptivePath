import { describe, expect, it } from "vitest";
import {
  campaignCurriculumAssets,
  genericCampaignSkeleton,
} from "@/server/campaign/curriculum";
import {
  computePositiveForMastery,
  buildAdvanceFrontier,
  deriveRepairQueueDecision,
  reduceLearnerNodeState,
  resolveUnlockedNodes,
} from "@/server/campaign/core";
import type {
  LearnerNodeStateProjection,
  SettlementProjection,
} from "@/server/campaign/domain";

const at = (day: number) => new Date(`2026-08-${String(day).padStart(2, "0")}T12:00:00.000Z`);

function state(
  overrides: Partial<LearnerNodeStateProjection> = {},
): LearnerNodeStateProjection {
  return {
    nodeId: "N1",
    exposureState: "unknown",
    masteryState: "learning",
    masteryHealth: "stable",
    unlockedAt: at(1),
    startedAt: null,
    masteredAt: null,
    masteredBySettlementId: null,
    latestPositiveStreak: 0,
    latestSettlementIds: [],
    ...overrides,
  };
}

function settlement(
  id: string,
  slug: string,
  day: number,
  overrides: Partial<SettlementProjection> = {},
): SettlementProjection {
  return {
    settlementId: id,
    problemSlug: slug,
    slotRole: "target",
    positiveForMastery: true,
    negativeOutcome: false,
    settledAt: at(day),
    ...overrides,
  };
}

const eligible = (overrides: Record<string, unknown> = {}) => ({
  reviewCompleted: true,
  passed: true,
  selfRating: "easy",
  evidenceCanVerdict: true,
  evidenceMatchesCurrentRevision: true,
  evidenceMatchesTaskProblem: true,
  evidenceClass: "verdict_bearing",
  evidenceAuthority: "authoritative",
  verdict: "passed_visible_tests",
  codeRevision: "sha256:current",
  ...overrides,
});

describe("settlement eligibility", () => {
  it.each(["easy", "hesitated"])("accepts valid %s evidence", (selfRating) => {
    expect(computePositiveForMastery(eligible({ selfRating }))).toBe(true);
  });

  it.each([
    ["difficult", { selfRating: "struggled" }],
    ["unsolved", { selfRating: "unsolved" }],
    ["missing rating", { selfRating: null }],
    ["failed", { passed: false, verdict: "failed" }],
    ["static", { evidenceCanVerdict: false, evidenceClass: "evidence_unavailable" }],
    ["stale revision", { evidenceMatchesCurrentRevision: false }],
    ["wrong problem", { evidenceMatchesTaskProblem: false }],
    ["invalid rating", { selfRating: "fine" }],
    ["no review", { reviewCompleted: false }],
  ])("rejects %s", (_label, override) => {
    expect(computePositiveForMastery(eligible(override))).toBe(false);
  });

  it("rejects a caller-forged positive flag through the strict input contract", () => {
    expect(computePositiveForMastery({ ...eligible(), positiveForMastery: true })).toBe(false);
  });
});

describe("mastery reducer", () => {
  it("masters on two distinct positives on the same day or across days", () => {
    for (const secondDay of [1, 3]) {
      const reduced = reduceLearnerNodeState({
        currentState: state(),
        settlements: [settlement("a", "remove-element", 1), settlement("b", "rotate-array", secondDay)],
      });
      expect(reduced.state.masteryState).toBe("mastered");
      expect(reduced.state.masteredAt).toEqual(at(secondDay));
      expect(reduced.becameMastered).toBe(true);
    }
  });

  it("does not count a duplicate slug and preserves A+, A+, B+ semantics", () => {
    const duplicates = reduceLearnerNodeState({
      currentState: state(),
      settlements: [settlement("a1", "remove-element", 1), settlement("a2", "remove-element", 2)],
    });
    expect(duplicates.state.masteryState).toBe("learning");
    expect(duplicates.state.latestPositiveStreak).toBe(1);

    const withB = reduceLearnerNodeState({
      currentState: state(),
      settlements: [
        settlement("a1", "remove-element", 1),
        settlement("a2", "remove-element", 2),
        settlement("b", "rotate-array", 3),
      ],
    });
    expect(withB.state.masteredBySettlementId).toBe("b");
  });

  it("clears the learning streak on a negative then rebuilds across eligible roles", () => {
    const reduced = reduceLearnerNodeState({
      currentState: state(),
      settlements: [
        settlement("a", "remove-element", 1, { slotRole: "advance" }),
        settlement("n", "rotate-array", 2, {
          positiveForMastery: false,
          negativeOutcome: true,
        }),
        settlement("b", "product-of-array-except-self", 3, { slotRole: "remedial" }),
        settlement("c", "reverse-words-in-a-string", 4, { slotRole: "probe" }),
      ],
    });
    expect(reduced.state.masteryState).toBe("mastered");
    expect(reduced.state.masteredBySettlementId).toBe("c");
  });

  it("keeps mastered while health moves watch, reinforcement, then stable", () => {
    const mastered = state({
      masteryState: "mastered",
      masteredAt: at(1),
      masteredBySettlementId: "master",
    });
    const base = settlement("master", "remove-element", 1);
    const ordinaryNegative = settlement("n1", "rotate-array", 2, {
      slotRole: "remedial",
      positiveForMastery: false,
      negativeOutcome: true,
    });
    const watch = reduceLearnerNodeState({ currentState: mastered, settlements: [base, ordinaryNegative] });
    expect(watch.state).toMatchObject({ masteryState: "mastered", masteryHealth: "watch", masteredAt: at(1), unlockedAt: at(1) });

    const targetNegative = settlement("n2", "product-of-array-except-self", 3, {
      positiveForMastery: false,
      negativeOutcome: true,
    });
    const needs = reduceLearnerNodeState({ currentState: watch.state, settlements: [base, ordinaryNegative, targetNegative] });
    expect(needs.state.masteryHealth).toBe("needs_reinforcement");
    expect(needs.shouldEnqueueRepair).toBe(true);

    const stable = reduceLearnerNodeState({
      currentState: needs.state,
      settlements: [base, ordinaryNegative, targetNegative, settlement("p", "reverse-words-in-a-string", 4)],
    });
    expect(stable.state.masteryHealth).toBe("stable");
    expect(stable.state.masteryState).toBe("mastered");
  });

  it("enters reinforcement after two ordinary negatives", () => {
    const mastered = state({ masteryState: "mastered", masteredAt: at(1), masteredBySettlementId: "m" });
    const reduced = reduceLearnerNodeState({
      currentState: mastered,
      settlements: [
        settlement("m", "remove-element", 1),
        settlement("n1", "rotate-array", 2, { slotRole: "remedial", positiveForMastery: false, negativeOutcome: true }),
        settlement("n2", "product-of-array-except-self", 3, { slotRole: "advance", positiveForMastery: false, negativeOutcome: true }),
      ],
    });
    expect(reduced.state.masteryHealth).toBe("needs_reinforcement");
  });

  it("lets a transferable mixed positive restore mastered health", () => {
    const mastered = state({
      masteryState: "mastered",
      masteryHealth: "watch",
      masteredAt: at(1),
      masteredBySettlementId: "master",
    });
    const reduced = reduceLearnerNodeState({
      currentState: mastered,
      settlements: [
        settlement("master", "remove-element", 1),
        settlement("mixed-positive", "rotate-array", 2, { slotRole: "mixed" }),
      ],
    });
    expect(reduced.state).toMatchObject({
      masteryState: "mastered",
      masteryHealth: "stable",
      masteredAt: at(1),
    });
  });
});

describe("unlock and repair policies", () => {
  it("uses only the three v2 required edges and preserves prior unlocks", () => {
    const states = genericCampaignSkeleton.nodePlans.map((plan) =>
      state({ nodeId: plan.nodeId, unlockedAt: null }),
    );
    const initial = resolveUnlockedNodes({
      curriculum: campaignCurriculumAssets,
      skeleton: genericCampaignSkeleton,
      nodeStates: states,
    });
    expect(initial.newlyUnlockedNodeIds).toContain("N1");
    expect(initial.newlyUnlockedNodeIds).toContain("N12");
    expect(initial.lockedNodeIds).toEqual(["N13", "N17", "N20"]);

    const withMastery = states.map((entry) =>
      entry.nodeId === "N12"
        ? { ...entry, masteryState: "mastered" as const, masteryHealth: "needs_reinforcement" as const }
        : entry.nodeId === "N13"
          ? { ...entry, unlockedAt: at(1) }
          : entry,
    );
    const resolved = resolveUnlockedNodes({
      curriculum: campaignCurriculumAssets,
      skeleton: genericCampaignSkeleton,
      nodeStates: withMastery,
    });
    expect(resolved.unlockedNodeIds).toContain("N13");
    expect(resolved.unlockedNodeIds).toEqual([...resolved.unlockedNodeIds]);
  });

  it("excludes included=false and ignores recommended/related as blockers", () => {
    const skeleton = {
      ...genericCampaignSkeleton,
      nodePlans: genericCampaignSkeleton.nodePlans.map((plan) =>
        plan.nodeId === "N12" ? { ...plan, included: false } : plan,
      ),
    };
    const resolved = resolveUnlockedNodes({
      curriculum: campaignCurriculumAssets,
      skeleton,
      nodeStates: genericCampaignSkeleton.nodePlans.map((plan) => state({ nodeId: plan.nodeId, unlockedAt: null })),
    });
    expect(resolved.unlockedNodeIds).not.toContain("N12");
    expect(resolved.newlyUnlockedNodeIds).toContain("N7");
  });

  it("enqueues target negatives but never probe negatives", () => {
    const reduction = reduceLearnerNodeState({
      currentState: state(),
      settlements: [settlement("n", "remove-element", 1, { positiveForMastery: false, negativeOutcome: true })],
    });
    expect(deriveRepairQueueDecision({ nodeKind: "transferable", beforeState: state(), reduction, slotRole: "target", positiveForMastery: false, negativeOutcome: true }).enqueue).toBe(true);
    expect(deriveRepairQueueDecision({ nodeKind: "transferable", beforeState: state(), reduction, slotRole: "probe", positiveForMastery: false, negativeOutcome: true }).enqueue).toBe(false);
    expect(deriveRepairQueueDecision({ nodeKind: "transferable", beforeState: state(), reduction, slotRole: "target", positiveForMastery: false, negativeOutcome: false }).enqueue).toBe(false);
  });

  it("keeps NT nodes out of frontier and gives mixed negatives fixed repair reasons", () => {
    const frontier = buildAdvanceFrontier({
      curriculum: campaignCurriculumAssets,
      skeleton: {
        version: 1,
        mixedWindowDays: 7,
        nodePlans: [
          genericCampaignSkeleton.nodePlans[0],
          { ...genericCampaignSkeleton.nodePlans[0], nodeId: "N3", order: 99 },
        ],
      },
      nodeStates: [state(), state({ nodeId: "N3" })],
    });
    expect(frontier.map((entry) => entry.nodeId)).toEqual(["N1"]);
    expect(deriveRepairQueueDecision({
      nodeKind: "non_transferable",
      beforeState: null,
      reduction: null,
      slotRole: "mixed",
      positiveForMastery: false,
      negativeOutcome: true,
    }).reason).toBe("non_transferable_gap");
    expect(deriveRepairQueueDecision({
      nodeKind: "transferable",
      beforeState: state({ masteryState: "mastered" }),
      reduction: null,
      slotRole: "mixed",
      positiveForMastery: false,
      negativeOutcome: true,
    }).reason).toBe("mixed_negative");
  });

  it("treats N9 like every other transferable node without Claim input", () => {
    const reduced = reduceLearnerNodeState({
      currentState: state({ nodeId: "N9" }),
      settlements: [
        settlement("n9-a", "minimum-size-subarray-sum", 1),
        settlement("n9-b", "minimum-window-substring", 2),
      ],
    });
    expect(reduced.state.masteryState).toBe("mastered");
  });
});
