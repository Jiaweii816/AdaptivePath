import { describe, expect, it } from "vitest";
import { campaignCurriculumAssets } from "@/server/campaign/curriculum";
import {
  buildDeepFillCandidates,
  selectDailyTask,
} from "@/server/campaign/core";
import type {
  DailySelectorInput,
  LearnerNodeStateProjection,
  ProblemAvailability,
} from "@/server/campaign/domain";

const now = new Date("2026-08-03T12:00:00.000Z");

function state(
  nodeId: string,
  overrides: Partial<LearnerNodeStateProjection> = {},
): LearnerNodeStateProjection {
  return {
    nodeId,
    exposureState: "unknown",
    masteryState: "learning",
    masteryHealth: "stable",
    unlockedAt: now,
    startedAt: null,
    masteredAt: null,
    masteredBySettlementId: null,
    latestPositiveStreak: 0,
    latestSettlementIds: [],
    ...overrides,
  };
}

function problem(
  slug: string,
  nodeId: string,
  order: number,
  overrides: Partial<ProblemAvailability> = {},
): ProblemAvailability {
  return {
    problemSlug: slug,
    nodeId,
    eligibleRoles: ["advance", "target", "remedial", "probe"],
    recommendedOrder: order,
    exposureType: "never_seen",
    ...overrides,
  };
}

function fixture(overrides: Partial<DailySelectorInput> = {}): DailySelectorInput {
  return {
    campaignId: "campaign-selector",
    campaignDate: "2026-08-03",
    endDate: "2026-09-30",
    budget: 3,
    skeleton: {
      version: 1,
      mixedWindowDays: 7,
      nodePlans: [
        { nodeId: "N1", included: true, order: 1, targetWeek: 1, priority: 50, rationale: "root" },
        { nodeId: "N2", included: true, order: 2, targetWeek: 1, priority: 70, rationale: "root" },
        { nodeId: "N4", included: true, order: 3, targetWeek: 1, priority: 40, rationale: "root" },
      ],
    },
    curriculum: campaignCurriculumAssets,
    learnerNodeStates: [state("N1"), state("N2"), state("N4")],
    repairQueueCandidates: [],
    problemAvailability: [
      problem("n1-a", "N1", 1), problem("n1-b", "N1", 2), problem("n1-c", "N1", 3),
      problem("n2-a", "N2", 1), problem("n2-b", "N2", 2), problem("n2-c", "N2", 3),
      problem("n4-a", "N4", 1), problem("n4-b", "N4", 2),
      problem("nt-a", "N3", 1),
    ],
    ...overrides,
  };
}

