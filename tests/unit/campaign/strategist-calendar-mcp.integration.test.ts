import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignSimulationResult, StrategistCandidate, StrategistStrategyBrief } from "@/server/campaign/domain";
import { strategistDigest } from "@/server/campaign/domain";
import { simulateCampaignPlan } from "@/server/campaign/core";
import {
  CalendarMcpError,
  CampaignCoreService,
  ScriptedStrategistPlannerProvider,
  buildStrategistReadModel,
  createCalendarFreeBusyTool,
  executeStrategistPlanExecuteRuntime,
  resumeCampaignStrategistRun,
  type CalendarFreeBusyTool,
  type CalendarMcpTransport,
  type StrategistConstraintExtractor,
  type StrategistPlannerInput,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const now = new Date("2026-08-05T15:00:00.000Z");
const campaignDate = "2026-08-05";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const brief: StrategistStrategyBrief = {
  schemaVersion: 1,
  objective: "Find a legal future route without changing Today.",
  hardConstraints: ["Today and explicit daily caps are immutable."],
  softGoals: [
    { id: "user-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
    { id: "user-n4", nodeId: "N4", source: "user", requestedGoalDepth: "mastery" },
    { id: "system-n20", nodeId: "N20", source: "system", requestedGoalDepth: "mastery" },
  ],
  assumptions: [{ id: "capacity", statement: "The initial capacity may be insufficient." }],
  degradationLadder: [
    { level: "L1", goalId: "system-n20", action: "remove_system_goal" },
    { level: "L2", goalId: "user-n2", action: "downgrade_user_goal_to_exposure" },
    { level: "L2", goalId: "user-n4", action: "downgrade_user_goal_to_exposure" },
  ],
  candidateDimensions: ["future route", "optional confirmed capacity"],
  stopCondition: "Finalize an accepted candidate or ask one decisive question.",
};

function candidate(candidateId: string, priority: number, budget = false): StrategistCandidate {
  return {
    candidateId,
    nodeOperations: [{ type: "set_node_priority", nodeId: "N20", priority }],
    goalDepth: [],
    targetByDate: [],
    dailyBudgetSuggestions: budget ? [{ campaignDate: "2026-08-07", maxQuestions: 4, rationale: "Ask the user to approve one optional extra question." }] : [],
    rationaleSummary: "Adjust only the future route after deterministic validation.",
  };
}

function simulateAction(value: StrategistCandidate, includeBrief = false) {
  return { ...(includeBrief ? { strategyBrief: brief } : {}), action: { type: "simulate_campaign_plan" as const, candidates: [value] } };
}

function calendarActionForRange(
  rangeStart = "2026-08-06T00:00:00.000Z",
  rangeEnd = "2026-08-07T00:00:00.000Z",
) {
  return {
    action: {
      type: "calendar_freebusy" as const,
      rangeStart,
      rangeEnd,
      purpose: "find_optional_relaxation" as const,
    },
  };
}

const calendarAction = calendarActionForRange();

function clarificationAction() {
  return { action: { type: "request_clarification" as const, question: "Would you like to raise the optional August 7 cap from 3 to 4?", knownFacts: ["Calendar free/busy data cannot change your cap."], tradeoff: "Keep the current cap or explicitly approve one extra question." } };
}

function finalizeAction(candidateId: string) {
  return { action: { type: "finalize" as const, candidateId, finalSummary: "Create only a pending future-route proposal." } };
}

type FixtureOptions = Readonly<{
  endDate?: string;
  horizonEnd?: string;
  dailyCaps?: readonly Readonly<{ campaignDate: string; maxQuestions: number }>[];
  authorizedRange?: Readonly<{ start: string; end: string }>;
}>;

async function fixture(handle: string, authorized: boolean, options: FixtureOptions = {}) {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({ data: { handle } });
  const service = new CampaignCoreService(database.prisma, { now: () => now });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: options.endDate ?? "2026-10-30",
      dailyQuestionBudget: 3,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: ["N2"],
      preferredNodes: ["N4"],
    },
  });
  await service.getOrCreateDailyTask({ campaignId: campaign.id, campaignDate });
  const projection = await buildStrategistReadModel({ db: database.prisma, campaignId: campaign.id, campaignDate });
  const traceRunId = `trace-${handle}`;
  await database.prisma.agentTraceRun.create({ data: {
    id: traceRunId,
    userId: user.id,
    path: "campaign_strategist",
    actionKind: "calendar_mcp_test",
    memoryOrigin: "test",
    status: "running",
    processInstanceId: "m4d2-test",
  } });
  const run = await database.prisma.campaignStrategistRun.create({ data: {
    campaignId: campaign.id,
    activeSkeletonVersion: 1,
    trigger: "user_proposal",
    triggerFingerprint: strategistDigest(handle),
    inputDigest: projection.inputDigest,
    wakeSnapshotJson: JSON.stringify(projection.wakeSnapshot),
    promptVersion: "strategist-plan-execute-v1",
    evaluatorVersion: "strategist-wake-v1",
    provider: "scripted-strategist",
    modelAlias: "scripted-strategist-v1",
    status: "queued",
    traceRunId,
    runtimeStateJson: JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: "plan-execute-v1",
      runMode: "proposal",
      origin: "user",
      campaignDate,
      request: { text: authorized ? "You may check free/busy for August 6." : "Do not access my calendar." },
      status: "queued",
    }),
  } });
  const extractor: StrategistConstraintExtractor = {
    async extractConstraints(input) {
      return {
        constraints: {
          schemaVersion: 1,
          hardConstraints: ["Today and explicit daily caps are immutable."],
          userGoals: [
            { id: "user-n2", topic: "Hash Map", nodeId: "N2", priority: 90, requestedGoalDepth: "mastery" },
            { id: "user-n4", topic: "Stack", nodeId: "N4", priority: 70, requestedGoalDepth: "mastery" },
          ],
          permissions: {
            calendarOptionalLookup: authorized,
            calendarAuthorizedRange: authorized ? options.authorizedRange ?? { start: "2026-08-06T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" } : null,
          },
          horizonEnd: options.horizonEnd ?? options.endDate ?? "2026-10-30",
          dailyCaps: options.dailyCaps ? [...options.dailyCaps] : [{ campaignDate: "2026-08-06", maxQuestions: 3 }],
          assumptions: [],
          scope: "future_route",
          deterministicFacts: input.deterministicFacts,
        },
        audit: { modelCallCount: 1, schemaRepairCount: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  return { ...database, user, campaign, run, extractor };
}

async function snapshots(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    today: await f.prisma.campaignDailyTask.findUniqueOrThrow({ where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate } }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    campaign: await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } }),
    goal: await f.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: f.campaign.id } }),
    states: await f.prisma.campaignLearnerNodeState.findMany({ where: { campaignId: f.campaign.id }, orderBy: { nodeId: "asc" } }),
  };
}

