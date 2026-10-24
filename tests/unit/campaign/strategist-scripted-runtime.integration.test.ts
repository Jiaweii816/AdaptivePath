import { afterEach, describe, expect, it } from "vitest";
import type { CampaignSimulationResult } from "@/server/campaign/domain";
import { strategistDigest, strategistRunModeSchema, type StrategistCandidate, type StrategistStrategyBrief } from "@/server/campaign/domain";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
  ScriptedStrategistPlannerProvider,
  buildStrategistReadModel,
  buildStrategistRuntimeContext,
  executeScriptedStrategistRuntime,
  type StrategistPlannerInput,
} from "@/server/campaign/services";
import { simulateCampaignPlan } from "@/server/campaign/core";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-08-05T15:00:00.000Z");
const campaignDate = "2026-08-05";

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const brief: StrategistStrategyBrief = {
  schemaVersion: 1,
  objective: "Keep a legal route within observed capacity.",
  hardConstraints: ["Preserve Today and user goals."],
  softGoals: [
    { id: "user-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
    { id: "system-n20", nodeId: "N20", source: "system", requestedGoalDepth: "mastery" },
  ],
  assumptions: [{ id: "capacity-stable", statement: "The current daily capacity remains usable." }],
  degradationLadder: [
    { level: "L1", goalId: "system-n20", action: "remove_system_goal" },
    { level: "L2", goalId: "user-n2", action: "downgrade_user_goal_to_exposure" },
  ],
  candidateDimensions: ["route priority", "goal depth", "date budget"],
  stopCondition: "Finalize one validated candidate or request one decisive clarification.",
};

function candidate(candidateId: string, priority: number): StrategistCandidate {
  return {
    candidateId,
    nodeOperations: [{ type: "set_node_priority", nodeId: "N20", priority }],
    goalDepth: [],
    targetByDate: [],
    dailyBudgetSuggestions: [],
    rationaleSummary: `Use priority ${priority} for the future system goal.`,
  };
}

async function fixture(handle: string, trace = false, runtimeStateJson: string | null = null) {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({ data: { handle } });
  const service = new CampaignCoreService(database.prisma, { now: () => now });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: "2026-10-30",
      dailyQuestionBudget: 3,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: ["N2"],
      preferredNodes: ["N4"],
    },
  });
  await service.getOrCreateDailyTask({ campaignId: campaign.id, campaignDate });
  const projection = await buildStrategistReadModel({ db: database.prisma, campaignId: campaign.id, campaignDate });
  const traceRunId = trace ? `trace-${handle}` : null;
  if (traceRunId) {
    await database.prisma.agentTraceRun.create({
      data: {
        id: traceRunId,
        userId: user.id,
        path: "campaign_strategist",
        actionKind: "scripted_runtime",
        memoryOrigin: "test",
        status: "running",
        processInstanceId: "m4d1b1-test",
      },
    });
  }
  const run = await database.prisma.campaignStrategistRun.create({
    data: {
      campaignId: campaign.id,
      activeSkeletonVersion: campaign.activeSkeletonVersion,
      trigger: "weekly_boundary",
      triggerFingerprint: strategistDigest({ handle, now: now.toISOString() }),
      inputDigest: projection.inputDigest,
      wakeSnapshotJson: JSON.stringify(projection.wakeSnapshot),
      promptVersion: "scripted-runtime-v1",
      evaluatorVersion: "strategist-wake-v1",
      provider: "scripted-strategist",
      modelAlias: "scripted-strategist-v1",
      status: "queued",
      traceRunId,
      runtimeStateJson,
    },
  });
  return { ...database, user, campaign, run };
}

async function snapshots(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    today: await f.prisma.campaignDailyTask.findUniqueOrThrow({ where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate } }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    campaign: await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    goal: await f.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: f.campaign.id } }),
    skeleton: await f.prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: f.campaign.id, version: f.campaign.activeSkeletonVersion } },
      include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
    }),
    states: await f.prisma.campaignLearnerNodeState.findMany({ where: { campaignId: f.campaign.id }, orderBy: { nodeId: "asc" } }),
  };
}

function simulateAction(value: StrategistCandidate, includeBrief = false) {
  return {
    ...(includeBrief ? { strategyBrief: brief } : {}),
    action: { type: "simulate_campaign_plan" as const, candidates: [value] },
  };
}

function finalizeAction(candidateId: string) {
  return { action: { type: "finalize" as const, candidateId, finalSummary: `Finalize ${candidateId} as a pending route proposal.` } };
}

