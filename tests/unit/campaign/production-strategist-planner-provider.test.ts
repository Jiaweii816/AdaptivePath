import { describe, expect, it, vi } from "vitest";
import {
  ProductionStrategistPlannerProvider,
  ProductionStrategistProviderError,
  type ProductionStrategistTransport,
} from "@/server/campaign/services";
import { strategistPlannerTurnSchema, type StrategistRuntimeContext, type StrategistRuntimeState } from "@/server/campaign/domain";

const deterministicFacts = {
  todayTaskImmutable: true as const,
  activeCampaign: true,
  activeSkeletonVersion: 1,
  requiredEdges: [{ from: "N15" as const, to: "N17" as const }],
  campaignDailyQuestionBudget: 3,
  acceptedDateOverrides: [],
  planningHorizon: { start: "2026-08-05", end: "2026-10-30" },
  pendingPatchExists: false,
  nodeIds: ["N2" as const, "N4" as const, "N20" as const],
  userId: "user-1",
  campaignId: "campaign-1",
};

const extracted = {
  schemaVersion: 1,
  hardConstraints: ["Today is immutable."],
  userGoals: [{ id: "user-n2", topic: "Hash Map", nodeId: "N2", priority: 90, requestedGoalDepth: "mastery" }],
  permissions: { calendarOptionalLookup: false },
  horizonEnd: "2026-10-30",
  dailyCaps: [],
  assumptions: ["Observed capacity remains supported."],
  scope: "future_route",
};