function rejectedCandidateA(input: Parameters<typeof simulateCampaignPlan>[0]): CampaignSimulationResult {
  const result = structuredClone(simulateCampaignPlan(input));
  return {
    ...result,
    candidates: result.candidates.map((entry) => entry.candidateId !== "candidate-a" ? entry : {
      ...entry,
      branches: {
        ...entry.branches,
        optimistic: {
          ...entry.branches.optimistic,
          violations: [...entry.branches.optimistic.violations, { code: "problem_supply_shortfall" as const, campaignDate: "2026-08-06", message: "Deterministic fixture shortfall." }],
        },
      },
    }),
  };
}

function observation(validUntil = "2026-08-05T16:00:00.000Z") {
  return {
    busyIntervals: [{ start: "2026-08-06T13:00:00.000Z", end: "2026-08-06T14:00:00.000Z" }],
    freeIntervals: [{ start: "2026-08-06T15:00:00.000Z", end: "2026-08-06T17:00:00.000Z" }],
    allDay: [],
    asOf: now.toISOString(),
    validUntil,
    providerScope: "calendar.freebusy",
    sourceDigest: "a".repeat(64),
  };
}

describe("Calendar MCP adapter", () => {
  it("strips event body content and returns only normalized free/busy fields", async () => {
    const marker = "PRIVATE_EVENT_TITLE_AND_ATTENDEES";
    const transport: CalendarMcpTransport = { callTool: vi.fn(async () => ({
      structuredContent: {
        busyIntervals: [{ start: "2026-08-06T13:00:00-05:00", end: "2026-08-06T14:00:00-05:00" }],
        freeIntervals: [{ start: "2026-08-06T15:00:00-05:00", end: "2026-08-06T16:00:00-05:00" }],
        allDay: [],
        asOf: "2026-08-05T15:00:00.000Z",
        providerScope: "google.freebusy",
      },
      content: [{ type: "text", text: marker }],
    })) };
    const tool = createCalendarFreeBusyTool({
      config: { enabled: true, endpoint: "https://calendar.example.test/mcp", accessToken: "secret-not-forwarded", toolName: "calendar_freebusy", timeoutMs: 500 },
      transport,
      now: () => now,
    });
    const result = await tool.query({ rangeStart: "2026-08-06T00:00:00.000Z", rangeEnd: "2026-08-07T00:00:00.000Z" });
    expect(Object.keys(result).sort()).toEqual(["allDay", "asOf", "busyIntervals", "freeIntervals", "providerScope", "sourceDigest", "validUntil"]);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.validUntil).toBe("2026-08-05T16:00:00.000Z");
  });

  it("turns transport timeout into a controlled Calendar error", async () => {
    const transport: CalendarMcpTransport = { callTool: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) };
    const tool = createCalendarFreeBusyTool({
      config: { enabled: true, endpoint: "https://calendar.example.test/mcp", accessToken: null, toolName: "calendar_freebusy", timeoutMs: 250 },
      transport,
      now: () => now,
    });
    await expect(tool.query({ rangeStart: "2026-08-06T00:00:00.000Z", rangeEnd: "2026-08-07T00:00:00.000Z" })).rejects.toMatchObject({ code: "calendar_mcp_timeout" });
  });
});