describe("M4D1B1 scripted Plan-and-Execute Runtime", () => {
  it("keeps proposal runMode stable across initial state, simulation Observation, and finalize", async () => {
    const f = await fixture("m4d1b1-proposal-mode-stable");
    const persistedModes: string[] = [];
    const observePersistedMode = async () => {
      const stored = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } });
      const mode = JSON.parse(stored.runtimeStateJson!).runMode as string;
      persistedModes.push(mode);
      expect(mode).toBe("proposal");
    };
    const provider = new ScriptedStrategistPlannerProvider([
      async (input: StrategistPlannerInput) => {
        expect(input.state.runMode).toBe("proposal");
        await observePersistedMode();
        return simulateAction(candidate("proposal-stable", 89), true);
      },
      async (input: StrategistPlannerInput) => {
        expect(input.state).toMatchObject({ runMode: "proposal", observations: [{ candidateId: "proposal-stable" }] });
        await observePersistedMode();
        return finalizeAction("proposal-stable");
      },
    ]);

    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1 });
    expect(result.kind).toBe("waiting_approval");
    if (result.kind !== "waiting_approval") throw new Error("Expected proposal run to wait for approval.");
    expect(result.state.runMode).toBe("proposal");
    await observePersistedMode();
    expect(persistedModes).toEqual(["proposal", "proposal", "proposal"]);
    expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id, status: "pending" } })).toBe(1);
  });

  it("keeps simulation runMode stable and blocks Proposal Service on finalize", async () => {
    const f = await fixture(
      "m4d1b1-simulation-mode-safe",
      true,
      JSON.stringify({ schemaVersion: 1, runtimeVersion: "scripted-plan-execute-v1", runMode: "simulation", status: "queued" }),
    );
    const before = await snapshots(f);
    const patchCountBefore = await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } });
    let proposalCalls = 0;
    const provider = new ScriptedStrategistPlannerProvider([
      (input: StrategistPlannerInput) => {
        expect(input.state.runMode).toBe("simulation");
        return simulateAction(candidate("what-if", 88), true);
      },
      (input: StrategistPlannerInput) => {
        expect(input.state).toMatchObject({ runMode: "simulation", observations: [{ candidateId: "what-if" }] });
        return finalizeAction("what-if");
      },
    ]);

    const result = await executeScriptedStrategistRuntime({
      db: f.prisma,
      runId: f.run.id,
      provider,
      now,
      campaignDate,
      simulationHorizon: 1,
      proposalWriter: async () => {
        proposalCalls += 1;
        throw new Error("Proposal Service must not run in simulation mode.");
      },
    });
    expect(result.kind).toBe("simulation_complete");
    if (result.kind !== "simulation_complete") throw new Error("Expected controlled simulation completion.");
    expect(result).toMatchObject({ errorClass: "simulation_mode_proposal_forbidden", state: { runMode: "simulation", budgetSnapshot: { proposalWrite: { used: 0 } } } });
    expect(proposalCalls).toBe(0);
    expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } })).toBe(patchCountBefore);
    expect(await snapshots(f)).toEqual(before);
    const stored = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } });
    expect(stored).toMatchObject({ status: "no_change", errorClass: "simulation_mode_proposal_forbidden" });
    expect(JSON.parse(stored.runtimeStateJson!)).toMatchObject({ runMode: "simulation", selectedCandidateId: "what-if" });
    const trace = await f.prisma.agentTraceEvent.findMany({ where: { traceRunId: f.run.traceRunId! }, orderBy: { stepIndex: "asc" } });
    expect(trace.map((event) => event.stage)).toEqual(["simulate_campaign_plan", "simulation_finalize_blocked"]);
  });

  it("defaults legacy runtime state without runMode to proposal for the entire run", async () => {
    const f = await fixture(
      "m4d1b1-legacy-mode-default",
      false,
      JSON.stringify({ schemaVersion: 1, runtimeVersion: "scripted-plan-execute-v1", status: "queued" }),
    );
    const seenModes: string[] = [];
    const provider = new ScriptedStrategistPlannerProvider([
      (input: StrategistPlannerInput) => {
        seenModes.push(input.state.runMode);
        return simulateAction(candidate("legacy-default", 86), true);
      },
      (input: StrategistPlannerInput) => {
        seenModes.push(input.state.runMode);
        return finalizeAction("legacy-default");
      },
    ]);
    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1 });
    expect(result.kind).toBe("waiting_approval");
    expect(seenModes).toEqual(["proposal", "proposal"]);
    const stored = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } });
    expect(JSON.parse(stored.runtimeStateJson!)).toMatchObject({ runMode: "proposal" });
  });

  it("changes the next action when only Candidate A's simulation Observation changes", async () => {
    const nextActions: Array<{ accepted: boolean; type: string; candidateId: string }> = [];
    const run = async (accepted: boolean) => {
      const f = await fixture("m4d1b1-observation-causality");
      const before = await snapshots(f);
      const provider = new ScriptedStrategistPlannerProvider([
        simulateAction(candidate("candidate-a", 91), true),
        (input: StrategistPlannerInput) => {
          const observation = input.state.observations.at(-1);
          expect(observation).toMatchObject({ candidateId: "candidate-a", accepted });
          const action = observation?.accepted
            ? finalizeAction("candidate-a")
            : simulateAction(candidate("candidate-b", 92));
          nextActions.push({ accepted, type: action.action.type, candidateId: action.action.type === "finalize" ? action.action.candidateId : action.action.candidates[0].candidateId });
          return action;
        },
        (input: StrategistPlannerInput) => {
          expect(input.state.observations.at(-1)).toMatchObject({ candidateId: "candidate-b", accepted: true });
          return finalizeAction("candidate-b");
        },
      ]);
      const simulatedCandidates: string[] = [];
      const simulate = (input: Parameters<typeof simulateCampaignPlan>[0]): CampaignSimulationResult => {
        simulatedCandidates.push(...input.candidates.map((entry) => entry.candidateId));
        const result = structuredClone(simulateCampaignPlan(input));
        if (!accepted && input.candidates[0].candidateId === "candidate-a") {
          return {
            ...result,
            candidates: result.candidates.map((entry) => entry.candidateId !== "candidate-a" ? entry : {
              ...entry,
              branches: {
                ...entry.branches,
                optimistic: {
                  ...entry.branches.optimistic,
                  violations: [...entry.branches.optimistic.violations, { code: "problem_supply_shortfall" as const, campaignDate: "2026-08-06", message: "Scripted deterministic rejection." }],
                },
              },
            }),
          };
        }
        return result;
      };
      const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1, simulate });
      expect(result.kind).toBe("waiting_approval");
      const stored = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } });
      expect(JSON.parse(stored.runtimeStateJson!)).toMatchObject({
        runtimeVersion: "scripted-plan-execute-v1",
        runMode: "proposal",
        selectedCandidateId: accepted ? "candidate-a" : "candidate-b",
      });
      expect(await snapshots(f)).toMatchObject({ today: before.today, campaign: before.campaign, states: before.states });
      return { provider, simulatedCandidates };
    };

    const rejected = await run(false);
    const acceptable = await run(true);
    expect(nextActions).toEqual([
      { accepted: false, type: "simulate_campaign_plan", candidateId: "candidate-b" },
      { accepted: true, type: "finalize", candidateId: "candidate-a" },
    ]);
    expect(rejected.simulatedCandidates).toEqual(["candidate-a", "candidate-b"]);
    expect(acceptable.simulatedCandidates).toEqual(["candidate-a"]);
    expect(rejected.provider.decisionCount).toBe(3);
    expect(acceptable.provider.decisionCount).toBe(2);
    expect(strategistRunModeSchema.parse(undefined)).toBe("proposal");
  });

  it.each([
    ["L1 system removal", { ...candidate("l1", 80), nodeOperations: [{ type: "set_node_included" as const, nodeId: "N20" as const, included: false }] }],
    ["L2 user mastery-to-exposure", { ...candidate("l2", 80), nodeOperations: [], goalDepth: [{ nodeId: "N2" as const, goalDepth: "exposure" as const }] }],
  ])("supports %s through Policy and M4A into a pending-only proposal", async (handle, plan) => {
    const f = await fixture(`m4d1b1-${handle}`);
    const before = await snapshots(f);
    const provider = new ScriptedStrategistPlannerProvider([simulateAction(plan, true), finalizeAction(plan.candidateId)]);
    expect((await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1 })).kind).toBe("waiting_approval");
    const patch = await f.prisma.campaignSkeletonPatch.findFirstOrThrow({ where: { campaignId: f.campaign.id } });
    expect(patch.status).toBe("pending");
    expect(await f.prisma.campaignSkeletonDecisionLog.count()).toBe(0);
    expect(await snapshots(f)).toMatchObject({ today: before.today, campaign: before.campaign, states: before.states });
  });

  it("rejects removal beyond L2 and persists one decisive clarification", async () => {
    const f = await fixture("m4d1b1-clarification");
    const forbidden = { ...candidate("remove-user", 80), nodeOperations: [{ type: "set_node_included" as const, nodeId: "N2" as const, included: false }] };
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(forbidden, true),
      (input: StrategistPlannerInput) => {
        expect(input.state.observations.at(-1)?.rejectionCodes).toContain("user_goal_removal_forbidden");
        return { action: { type: "request_clarification", question: "Keep N2 at exposure depth instead?", knownFacts: ["N2 is a user-sourced goal."], tradeoff: "Preserve the goal with less depth or retain mastery." } };
      },
    ]);
    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1 });
    expect(result.kind).toBe("needs_clarification");
    expect((await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("needs_clarification");
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("caches a duplicate fingerprint without a second Simulator charge", async () => {
    const f = await fixture("m4d1b1-duplicate", true);
    const original = candidate("original", 87);
    const duplicate = { ...candidate("duplicate", 87), rationaleSummary: "A different rationale is excluded from the fingerprint." };
    const provider = new ScriptedStrategistPlannerProvider([simulateAction(original, true), simulateAction(duplicate), finalizeAction("original")]);
    let calls = 0;
    const result = await executeScriptedStrategistRuntime({
      db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1,
      simulate: (input) => { calls += 1; return simulateCampaignPlan(input); },
    });
    expect(result.kind).toBe("waiting_approval");
    if (result.kind !== "waiting_approval") throw new Error("Expected waiting approval.");
    expect(calls).toBe(1);
    expect(result.state.budgetSnapshot.batchSimulations.used).toBe(1);
    expect(result.state.observations.map((entry) => entry.type)).toContain("duplicate_candidate");
    const traceEvents = await f.prisma.agentTraceEvent.findMany({ where: { traceRunId: f.run.traceRunId! }, orderBy: { stepIndex: "asc" } });
    expect(traceEvents.map((event) => event.stage)).toContain("duplicate_candidate");
    expect(traceEvents.filter((event) => event.kind === "tool").map((event) => event.stage)).toEqual(["simulate_campaign_plan"]);
  });

  it.each([
    ["planner", { plannerDecisionLimit: 2, simulationLimit: 5 }, "planner_budget_exhausted", 2, 2],
    ["simulation", { plannerDecisionLimit: 6, simulationLimit: 1 }, "simulation_budget_exhausted", 2, 1],
  ])("halts on %s budget exhaustion without a proposal", async (handle, limits, errorClass, expectedDecisions, expectedSimulations) => {
    const f = await fixture(`m4d1b1-${handle}-budget`);
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("budget-a", 71), true),
      simulateAction(candidate("budget-b", 72)),
      simulateAction(candidate("budget-c", 73)),
    ]);
    let simulations = 0;
    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1, ...limits, simulate: (input) => { simulations += 1; return simulateCampaignPlan(input); } });
    expect(result.kind).toBe("budget_exhausted");
    expect(provider.decisionCount).toBe(expectedDecisions);
    expect(simulations).toBe(expectedSimulations);
    expect((await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } })).errorClass).toBe(errorClass);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("detects a Skeleton version change during the loop and never rebases", async () => {
    const f = await fixture("m4d1b1-stale");
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("stale-candidate", 75), true),
      async () => {
        await f.prisma.campaign.update({ where: { id: f.campaign.id }, data: { activeSkeletonVersion: 2 } });
        return finalizeAction("stale-candidate");
      },
    ]);
    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate, simulationHorizon: 1 });
    expect(result.kind).toBe("stale");
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("pre-gates an existing pending Patch without invoking the provider", async () => {
    const f = await fixture("m4d1b1-pending");
    const existing = await new CampaignSkeletonPatchService(f.prisma, { now: () => now }).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: { patchSchemaVersion: 1, baseVersion: 1, trigger: "fixture", rationale: "Existing pending proposal.", operations: [{ type: "set_node_priority", nodeId: "N20", priority: 66 }] },
    });
    const provider = new ScriptedStrategistPlannerProvider([simulateAction(candidate("never-called", 77), true)]);
    expect((await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate })).kind).toBe("pending_patch");
    expect(provider.decisionCount).toBe(0);
    expect(await f.prisma.campaignSkeletonPatch.findMany()).toEqual([expect.objectContaining({ id: existing.patch.id, status: "pending" })]);
  });

  it("fails malformed actions without persisting private reasoning and never records fixed context as a tool", async () => {
    const marker = "PRIVATE_SCRATCHPAD_DO_NOT_PERSIST";
    const f = await fixture("m4d1b1-private", true);
    const before = await snapshots(f);
    const provider = new ScriptedStrategistPlannerProvider([{
      strategyBrief: brief,
      action: { type: "simulate_campaign_plan", candidates: [candidate("private", 79)], scratchpad: marker },
      chainOfThought: marker,
    }]);
    const result = await executeScriptedStrategistRuntime({ db: f.prisma, runId: f.run.id, provider, now, campaignDate });
    expect(result.kind).toBe("failed");
    const run = await f.prisma.campaignStrategistRun.findUniqueOrThrow({ where: { id: f.run.id } });
    const events = await f.prisma.agentTraceEvent.findMany({ where: { traceRunId: f.run.traceRunId! }, include: { payload: true } });
    const persisted = JSON.stringify({ run, events, patches: await f.prisma.campaignSkeletonPatch.findMany() });
    expect(persisted).not.toContain(marker);
    expect(persisted).not.toMatch(/chainOfThought|scratchpad|rawOutput/);
    expect(events.every((event) => !event.payload || (event.payload.promptJson === null && event.payload.inputJson === null && event.payload.outputJson === null))).toBe(true);
    expect(events.filter((event) => event.kind === "tool").map((event) => event.stage)).not.toContain("fixed_context_assembly");
    expect(await snapshots(f)).toMatchObject({ today: before.today, campaign: before.campaign, states: before.states });
  });

  it("assembles every fixed context section with a stable digest and bounded planning history", async () => {
    const f = await fixture("m4d1b1-context");
    for (let index = 0; index < 7; index += 1) {
      const action = (["accepted", "partially_accepted", "rejected"] as const)[index % 3];
      const patch = await f.prisma.campaignSkeletonPatch.create({
        data: {
          campaignId: f.campaign.id,
          baseVersion: 1,
          trigger: `history_${index}`,
          rationale: `History ${index}`,
          status: action,
          operationsJson: JSON.stringify({ patchSchemaVersion: 1, operations: [{ operationId: "op-001", type: "set_node_priority", nodeId: "N20", priority: index }] }),
          proposalFingerprint: `history-${index}`,
          validatorSummaryJson: "{}",
          decidedAt: new Date(now.valueOf() + index),
          createdAt: new Date(now.valueOf() + index),
          updatedAt: new Date(now.valueOf() + index),
        },
      });
      await f.prisma.campaignSkeletonDecisionLog.create({ data: { campaignId: f.campaign.id, patchId: patch.id, action, actorType: "user", baseVersion: 1, rationale: `History ${index}`, createdAt: new Date(now.valueOf() + index) } });
    }
    await f.prisma.campaignStrategistRun.create({ data: {
      campaignId: f.campaign.id,
      activeSkeletonVersion: 1,
      trigger: "weekly_boundary",
      triggerFingerprint: strategistDigest("validator-history"),
      inputDigest: "a".repeat(64),
      wakeSnapshotJson: "{}",
      promptVersion: "scripted-runtime-v1",
      evaluatorVersion: "strategist-wake-v1",
      provider: "scripted-strategist",
      modelAlias: "scripted-strategist-v1",
      status: "invalid",
      errorClass: "m4a_validator_rejected",
      completedAt: new Date(now.valueOf() + 100),
      createdAt: new Date(now.valueOf() + 100),
      updatedAt: new Date(now.valueOf() + 100),
    } });
    const first = await buildStrategistRuntimeContext({ db: f.prisma, campaignId: f.campaign.id, campaignDate });
    const second = await buildStrategistRuntimeContext({ db: f.prisma, campaignId: f.campaign.id, campaignDate });
    expect(second).toEqual(first);
    expect(first.context).toEqual(expect.objectContaining({ goal: expect.any(Object), route: expect.any(Object), recentPerformance: expect.any(Array), repairSummary: expect.any(Object), problemSupply: expect.any(Array), planningHistory: expect.any(Array), externalPracticeSummary: expect.any(Object) }));
    expect(first.context.planningHistory).toHaveLength(5);
    expect(first.context.planningHistory).toContainEqual(expect.objectContaining({ kind: "validator_rejection", errorClass: "m4a_validator_rejected" }));
    expect(first.context.planningHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "decision", decision: "accepted" }),
      expect.objectContaining({ kind: "decision", decision: "partially_accepted" }),
      expect.objectContaining({ kind: "decision", decision: "rejected" }),
    ]));
    expect(JSON.stringify(first.context).length).toBeLessThanOrEqual(20_000);
  });
});