const brief = {
  schemaVersion: 1,
  objective: "Preserve the user goal within supported capacity.",
  hardConstraints: ["Today is immutable."],
  softGoals: [
    { id: "system-n20", nodeId: "N20", source: "system", requestedGoalDepth: "mastery" },
    { id: "user-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
  ],
  assumptions: [{ id: "capacity", statement: "Observed capacity remains supported." }],
  degradationLadder: [
    { level: "L1", goalId: "system-n20", action: "remove_system_goal" },
    { level: "L2", goalId: "user-n2", action: "downgrade_user_goal_to_exposure" },
  ],
  candidateDimensions: ["priority", "goal depth"],
  stopCondition: "Finalize one accepted candidate or ask one question.",
};

const candidate = {
  candidateId: "candidate-a",
  nodeOperations: [{ type: "set_node_priority", nodeId: "N2", priority: 90 }],
  goalDepth: [],
  targetByDate: [],
  dailyBudgetSuggestions: [],
  rationaleSummary: "Lower the optional system goal priority.",
};

function transport(outputs: string[]): ProductionStrategistTransport & { calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn(async () => ({
    content: outputs.shift() ?? "{}",
    responseModel: "fake-strategist",
    latencyMs: 4,
    inputTokens: 10,
    outputTokens: 5,
  }));
  return { complete: calls, calls };
}

const context: StrategistRuntimeContext = {
  schemaVersion: 1,
  goal: { dailyQuestionBudget: 3, selfReportedWeakNodes: ["N2"], preferredNodes: ["N4"] },
  route: { version: 1, nodes: [] },
  recentPerformance: [],
  repairSummary: { total: 0, top: [] },
  problemSupply: [],
  planningHistory: [],
  externalPracticeSummary: { available: false, nodeCounts: [] },
  truncation: { truncated: false, droppedCounts: {} },
  contextDigest: "a".repeat(64),
};

function state(observations: StrategistRuntimeState["observations"] = []): StrategistRuntimeState {
  return {
    schemaVersion: 1,
    runtimeVersion: "plan-execute-v1",
    runMode: "proposal",
    strategyBrief: observations.length ? brief as never : null,
    resolvedConstraints: { ...extracted, deterministicFacts } as never,
    ladderState: { overturnedAssumptionIds: [] },
    ladderRevisionCount: 0,
    candidates: observations.length ? [{ candidate: candidate as never, fingerprint: "b".repeat(64), baseSkeletonVersion: 1 }] : [],
    rejectedCandidates: [],
    observations,
    selectedCandidateId: null,
    budgetSnapshot: {
      constraintExtraction: { used: 1, limit: 1 },
      plannerDecisions: { used: 1, limit: 4 },
      batchSimulations: { used: observations.length, limit: 3 },
      calendarMcp: { used: 0, limit: 1 },
      clarification: { used: 0, limit: 1 },
      ladderRevision: { used: 0, limit: 1 },
      proposalWrite: { used: 0, limit: 1 },
    },
    clarification: null,
    status: "running",
    contextDigest: "a".repeat(64),
    strategyBriefDigest: observations.length ? "c".repeat(64) : null,
  };
}

describe("ProductionStrategistPlannerProvider", () => {
  it("extracts schema-valid constraints and injects deterministic facts", async () => {
    const fake = transport([JSON.stringify(extracted)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.extractConstraints({ context, requestText: "Keep Hash Map as a mastery goal.", deterministicFacts });
    expect(result.constraints).toMatchObject({ scope: "future_route", deterministicFacts });
    expect(result.constraints.userGoals).toEqual([
      expect.objectContaining({ id: "user-n2", nodeId: "N2", requestedGoalDepth: "mastery" }),
    ]);
    expect(result.audit).toMatchObject({ modelCallCount: 1, schemaRepairCount: 0 });
    expect(fake.calls).toHaveBeenCalledTimes(1);
    expect((fake.calls.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages.at(-1)?.content)
      .toContain("OUTPUT JSON SCHEMA");
  });

  it("deduplicates and bounds repeated extraction constraint text before strict validation", async () => {
    const repeated = Array.from({ length: 24 }, (_, index) => index < 5 ? "Today is immutable." : `Constraint ${index}.`);
    const fake = transport([JSON.stringify({ ...extracted, hardConstraints: repeated })]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.extractConstraints({ context, requestText: "Plan the future route.", deterministicFacts });
    expect(result.constraints.hardConstraints).toHaveLength(20);
    expect(result.constraints.hardConstraints.filter((entry) => entry === "Today is immutable.")).toHaveLength(1);
    expect(result.audit).toMatchObject({ modelCallCount: 1, schemaRepairCount: 0 });
  });

  it("anchors an explicit future-day window after immutable Today", async () => {
    const offByOne = {
      ...extracted,
      horizonEnd: "2026-10-30",
      dailyCaps: ["2026-08-05", "2026-08-06", "2026-08-07"].map((campaignDate) => ({ campaignDate, maxQuestions: 3 })),
    };
    const fake = transport([JSON.stringify(offByOne)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.extractConstraints({
      context,
      requestText: "模拟未来三天的路线，每天最多做 3 题，不要修改今天。",
      deterministicFacts,
    });
    expect(result.constraints).toMatchObject({
      horizonEnd: "2026-08-08",
      dailyCaps: [
        { campaignDate: "2026-08-06", maxQuestions: 3 },
        { campaignDate: "2026-08-07", maxQuestions: 3 },
        { campaignDate: "2026-08-08", maxQuestions: 3 },
      ],
    });
  });

  it("disables DeepSeek V4 thinking for bounded structured Strategist output", async () => {
    const create = vi.fn(async () => ({
      model: "deepseek-v4-pro",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extracted) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const client = { baseURL: "https://api.deepseek.com", chat: { completions: { create } } };
    const provider = new ProductionStrategistPlannerProvider({ client: client as never, model: "deepseek-v4-pro" });
    await provider.extractConstraints({ context, requestText: null, deterministicFacts });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: "deepseek-v4-pro",
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
    }));
  });

  it("classifies provider failures with safe stage diagnostics", async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error("request rejected"), { status: 429, code: "rate_limit" }));
    const provider = new ProductionStrategistPlannerProvider({ transport: { complete }, model: "fake" });
    const failure = await provider.extractConstraints({ context, requestText: null, deterministicFacts }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProductionStrategistProviderError);
    expect(failure).toMatchObject({
      code: "provider_failed",
      diagnostic: {
        providerStage: "constraint_extraction",
        safeErrorCode: "http_429",
        httpStatus: 429,
        modelName: "fake",
        responseEmpty: false,
        repairAttempted: false,
      },
    });
  });

  it("overrides the model scope with deterministic Today intent classification", async () => {
    const protectedFake = transport([JSON.stringify({ ...extracted, scope: "unsupported_today_mutation" })]);
    const protectedProvider = new ProductionStrategistPlannerProvider({ transport: protectedFake, model: "fake" });
    const protectedResult = await protectedProvider.extractConstraints({
      context,
      requestText: "Do not change today's tasks; plan tomorrow and later",
      deterministicFacts,
    });
    expect(protectedResult.constraints).toMatchObject({ scope: "future_route", deterministicFacts: { todayTaskImmutable: true } });

    const mutationFake = transport([JSON.stringify({ ...extracted, scope: "future_route" })]);
    const mutationProvider = new ProductionStrategistPlannerProvider({ transport: mutationFake, model: "fake" });
    const mutationResult = await mutationProvider.extractConstraints({
      context,
      requestText: "Replace today's task",
      deterministicFacts,
    });
    expect(mutationResult.constraints).toMatchObject({ scope: "unsupported_today_mutation", deterministicFacts: { todayTaskImmutable: true } });
  });

  it("repairs malformed extraction at most once and accounts for both calls", async () => {
    const fake = transport(["not-json", JSON.stringify(extracted)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.extractConstraints({ context, requestText: null, deterministicFacts });
    expect(result.audit).toMatchObject({ modelCallCount: 2, schemaRepairCount: 1, inputTokens: 20, outputTokens: 10 });
    expect(fake.calls).toHaveBeenCalledTimes(2);
  });

  it("regenerates malformed JSON without echoing a truncated response into repair", async () => {
    const truncated = "```json\n{\"schemaVersion\":1,\"privateValue\":\"DO_NOT_ECHO\"";
    const fake = transport([truncated, JSON.stringify(extracted)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.extractConstraints({ context, requestText: null, deterministicFacts });
    expect(result.audit).toMatchObject({ modelCallCount: 2, schemaRepairCount: 1 });
    const repairMessage = (fake.calls.mock.calls[1][0] as { messages: Array<{ content: string }> }).messages.at(-1)!.content;
    expect(repairMessage).toContain("unclosed_code_fence");
    expect(repairMessage).not.toContain("DO_NOT_ECHO");
  });

  it("stops after one failed extraction repair", async () => {
    const fake = transport(["not-json", "still-not-json", JSON.stringify(extracted)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const failure = await provider.extractConstraints({ context, requestText: null, deterministicFacts }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProductionStrategistProviderError);
    expect(failure).toMatchObject({
      code: "invalid_structured_output",
      audit: { modelCallCount: 2, schemaRepairCount: 1 },
      diagnostic: { providerStage: "schema_repair", safeErrorCode: "invalid_json_after_repair", repairAttempted: true },
    });
    expect(fake.calls).toHaveBeenCalledTimes(2);
  });

  it("reports missing fields safely when planner repair remains invalid", async () => {
    const malformed = { strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [{ ...candidate, goalDepth: undefined }] } };
    const fake = transport([JSON.stringify(malformed), JSON.stringify(malformed)]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const failure = await provider.next({ context, state: state() }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProductionStrategistProviderError);
    if (!(failure instanceof ProductionStrategistProviderError)) throw new Error("Expected a ProductionStrategistProviderError.");
    expect(failure).toMatchObject({
      code: "invalid_structured_output",
      diagnostic: {
        providerStage: "schema_repair",
        safeErrorCode: "schema_validation_failed_after_repair",
        repairAttempted: true,
        schemaIssues: [expect.objectContaining({
          path: "action.candidates.0.goalDepth",
          code: "invalid_type",
          issueKind: "missing_field",
          expected: "array",
          receivedType: null,
        })],
      },
    });
    expect(JSON.stringify(failure.diagnostic)).not.toContain(candidate.rationaleSummary);
    expect(fake.calls).toHaveBeenCalledTimes(2);
  });

  it("returns one validated action and changes the next action after an Observation", async () => {
    const fake = transport([
      JSON.stringify({ strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [candidate] } }),
      JSON.stringify({ action: { type: "finalize", candidateId: "candidate-a", finalSummary: "Use the accepted simulated candidate." } }),
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const first = await provider.next({ context, state: state() });
    expect(first.output).toMatchObject({ action: { type: "simulate_campaign_plan" } });
    const observation = { observationId: "observation-1", type: "simulation" as const, candidateId: "candidate-a", candidateFingerprint: "b".repeat(64), accepted: true, rejectionCodes: [] };
    const second = await provider.next({ context, state: state([observation]) });
    expect(second.output).toMatchObject({ action: { type: "finalize", candidateId: "candidate-a" } });
    expect((fake.calls.mock.calls[1][0] as { messages: Array<{ content: string }> }).messages[1].content).toContain("observation-1");
  });

  it("keeps the three-day DP What-if candidate focused on real route changes", async () => {
    const dpContext: StrategistRuntimeContext = {
      ...context,
      goal: { dailyQuestionBudget: 5, selfReportedWeakNodes: ["N7", "N12"], preferredNodes: ["N16"] },
      route: {
        version: 1,
        nodes: ["N7", "N12", "N16", "N19", "N20"].map((nodeId, index) => ({
          nodeId,
          included: true,
          order: index + 1,
          priority: nodeId === "N19" ? 1 : 10,
          targetWeek: index + 1,
          goalDepth: "mastery",
          targetByDate: null,
          rationale: "Existing route.",
        })),
      },
      repairSummary: { total: 1, top: [{ nodeId: "N7", priority: 100, status: "scheduled" }] },
    };
    const dpConstraints = {
      ...extracted,
      userGoals: [
        { id: "goal-n19", topic: "Dynamic Programming", nodeId: "N19", priority: 100, requestedGoalDepth: "mastery" },
        { id: "goal-n20", topic: "Dynamic Programming", nodeId: "N20", priority: 90, requestedGoalDepth: "mastery" },
        { id: "campaign-goal-n7", topic: "N7", nodeId: "N7", priority: 90, requestedGoalDepth: "mastery" },
      ],
      horizonEnd: "2026-08-09",
      dailyCaps: ["2026-08-07", "2026-08-08", "2026-08-09"].map((campaignDate) => ({ campaignDate, maxQuestions: 3 })),
      deterministicFacts: {
        ...deterministicFacts,
        requiredEdges: [{ from: "N19", to: "N20" }],
        nodeIds: ["N7", "N12", "N16", "N19", "N20"],
      },
    } as StrategistRuntimeState["resolvedConstraints"];
    const allRouteCandidate = {
      candidateId: "dp-three-day",
      nodeOperations: [
        ...["N7", "N12", "N16", "N19", "N20"].map((nodeId) => ({ type: "set_node_included" as const, nodeId, included: true })),
        { type: "set_node_priority" as const, nodeId: "N7", priority: 90 },
        { type: "set_node_priority" as const, nodeId: "N19", priority: 100 },
        { type: "set_node_priority" as const, nodeId: "N20", priority: 1 },
      ],
      goalDepth: ["N7", "N12", "N16", "N19", "N20"].map((nodeId) => ({ nodeId, goalDepth: "mastery" as const })),
      targetByDate: [],
      dailyBudgetSuggestions: ["2026-08-07", "2026-08-08", "2026-08-09"].map((campaignDate) => ({ campaignDate, maxQuestions: 3, rationale: "Respect the explicit cap." })),
      rationaleSummary: "Focus on N19 and N20 without changing Today.",
    };
    const fake = transport([JSON.stringify({
      strategyBrief: { ...brief, softGoals: [], degradationLadder: [] },
      action: { type: "simulate_campaign_plan", candidates: [allRouteCandidate] },
    })]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const output = await provider.next({
      context: dpContext,
      state: {
        ...state(),
        runMode: "simulation",
        request: { text: "模拟未来三天的路线，每天最多做 3 题。\n把 N19 一维 DP 提升到当前路线的最高优先级。\n如果 N20 无法在期限内达到 mastery，就把 N20 降为 exposure。\n不要修改今天的任务，不查看日历，只做 What-if。" },
        resolvedConstraints: dpConstraints,
      },
      allowedActions: ["simulate_campaign_plan", "request_clarification", "finalize"],
    });
    const turn = strategistPlannerTurnSchema.parse(output.output);
    if (turn.action.type !== "simulate_campaign_plan") throw new Error("Expected a simulation candidate.");
    expect(turn.action.candidates[0]).toMatchObject({
      candidateId: "dp-three-day",
      nodeOperations: [
        { type: "set_node_priority", nodeId: "N19", priority: 100 },
        { type: "move_node", nodeId: "N19", beforeNodeId: "N7" },
      ],
      goalDepth: [],
    });
    expect(turn.action.candidates[0].nodeOperations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "N7" }),
      expect.objectContaining({ nodeId: "N20" }),
    ]));
  });

  it("bounds malformed action repair and reports it as a second planner model call", async () => {
    const fake = transport([
      JSON.stringify({ action: { type: "unknown" }, privateScratchpad: "DO_NOT_PERSIST" }),
      JSON.stringify({ strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [candidate] } }),
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.next({ context, state: state() });
    expect(result.output).toMatchObject({ action: { type: "simulate_campaign_plan" } });
    expect(result.audit).toMatchObject({ modelCallCount: 2, schemaRepairCount: 1 });
    expect(fake.calls).toHaveBeenCalledTimes(2);
  });

  it("normalizes fenced JSON, goal-depth enum case, and dedicated candidate dimensions without repair", async () => {
    const structurallyEquivalent = {
      strategyBrief: {
        ...brief,
        softGoals: brief.softGoals.map((goal) => ({ ...goal, requestedGoalDepth: goal.requestedGoalDepth.toUpperCase() })),
      },
      action: {
        type: "simulate_campaign_plan",
        candidates: [{
          ...candidate,
          nodeOperations: [
            ...candidate.nodeOperations,
            { type: "set_goal_depth", nodeId: "N2", goalDepth: "EXPOSURE" },
          ],
        }],
      },
    };
    const fake = transport([`\`\`\`json\n${JSON.stringify(structurallyEquivalent)}\n\`\`\``]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.next({ context, state: state() });
    expect(result.audit).toMatchObject({ modelCallCount: 1, schemaRepairCount: 0 });
    expect(result.output).toMatchObject({
      strategyBrief: { softGoals: expect.arrayContaining([expect.objectContaining({ requestedGoalDepth: "mastery" })]) },
      action: {
        type: "simulate_campaign_plan",
        candidates: [expect.objectContaining({
          nodeOperations: candidate.nodeOperations,
          goalDepth: [{ nodeId: "N2", goalDepth: "exposure" }],
        })],
      },
    });
  });

  it("canonicalizes StrategyBrief user goals and drops active-route snapshot goals", async () => {
    const snapshotBrief = {
      ...brief,
      softGoals: [
        { id: "sg1", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" },
        { id: "sg2", nodeId: "N20", source: "system", requestedGoalDepth: "mastery" },
        { id: "sg3", nodeId: "N4", source: "system", requestedGoalDepth: "mastery" },
      ],
      degradationLadder: [],
    };
    const fake = transport([JSON.stringify({ strategyBrief: snapshotBrief, action: { type: "simulate_campaign_plan", candidates: [candidate] } })]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.next({ context, state: state() });
    expect(result.output).toMatchObject({
      strategyBrief: {
        softGoals: [{ id: "user-n2", nodeId: "N2", source: "user", requestedGoalDepth: "mastery" }],
      },
    });
  });

  it("repairs a candidate that omits an explicit highest-priority target", async () => {
    const n19Context: StrategistRuntimeContext = {
      ...context,
      route: { version: 1, nodes: [{ nodeId: "N19", included: true, priority: 1, goalDepth: "mastery", targetByDate: null }] },
    };
    const n19State = {
      ...state(),
      resolvedConstraints: {
        ...extracted,
        userGoals: [{ id: "goal-n19", topic: "一维 DP", nodeId: "N19", priority: 100, requestedGoalDepth: "mastery" }],
        deterministicFacts: { ...deterministicFacts, nodeIds: ["N19"] },
      },
    } as StrategistRuntimeState;
    const n19Brief = {
      ...brief,
      softGoals: [{ id: "sg1", nodeId: "N19", source: "user", requestedGoalDepth: "mastery" }],
      degradationLadder: [],
    };
    const incomplete = { ...candidate, nodeOperations: [], goalDepth: [] };
    const corrected = { ...candidate, nodeOperations: [{ type: "set_node_priority", nodeId: "N19", priority: 100 }], goalDepth: [] };
    const fake = transport([
      JSON.stringify({ strategyBrief: n19Brief, action: { type: "simulate_campaign_plan", candidates: [incomplete] } }),
      JSON.stringify({ strategyBrief: n19Brief, action: { type: "simulate_campaign_plan", candidates: [corrected] } }),
    ]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const result = await provider.next({ context: n19Context, state: n19State });
    expect(result.audit).toMatchObject({ modelCallCount: 2, schemaRepairCount: 1 });
    expect(result.output).toMatchObject({
      strategyBrief: { softGoals: [{ id: "goal-n19", nodeId: "N19", source: "user" }] },
      action: { candidates: [expect.objectContaining({ nodeOperations: [{ type: "set_node_priority", nodeId: "N19", priority: 100 }] })] },
    });
  });

  it("does not start a schema-repair call when no planner decision remains", async () => {
    const fake = transport([JSON.stringify({ action: { type: "unknown" } }), JSON.stringify({ strategyBrief: brief, action: { type: "simulate_campaign_plan", candidates: [candidate] } })]);
    const provider = new ProductionStrategistPlannerProvider({ transport: fake, model: "fake" });
    const exhausted = state() as { budgetSnapshot: StrategistRuntimeState["budgetSnapshot"] };
    exhausted.budgetSnapshot = { ...exhausted.budgetSnapshot, plannerDecisions: { used: 4, limit: 4 } };
    await expect(provider.next({ context, state: exhausted as StrategistRuntimeState })).rejects.toBeDefined();
    expect(fake.calls).toHaveBeenCalledTimes(1);
  });
});