describe("daily selector coverage", () => {
  it.each([3, 4, 5, 7])("is deterministic for budget %i", (budget) => {
    const input = fixture({ budget });
    expect(selectDailyTask(input)).toEqual(selectDailyTask(input));
  });

  it("rejects budget below three", () => {
    expect(() => selectDailyTask(fixture({ budget: 2 }))).toThrow(/at least 3/);
  });

  it("prefers started learning, otherwise higher priority transferable frontier", () => {
    expect(selectDailyTask(fixture())).toMatchObject({
      kind: "task",
      phase: "coverage",
      primaryNodeId: "N2",
    });
    const started = selectDailyTask(fixture({
      learnerNodeStates: [state("N1", { startedAt: now }), state("N2"), state("N4")],
    }));
    expect(started).toMatchObject({ primaryNodeId: "N1" });
    if (started.kind === "task") expect(started.items[0].slotRole).toBe("target");
  });

  it("keeps all three positions New on a three-task day, even when repair exists", () => {
    const repair = selectDailyTask(fixture({
      learnerNodeStates: [state("N1", { startedAt: now })],
      repairQueueCandidates: [{ repairQueueItemId: "repair", nodeId: "N1", priority: 100, createdAt: now }],
    }));
    if (repair.kind !== "task") throw new Error("expected task");
    expect(repair.items.map((item) => item.slotRole)).toEqual(["target", "target", "target"]);
    expect(repair.scheduledRepairQueueItemIds).toEqual([]);

    const withoutRepair = selectDailyTask(fixture({ learnerNodeStates: [state("N1", { startedAt: now })] }));
    if (withoutRepair.kind !== "task") throw new Error("expected task");
    expect(withoutRepair.items.map((item) => item.slotRole)).toEqual(["target", "target", "target"]);
  });

  it("uses three New positions, then Baseline and one Recover at a budget of five", () => {
    const result = selectDailyTask(fixture({
      budget: 5,
      learnerNodeStates: [state("N1", { startedAt: now })],
      problemAvailability: [
        problem("n1-a", "N1", 1), problem("n1-b", "N1", 2),
        problem("n1-c", "N1", 3), problem("n1-d", "N1", 4),
        problem("n2-a", "N2", 1), problem("n2-b", "N2", 2),
        problem("probe", "N3", 1, { eligibleRoles: ["probe"] }),
      ],
      repairQueueCandidates: [
        { repairQueueItemId: "repair-1", nodeId: "N1", priority: 100, createdAt: now },
        { repairQueueItemId: "repair-2", nodeId: "N2", priority: 90, createdAt: now },
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.slotRole)).toEqual([
      "target",
      "target",
      "target",
      "probe",
      "remedial",
    ]);
    expect(result.scheduledRepairQueueItemIds).toEqual(["repair-1"]);
  });

  it("lets Recover win the sole auxiliary position at a budget of four", () => {
    const result = selectDailyTask(fixture({
      budget: 4,
      learnerNodeStates: [state("N1", { startedAt: now })],
      problemAvailability: [
        problem("n1-a", "N1", 1), problem("n1-b", "N1", 2), problem("n1-c", "N1", 3),
        problem("recover", "N1", 4, { eligibleRoles: ["remedial"] }),
        problem("baseline", "N3", 1, { eligibleRoles: ["probe"] }),
      ],
      repairQueueCandidates: [{ repairQueueItemId: "repair-1", nodeId: "N1", priority: 100, createdAt: now }],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.slotRole)).toEqual(["target", "target", "target", "remedial"]);
    expect(result.scheduledRepairQueueItemIds).toEqual(["repair-1"]);
  });

  it("falls back from a missing baseline or recovery slot to core learning", () => {
    const result = selectDailyTask(fixture({
      budget: 4,
      learnerNodeStates: [state("N1", { startedAt: now })],
      problemAvailability: [
        problem("n1-a", "N1", 1, { eligibleRoles: ["advance", "target"] }),
        problem("n1-b", "N1", 2, { eligibleRoles: ["target"] }),
        problem("n1-c", "N1", 3, { eligibleRoles: ["target"] }),
        problem("n1-d", "N1", 4, { eligibleRoles: ["target"] }),
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.slotRole)).toEqual(["target", "target", "target", "target"]);
  });

  it("backfills each absent Baseline or Recover slot with New at a budget of five", () => {
    const result = selectDailyTask(fixture({
      budget: 5,
      learnerNodeStates: [state("N1", { startedAt: now })],
      problemAvailability: [
        problem("n1-a", "N1", 1, { eligibleRoles: ["advance", "target"] }),
        problem("n1-b", "N1", 2, { eligibleRoles: ["target"] }),
        problem("n1-c", "N1", 3, { eligibleRoles: ["target"] }),
        problem("n1-d", "N1", 4, { eligibleRoles: ["target"] }),
        problem("n1-e", "N1", 5, { eligibleRoles: ["target"] }),
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.slotRole)).toEqual(["target", "target", "target", "target", "target"]);
  });

  it("places unfinished Baseline and Recover back into their own positions", () => {
    const result = selectDailyTask(fixture({
      budget: 5,
      learnerNodeStates: [state("N1", { startedAt: now })],
      repairQueueCandidates: [{ repairQueueItemId: "repair-1", nodeId: "N1", priority: 100, createdAt: now }],
      carryoverItems: [
        { carryoverFromTaskItemId: "old-new-1", problemSlug: "n1-a", nodeId: "N1", slotRole: "target", exposureType: "never_seen" },
        { carryoverFromTaskItemId: "old-new-2", problemSlug: "n1-b", nodeId: "N1", slotRole: "target", exposureType: "never_seen" },
        { carryoverFromTaskItemId: "old-new-3", problemSlug: "n1-c", nodeId: "N1", slotRole: "target", exposureType: "never_seen" },
        { carryoverFromTaskItemId: "old-baseline", problemSlug: "n4-a", nodeId: "N4", slotRole: "probe", exposureType: "never_seen" },
        { carryoverFromTaskItemId: "old-recover", problemSlug: "n1-d", nodeId: "N1", slotRole: "remedial", exposureType: "never_seen", repairQueueItemId: "repair-1" },
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.slotRole)).toEqual(["target", "target", "target", "probe", "remedial"]);
    expect(result.items.map((item) => item.carryoverFromTaskItemId)).toEqual([
      "old-new-1", "old-new-2", "old-new-3", "old-baseline", "old-recover",
    ]);
  });

  it("respects exposure ordering, role eligibility, cooldown and slug uniqueness", () => {
    const result = selectDailyTask(fixture({
      learnerNodeStates: [state("N1", { startedAt: now })],
      problemAvailability: [
        problem("cooled", "N1", 0, { exposureType: "internally_attempted", cooldownUntil: "2026-08-05" }),
        problem("external", "N1", 1, { exposureType: "externally_seen" }),
        problem("never-b", "N1", 2),
        problem("never-a", "N1", 1),
        problem("probe", "N3", 1, { eligibleRoles: ["probe"] }),
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items[0].problemSlug).toBe("never-a");
    expect(result.items.map((item) => item.problemSlug)).not.toContain("cooled");
    expect(new Set(result.items.map((item) => item.problemSlug)).size).toBe(result.items.length);
  });
});

describe("deep-fill selection", () => {
  const masteredStates = [
    state("N1", { masteryState: "mastered" }),
    state("N2", { masteryState: "mastered" }),
    state("N4", { masteryState: "mastered" }),
  ];

  it("sorts health before never-seen count and never-seen before total size", () => {
    const base = fixture({ learnerNodeStates: masteredStates });
    const health = buildDeepFillCandidates({
      ...base,
      learnerNodeStates: [
        state("N1", { masteryState: "mastered", masteryHealth: "stable" }),
        state("N2", { masteryState: "mastered", masteryHealth: "watch" }),
      ],
      problemAvailability: [
        problem("n1-a", "N1", 1), problem("n1-b", "N1", 2), problem("n1-c", "N1", 3),
        problem("n2-a", "N2", 1), problem("n2-b", "N2", 2), problem("n2-c", "N2", 3),
      ],
    });
    expect(health[0].nodeId).toBe("N2");

    const count = buildDeepFillCandidates({
      ...base,
      learnerNodeStates: masteredStates.slice(0, 2),
      problemAvailability: [
        problem("n1-a", "N1", 1), problem("n1-b", "N1", 2), problem("n1-c", "N1", 3),
        problem("n2-a", "N2", 1), problem("n2-b", "N2", 2),
      ],
    });
    expect(count[0].nodeId).toBe("N1");

    const total = buildDeepFillCandidates({
      ...base,
      learnerNodeStates: masteredStates.slice(0, 2),
      problemAvailability: [
        problem("n1-a", "N1", 1), problem("n1-b", "N1", 2), problem("n1-c", "N1", 3),
        problem("n2-a", "N2", 1), problem("n2-b", "N2", 2), problem("n2-c", "N2", 3),
      ],
    });
    expect(total[0].nodeId).toBe("N2");
  });

  it("uses a mastered transferable primary, then the same fixed slot template", () => {
    const result = selectDailyTask(fixture({
      budget: 4,
      learnerNodeStates: masteredStates,
      repairQueueCandidates: [{ repairQueueItemId: "repair", nodeId: "N1", priority: 90, createdAt: now }],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.phase).toBe("consolidation_deep_fill");
    expect(result.primaryNodeId).not.toBe("N3");
    expect(result.items.slice(0, 3).every((item) => item.nodeId === result.primaryNodeId)).toBe(true);
    expect(result.items.slice(3).map((item) => item.slotRole)).toEqual(["remedial"]);
  });
});

describe("mixed selection", () => {
  function mixedFixture(overrides: Partial<DailySelectorInput> = {}) {
    return fixture({
      endDate: "2026-08-07",
      budget: 4,
      learnerNodeStates: [
        state("N1", { masteryState: "mastered", masteryHealth: "needs_reinforcement" }),
        state("N2", { masteryState: "mastered", masteryHealth: "watch" }),
        state("N4", { masteryState: "mastered", masteryHealth: "stable" }),
      ],
      ...overrides,
    });
  }

  it("has no primary and samples distinct T/NT nodes in priority groups", () => {
    const result = selectDailyTask(mixedFixture());
    if (result.kind !== "task") throw new Error("expected task");
    expect(result).toMatchObject({ phase: "consolidation_mixed", primaryNodeId: null });
    expect(result.items.every((item) => item.slotRole === "mixed")).toBe(true);
    expect(result.items.map((item) => item.nodeId)).toEqual(["N1", "N2", "N4", "N3"]);
    expect(new Set(result.items.map((item) => item.nodeId)).size).toBe(result.items.length);
    expect(new Set(result.items.map((item) => item.problemSlug)).size).toBe(result.items.length);
  });

  it("is reproducible for one seed and can vary by date", () => {
    const candidates = ["N1", "N2", "N4", "N7", "N8"].map((nodeId) =>
      state(nodeId, { masteryState: "mastered", masteryHealth: "stable" }),
    );
    const problems = candidates.map((entry, index) =>
      problem(`mixed-${entry.nodeId}`, entry.nodeId, index + 1),
    );
    const nodePlans = candidates.map((entry, index) => ({
      nodeId: entry.nodeId,
      included: true,
      order: index + 1,
      targetWeek: 1,
      priority: 1,
      rationale: "mixed",
    }));
    const dayOneInput = mixedFixture({ budget: 3, learnerNodeStates: candidates, problemAvailability: problems, skeleton: { version: 4, mixedWindowDays: 7, nodePlans } });
    const first = selectDailyTask(dayOneInput);
    expect(first).toEqual(selectDailyTask(dayOneInput));
    const second = selectDailyTask({ ...dayOneInput, campaignDate: "2026-08-04" });
    if (first.kind !== "task" || second.kind !== "task") throw new Error("expected task");
    expect(first.items.map((item) => item.nodeId)).not.toEqual(second.items.map((item) => item.nodeId));
  });

  it("honors cooldown and reports shortfall without repeating a node", () => {
    const result = selectDailyTask(mixedFixture({
      budget: 5,
      problemAvailability: [
        problem("available", "N1", 1),
        problem("cooled", "N2", 1, { cooldownUntil: "2026-08-05" }),
        problem("nt", "N3", 1),
      ],
    }));
    if (result.kind !== "task") throw new Error("expected task");
    expect(result.items.map((item) => item.problemSlug)).not.toContain("cooled");
    expect(result.shortfall).toMatchObject({ requested: 5, selected: 2, missing: 3 });
    expect(new Set(result.items.map((item) => item.nodeId)).size).toBe(result.items.length);
  });
});