describe("Strategist calendar_freebusy gating", () => {
  const completeCaps: FixtureOptions = {
    endDate: "2026-08-07",
    horizonEnd: "2026-08-07",
    dailyCaps: [
      { campaignDate: "2026-08-05", maxQuestions: 6 },
      { campaignDate: "2026-08-06", maxQuestions: 3 },
      { campaignDate: "2026-08-07", maxQuestions: 3 },
    ],
    authorizedRange: { start: "2026-08-06T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
  };

  it("does not call Calendar with complete daily caps when explicit authorization is absent", async () => {
    const f = await fixture("m4d2-unauthorized", false, completeCaps);
    const query = vi.fn(async () => observation());
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      calendarAction,
      (input: StrategistPlannerInput) => {
        expect(input.allowedActions).not.toContain("calendar_freebusy");
        expect(input.state.calendarFailures).toEqual([expect.objectContaining({ code: "calendar_not_authorized" })]);
        return clarificationAction();
      },
    ]);
    const result = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 2 });
    expect(result.kind).toBe("needs_clarification");
    expect(query).not.toHaveBeenCalled();
  });

  it("does not call Calendar with complete daily caps when the latest Simulator result satisfies constraints", async () => {
    const f = await fixture("m4d2-simulation-satisfied", true, completeCaps);
    const query = vi.fn(async () => observation());
    const plan = candidate("candidate-ok", 81);
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(plan, true),
      (input: StrategistPlannerInput) => {
        expect(input.state.observations.at(-1)).toMatchObject({ accepted: true });
        expect(input.allowedActions).not.toContain("calendar_freebusy");
        return calendarAction;
      },
      finalizeAction("candidate-ok"),
    ]);
    const result = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulationHorizon: 2 });
    expect(result.kind).toBe("waiting_approval");
    expect(query).not.toHaveBeenCalled();
  });

  it("allows an exact two-day Calendar query after failed simulation even when daily caps are complete", async () => {
    const f = await fixture("m4d2-complete-caps-authorized", true, completeCaps);
    const query = vi.fn(async () => observation());
    const requestedRange = calendarActionForRange("2026-08-06T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      (input: StrategistPlannerInput) => {
        expect(input.state.observations.at(-1)).toMatchObject({ accepted: false });
        expect(input.allowedActions).toContain("calendar_freebusy");
        return requestedRange;
      },
      (input: StrategistPlannerInput) => {
        expect(input.state.calendarObservation?.freeIntervals).toHaveLength(1);
        expect(input.state.calendarConfirmationRequired).toBe(true);
        expect(input.state.resolvedConstraints?.dailyCaps).toEqual(completeCaps.dailyCaps);
        return clarificationAction();
      },
    ]);
    const result = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 2 });
    expect(result.kind).toBe("needs_clarification");
    expect(query).toHaveBeenCalledExactlyOnceWith({
      rangeStart: "2026-08-06T00:00:00.000Z",
      rangeEnd: "2026-08-08T00:00:00.000Z",
    });
    expect(result.state?.resolvedConstraints?.dailyCaps).toEqual(completeCaps.dailyCaps);
    expect(await f.prisma.campaignDailyBudgetOverride.count()).toBe(0);
  });

  it("allows Calendar only after failed simulation and exposes the sanitized Observation to the next decision", async () => {
    const f = await fixture("m4d2-observation-driven", true);
    const before = await snapshots(f);
    const query = vi.fn(async () => observation());
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      (input: StrategistPlannerInput) => {
        expect(input.state.observations.at(-1)).toMatchObject({ accepted: false });
        expect(input.allowedActions).toContain("calendar_freebusy");
        return calendarAction;
      },
      (input: StrategistPlannerInput) => {
        expect(input.state.calendarObservation).toMatchObject({ providerScope: "calendar.freebusy", sourceDigest: "a".repeat(64) });
        expect(input.state.calendarConfirmationRequired).toBe(true);
        return clarificationAction();
      },
    ]);
    const result = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 1 });
    expect(result.kind).toBe("needs_clarification");
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.state?.resolvedConstraints?.dailyCaps).toEqual([{ campaignDate: "2026-08-06", maxQuestions: 3 }]);
    expect(await snapshots(f)).toEqual(before);
  });

  it("rejects a Calendar-backed candidate that tries to overwrite an explicit daily cap", async () => {
    const f = await fixture("m4d2-cap-protected", true);
    const conflicting = { ...candidate("calendar-conflict", 83), dailyBudgetSuggestions: [{ campaignDate: "2026-08-06", maxQuestions: 4, rationale: "Must remain a user decision." }] };
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      calendarAction,
      clarificationAction(),
      simulateAction(conflicting),
      (input: StrategistPlannerInput) => {
        expect(input.state.observations.at(-1)?.rejectionCodes).toContain("calendar_explicit_daily_cap_protected");
        return clarificationAction();
      },
    ]);
    const first = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query: async () => observation("2026-08-05T18:00:00.000Z") }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 1 });
    expect(first.kind).toBe("needs_clarification");
    const resumed = await resumeCampaignStrategistRun({ db: f.prisma, userId: f.user.id, runId: f.run.id, answer: "Yes, only if it does not replace my August 6 cap.", now: new Date(now.valueOf() + 1_000), plannerProvider: provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query: async () => observation() }, dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d2-cap-resume" } });
    expect(resumed.kind).toBe("queued");
    const stored = await waitForStatus(f.prisma, f.run.id, ["budget_exhausted"]);
    expect(JSON.parse(stored.runtimeStateJson!).resolvedConstraints.dailyCaps).toEqual([{ campaignDate: "2026-08-06", maxQuestions: 3 }]);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("reports the current terminal candidate-resolution failure for stale Calendar input", async () => {
    const f = await fixture("m4d2-stale-finalize", true);
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      calendarAction,
      clarificationAction(),
      simulateAction(candidate("candidate-b", 84, true)),
      finalizeAction("candidate-b"),
    ]);
    const first = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query: async () => observation("2026-08-05T15:30:00.000Z") }, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 1 });
    expect(first.kind).toBe("needs_clarification");
    await resumeCampaignStrategistRun({ db: f.prisma, userId: f.user.id, runId: f.run.id, answer: "Yes, propose 4 as an optional cap for August 7.", now: new Date("2026-08-05T17:00:00.000Z"), plannerProvider: provider, constraintExtractor: f.extractor, calendarTool: { enabled: true, query: async () => observation() }, dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4d2-stale-resume" } });
    const stored = await waitForStatus(f.prisma, f.run.id, ["stale", "failed"]);
    expect(stored.errorClass).toBe("finalize_unknown_candidate");
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("contains MCP timeout/failure without changing Today or Campaign state", async () => {
    const f = await fixture("m4d2-mcp-failure", true);
    const before = await snapshots(f);
    const provider = new ScriptedStrategistPlannerProvider([
      simulateAction(candidate("candidate-a", 82), true),
      calendarAction,
      (input: StrategistPlannerInput) => {
        expect(input.state.calendarFailures).toEqual([expect.objectContaining({ code: "calendar_mcp_timeout" })]);
        return clarificationAction();
      },
    ]);
    const calendarTool: CalendarFreeBusyTool = { enabled: true, query: async () => { throw new CalendarMcpError("calendar_mcp_timeout", "fixture timeout"); } };
    const result = await executeStrategistPlanExecuteRuntime({ db: f.prisma, runId: f.run.id, provider, constraintExtractor: f.extractor, calendarTool, now, campaignDate, runtimeVersion: "plan-execute-v1", simulate: rejectedCandidateA, simulationHorizon: 1 });
    expect(result.kind).toBe("needs_clarification");
    expect(await snapshots(f)).toEqual(before);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });
});

async function waitForStatus(db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"], runId: string, statuses: string[]) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const run = await db.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (statuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not reach ${statuses.join(",")}.`);
}
