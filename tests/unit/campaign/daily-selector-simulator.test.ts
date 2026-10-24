import { describe, expect, it } from "vitest";
import { campaignCurriculumAssets } from "@/server/campaign/curriculum";
import {
  projectNextDailyTask,
  simulateCampaignPlan,
} from "@/server/campaign/core";
import type {
  CampaignPlanSimulationCandidate,
  CampaignSimulationState,
  ExistingDailyTask,
  SerializableLearnerNodeState,
  SerializableProblemAvailability,
  SkeletonProjection,
} from "@/server/campaign/domain";

const startDate = "2026-08-03";

function nodeState(
  nodeId: string,
  overrides: Partial<SerializableLearnerNodeState> = {},
): SerializableLearnerNodeState {
  return {
    nodeId,
    exposureState: "unknown",
    masteryState: "learning",
    masteryHealth: "stable",
    unlockedAt: `${startDate}T00:00:00.000Z`,
    startedAt: null,
    masteredAt: null,
    masteredBySettlementId: null,
    latestPositiveStreak: 0,
    latestSettlementIds: [],
    ...overrides,
  };
}

function problem(
  problemSlug: string,
  nodeId: string,
  recommendedOrder: number,
  overrides: Partial<SerializableProblemAvailability> = {},
): SerializableProblemAvailability {
  return {
    problemSlug,
    nodeId,
    eligibleRoles: ["advance", "target", "remedial"],
    recommendedOrder,
    exposureType: "never_seen",
    cooldownUntil: null,
    lastAttemptedAt: null,
    ...overrides,
  };
}

const requiredEdgeSkeleton: SkeletonProjection = {
  version: 1,
  mixedWindowDays: 7,
  nodePlans: [
    {
      nodeId: "N15",
      included: true,
      order: 1,
      targetWeek: 1,
      priority: 100,
      rationale: "required predecessor",
    },
    {
      nodeId: "N17",
      included: true,
      order: 2,
      targetWeek: 1,
      priority: 90,
      rationale: "required successor",
    },
  ],
};

function simulationState(
  overrides: Partial<CampaignSimulationState> = {},
): CampaignSimulationState {
  return {
    campaignId: "campaign-simulator",
    endDate: "2026-09-30",
    curriculum: campaignCurriculumAssets,
    learnerNodeStates: [
      nodeState("N15"),
      nodeState("N17", { unlockedAt: null }),
    ],
    repairQueueCandidates: [],
    problemAvailability: [
      problem("number-of-islands", "N15", 1),
      problem("surrounded-regions", "N15", 2),
      problem("word-search", "N15", 3, { eligibleRoles: ["target", "remedial"] }),
      problem("word-search-ii", "N15", 4, { eligibleRoles: ["remedial"] }),
      problem("clone-graph", "N17", 1),
      problem("evaluate-division", "N17", 2),
      problem("course-schedule", "N17", 3, { eligibleRoles: ["target", "remedial"] }),
      problem("spiral-matrix", "N3", 1, { eligibleRoles: ["probe", "remedial"] }),
    ],
    existingDailyTasks: [],
    settlements: [],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<CampaignPlanSimulationCandidate> = {},
): CampaignPlanSimulationCandidate {
  return {
    candidateId: "required-edge-route",
    skeleton: requiredEdgeSkeleton,
    ...overrides,
  };
}

function simulate(
  state: CampaignSimulationState = simulationState(),
  overrides: Partial<Parameters<typeof simulateCampaignPlan>[0]> = {},
) {
  return simulateCampaignPlan({
    state,
    candidates: [candidate()],
    startCampaignDate: startDate,
    horizon: 2,
    dailyBudgets: [3, 3],
    observedPace: {
      sampleDays: 4,
      observedCapacityRange: { min: 3, max: 3 },
      supportedPositiveItemsByDate: [
        { campaignDate: "2026-08-03", positiveItemCount: 2 },
        { campaignDate: "2026-08-04", positiveItemCount: 0 },
      ],
    },
    options: { selectorVersion: 1, internalCooldownDays: 7 },
    ...overrides,
  });
}

describe("shared Daily Selector projection kernel", () => {
  it("matches the Simulator first-day projection exactly", () => {
    const state = simulationState();
    const route = candidate();
    const direct = projectNextDailyTask(state, route.skeleton, 3, startDate, {
      selectorVersion: 1,
    });
    const result = simulate(state, { candidates: [route] });

    expect(
      result.candidates[0].branches.optimistic.internalDayProjections[0].projection,
    ).toEqual(direct);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it.each([
    ["consolidation_deep_fill", "2026-09-30", "never_seen"],
    ["consolidation_mixed", "2026-08-04", "externally_seen"],
  ] as const)("keeps %s projection parity", (expectedPhase, endDate, exposureType) => {
    const state = simulationState({
      endDate,
      learnerNodeStates: [
        nodeState("N15", {
          masteryState: "mastered",
          masteredAt: "2026-08-02T00:00:00.000Z",
        }),
        nodeState("N17", {
          masteryState: "mastered",
          masteredAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
      problemAvailability: simulationState().problemAvailability.map((entry) => ({
        ...entry,
        exposureType,
      })),
    });
    const route = candidate();
    const direct = projectNextDailyTask(state, route.skeleton, 3, startDate, {
      selectorVersion: 1,
    });
    const firstDay = simulate(state, {
      candidates: [route],
      horizon: 1,
      dailyBudgets: [3],
    }).candidates[0].branches.optimistic.internalDayProjections[0].projection;

    expect(firstDay).toEqual(direct);
    expect(firstDay).toMatchObject({ kind: "task", phase: expectedPhase });
    if (expectedPhase === "consolidation_mixed" && firstDay.kind === "task") {
      expect(firstDay.primaryNodeId).toBeNull();
      expect(new Set(firstDay.items.map((item) => item.nodeId)).size).toBe(
        firstDay.items.length,
      );
    }
  });

  it("returns an existing DailyTask unchanged even when the candidate route changes", () => {
    const existing: ExistingDailyTask = {
      campaignDate: startDate,
      phase: "coverage",
      budget: 3,
      primaryNodeId: "N15",
      items: [
        {
          problemSlug: "persisted-a",
          nodeId: "N15",
          slotRole: "advance",
          exposureType: "never_seen",
          order: 1,
        },
        {
          problemSlug: "persisted-b",
          nodeId: "N15",
          slotRole: "target",
          exposureType: "never_seen",
          order: 2,
        },
      ],
      scheduledRepairQueueItemIds: [],
      shortfall: { requested: 3, selected: 2, missing: 1, reasons: ["persisted"] },
    };
    const state = simulationState({ existingDailyTasks: [existing] });
    const changedRoute = candidate({
      candidateId: "changed-route",
      skeleton: {
        ...requiredEdgeSkeleton,
        version: 2,
        nodePlans: requiredEdgeSkeleton.nodePlans.map((plan) => ({
          ...plan,
          priority: plan.nodeId === "N17" ? 999 : 1,
        })),
      },
    });
    const before = JSON.parse(JSON.stringify(state));
    const firstDay = simulate(state, {
      candidates: [changedRoute],
    }).candidates[0].branches.optimistic.internalDayProjections[0].projection;

    expect(firstDay).toEqual({ kind: "task", ...existing, reusedExisting: true });
    expect(state).toEqual(before);
  });

  it("uses one shared accepted date override for direct and simulated projection", () => {
    const state = simulationState({
      acceptedDailyBudgetOverrides: [{
        campaignDate: startDate,
        maxQuestions: 4,
        status: "accepted",
        expiresAt: null,
      }],
    });
    const route = candidate();
    const direct = projectNextDailyTask(state, route.skeleton, 3, startDate, {
      selectorVersion: 1,
    });
    const simulated = simulate(state, {
      candidates: [route],
      horizon: 1,
      dailyBudgets: [3],
    });
    expect(direct).toMatchObject({ kind: "task", budget: 4 });
    expect(simulated.dailyBudgets).toEqual([{ campaignDate: startDate, budget: 4 }]);
    expect(simulated.candidates[0].branches.optimistic.internalDayProjections[0].projection)
      .toEqual(direct);
  });

  it("projects at most one unsettled exposure probe and restores mastery eligibility", () => {
    const exposureSkeleton: SkeletonProjection = {
      version: 2,
      mixedWindowDays: 7,
      nodePlans: [{
        nodeId: "N20",
        included: true,
        order: 1,
        targetWeek: 1,
        goalDepth: "exposure",
        targetByDate: "2026-08-20",
        priority: 100,
        rationale: "one exposure probe",
      }],
    };
    const state = simulationState({
      learnerNodeStates: [nodeState("N20")],
      problemAvailability: [
        problem("edit-distance", "N20", 1, { eligibleRoles: ["advance", "target", "probe"] }),
        problem("interleaving-string", "N20", 2, { eligibleRoles: ["advance", "target", "probe"] }),
      ],
      exposurePlanning: {
        skeletonVersion: 2,
        satisfiedNodeIds: [],
        pendingProbeNodeIds: [],
      },
    });
    const result = simulate(state, {
      candidates: [{ candidateId: "exposure", skeleton: exposureSkeleton }],
      observedPace: {
        sampleDays: 4,
        observedCapacityRange: { min: 0, max: 3 },
        supportedPositiveItemsByDate: [
          { campaignDate: startDate, positiveItemCount: 0 },
          { campaignDate: "2026-08-04", positiveItemCount: 0 },
        ],
      },
    });
    const optimisticDays = result.candidates[0].branches.optimistic.internalDayProjections;
    const observedDays = result.candidates[0].branches.observed_supported.internalDayProjections;
    expect(optimisticDays[0].projection).toMatchObject({
      kind: "task",
      items: [expect.objectContaining({ nodeId: "N20", slotRole: "probe" })],
    });
    expect(optimisticDays[0].projection).toEqual(projectNextDailyTask(
      state,
      exposureSkeleton,
      3,
      startDate,
      { selectorVersion: 1 },
    ));
    for (const secondDay of [optimisticDays[1], observedDays[1]]) {
      expect(secondDay.projection.kind === "task"
        ? secondDay.projection.items.some((item) => item.nodeId === "N20")
        : false).toBe(false);
    }

    const masteryProjection = projectNextDailyTask(
      state,
      {
        ...exposureSkeleton,
        version: 3,
        nodePlans: exposureSkeleton.nodePlans.map((plan) => ({ ...plan, goalDepth: "mastery" })),
      },
      3,
      startDate,
      { selectorVersion: 1 },
    );
    expect(masteryProjection).toMatchObject({ kind: "task", primaryNodeId: "N20" });
  });
});

describe("deterministic Campaign simulation", () => {
  it("defers a newly unlocked successor until the next campaign date", () => {
    const result = simulate();
    const optimistic = result.candidates[0].branches.optimistic;
    const dayOne = optimistic.internalDayProjections[0];
    const dayTwo = optimistic.internalDayProjections[1];
    const n17 = optimistic.earliestReachableDates.find((entry) => entry.nodeId === "N17");

    expect(dayOne.projection.kind).toBe("task");
    if (dayOne.projection.kind !== "task") throw new Error("expected task");
    expect(dayOne.projection.items.map((item) => item.nodeId)).not.toContain("N17");
    expect(dayOne.newlyMasteredNodeIds).toContain("N15");
    expect(dayOne.newlyUnlockedNodeIds).toContain("N17");
    expect(n17).toEqual({
      nodeId: "N17",
      earliestEligibleDate: "2026-08-04",
      firstSelectedDate: "2026-08-04",
    });
    expect(dayTwo.projection).toMatchObject({ kind: "task", primaryNodeId: "N17" });
    expect(optimistic.violations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "same_day_unlock_violation" })]),
    );
  });

  it("keeps optimistic, observed-supported, and conservative branches distinct", () => {
    const branches = simulate(simulationState(), { dailyBudgets: [3, 4] }).candidates[0].branches;
    const optimisticN17 = branches.optimistic.earliestReachableDates.find(
      (entry) => entry.nodeId === "N17",
    );
    const observedN17 = branches.observed_supported.earliestReachableDates.find(
      (entry) => entry.nodeId === "N17",
    );
    const conservativeN17 = branches.conservative.earliestReachableDates.find(
      (entry) => entry.nodeId === "N17",
    );

    expect(optimisticN17?.earliestEligibleDate).toBe("2026-08-04");
    expect(observedN17?.earliestEligibleDate).toBe("2026-08-04");
    expect(conservativeN17?.earliestEligibleDate).toBeNull();
    expect(
      branches.conservative.internalDayProjections[1].projection,
    ).toMatchObject({ kind: "task", primaryNodeId: "N15" });
    const conservativeDayTwo = branches.conservative.internalDayProjections[1].projection;
    if (conservativeDayTwo.kind !== "task") throw new Error("expected task");
    expect(conservativeDayTwo.items.map((item) => item.slotRole)).toContain("remedial");
    expect(conservativeDayTwo.scheduledRepairQueueItemIds).not.toHaveLength(0);
  });

  it("does not select cooldown or role-ineligible supply and reports shortfall", () => {
    const state = simulationState({
      problemAvailability: [
        problem("available", "N15", 1),
        problem("cooldown", "N15", 2, { cooldownUntil: "2026-08-05" }),
        problem("wrong-role", "N15", 3, { eligibleRoles: ["remedial"] }),
      ],
    });
    const day = simulate(state, {
      horizon: 1,
      dailyBudgets: [3],
    }).candidates[0].branches.optimistic.internalDayProjections[0];

    if (day.projection.kind !== "task") throw new Error("expected task");
    expect(day.projection.items.map((item) => item.problemSlug)).toEqual(["available"]);
    expect(day.projection.items.map((item) => item.problemSlug)).not.toContain("cooldown");
    expect(day.projection.shortfall).toMatchObject({ selected: 1, missing: 2 });
    expect(day.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "problem_supply_shortfall" })]),
    );
  });

  it("applies simulated cooldown through D+6 and releases supply on D+7", () => {
    const state = simulationState({
      learnerNodeStates: [nodeState("N15")],
      problemAvailability: [
        problem("number-of-islands", "N15", 1),
        problem("surrounded-regions", "N15", 2),
        problem("spiral-matrix", "N3", 1, { eligibleRoles: ["probe", "remedial"] }),
      ],
    });
    const before = JSON.parse(JSON.stringify(state));
    const days = simulate(state, {
      candidates: [{
        candidateId: "cooldown-boundary",
        skeleton: {
          ...requiredEdgeSkeleton,
          nodePlans: requiredEdgeSkeleton.nodePlans.filter((plan) => plan.nodeId === "N15"),
        },
      }],
      horizon: 8,
      dailyBudgets: Array.from({ length: 8 }, () => 3),
    }).candidates[0].branches.optimistic.internalDayProjections;

    const selected = (dayIndex: number) => {
      const projection = days[dayIndex].projection;
      return projection.kind === "task"
        ? projection.items.map((item) => item.problemSlug)
        : [];
    };
    expect(selected(0)).toEqual(
      expect.arrayContaining(["number-of-islands", "surrounded-regions"]),
    );
    for (let dayIndex = 1; dayIndex <= 6; dayIndex += 1) {
      expect(selected(dayIndex)).not.toEqual(
        expect.arrayContaining(["number-of-islands", "surrounded-regions"]),
      );
    }
    expect(
      selected(7).some((slug) =>
        ["number-of-islands", "surrounded-regions"].includes(slug),
      ),
    ).toBe(true);
    expect(state).toEqual(before);
  });

  it("preserves unknown when observed evidence is insufficient instead of extrapolating", () => {
    const result = simulate(simulationState(), {
      observedPace: {
        sampleDays: 2,
        observedCapacityRange: { min: 2, max: 3 },
        supportedPositiveItemsByDate: [
          { campaignDate: "2026-08-03", positiveItemCount: 2 },
          { campaignDate: "2026-08-04", positiveItemCount: 2 },
        ],
      },
    });
    const observed = result.candidates[0].branches.observed_supported;
    const n17 = observed.earliestReachableDates.find((entry) => entry.nodeId === "N17");

    expect(result.unknowns).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "insufficient_sample" })]),
    );
    expect(observed.internalDayProjections[0].outcome).toMatchObject({
      positiveItemCount: 0,
      neutralItemCount: 3,
    });
    expect(n17?.earliestEligibleDate).toBeNull();
    expect(JSON.stringify(result)).not.toContain("probability");
  });

  it("does not repeat an observed outcome across unobserved future dates", () => {
    const observed = simulate(simulationState(), {
      observedPace: {
        sampleDays: 4,
        observedCapacityRange: { min: 3, max: 3 },
        supportedPositiveItemsByDate: [
          { campaignDate: "2026-08-03", positiveItemCount: 1 },
        ],
      },
    }).candidates[0].branches.observed_supported;
    const n17 = observed.earliestReachableDates.find((entry) => entry.nodeId === "N17");

    expect(observed.internalDayProjections[0].outcome.positiveItemCount).toBe(1);
    expect(observed.internalDayProjections[1].outcome.positiveItemCount).toBe(0);
    expect(observed.internalDayProjections[1].unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_supported_outcome" }),
      ]),
    );
    expect(n17?.earliestEligibleDate).toBeNull();
  });

  it("keeps incomplete mastery history unknown and does not invent progression", () => {
    const state = simulationState({
      learnerNodeStates: [
        nodeState("N15", { latestPositiveStreak: 1, latestSettlementIds: [] }),
        nodeState("N17", { unlockedAt: null }),
      ],
    });
    const optimistic = simulate(state).candidates[0].branches.optimistic;
    const n17 = optimistic.earliestReachableDates.find((entry) => entry.nodeId === "N17");

    expect(optimistic.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "incomplete_settlement_history",
          nodeId: "N15",
        }),
      ]),
    );
    expect(optimistic.internalDayProjections[0].newlyMasteredNodeIds).not.toContain("N15");
    expect(n17?.earliestEligibleDate).toBeNull();
  });

  it("marks out-of-range capacity unknown instead of scaling outcomes", () => {
    const observed = simulate(simulationState(), {
      horizon: 1,
      dailyBudgets: [4],
      observedPace: {
        sampleDays: 5,
        observedCapacityRange: { min: 2, max: 3 },
        supportedPositiveItemsByDate: [
          { campaignDate: "2026-08-03", positiveItemCount: 2 },
        ],
      },
    }).candidates[0].branches.observed_supported;

    expect(observed.internalDayProjections[0].paceAssessment.reason).toBe(
      "out_of_observed_range",
    );
    expect(observed.internalDayProjections[0].outcome.positiveItemCount).toBe(0);
    expect(observed.unknowns).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "out_of_observed_range" })]),
    );
  });
});
