import { ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
import { campaignCurriculumAssets } from "../curriculum";
import {
  DAILY_SELECTOR_VERSION,
  serializeLearnerNodeState,
  serializeProblemAvailability,
  serializeRepairQueueCandidate,
  simulateCampaignPlan,
} from "../core";
import {
  CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION,
  PRODUCTION_STRATEGIST_RUNTIME_VERSION,
  STRATEGIST_RUNTIME_SCHEMA_VERSION,
  STRATEGIST_RUNTIME_VERSION,
  canonicalStrategistJson,
  calendarFreeBusyObservationSchema,
  fingerprintStrategistCandidate,
  strategistCandidateSchema,
  strategistDigest,
  strategistPlannerTurnSchema,
  strategistResolvedConstraintsSchema,
  strategistRunModeSchema,
  strategistRuntimeVersionSchema,
  strategistStrategyBriefSchema,
  type CampaignSkeletonPatchOperation,
  type CampaignSimulationResult,
  type SimulateCampaignPlanInput,
  type StrategistCandidate,
  type StrategistRuntimeBudgetSnapshot,
  type StrategistRuntimeObservation,
  type StrategistRunMode,
  type StrategistResolvedConstraints,
  type StrategistRuntimeState,
  type StrategistRuntimeVersion,
} from "../domain";
import {
  buildCampaignProblemAvailability,
  buildExposurePlanningState,
  projectCampaignNodeState,
  projectCampaignSkeleton,
} from "./campaign-core-service";
import {
  CampaignSkeletonPatchError,
  CampaignSkeletonPatchService,
  validateStrategistPlanningProposal,
} from "./skeleton-patch-service";
import { buildStrategistRuntimeContext } from "./strategist-runtime-context";
import { ProductionStrategistProviderError } from "./production-strategist-planner-provider";
import {
  CALENDAR_MCP_DAILY_CALL_LIMIT,
  CalendarMcpError,
  type CalendarFreeBusyTool,
} from "./calendar-mcp-client";
import type {
  StrategistConstraintExtractor,
  StrategistPlannerProvider,
  StrategistPlannerProviderResponse,
  StrategistProviderAudit,
} from "./scripted-strategist-planner-provider";
import {
  appendTraceEventBestEffort,
  createTraceContext,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";

export const STRATEGIST_PLANNER_DEFAULT = 4;
export const STRATEGIST_PLANNER_HARD_MAX = 6;
const SIMULATION_DEFAULT = 3;
const SIMULATION_HARD_MAX = 5;
const CALENDAR_MCP_DEFAULT = 1;
const CALENDAR_MCP_HARD_MAX = 2;
const CALENDAR_MCP_MAX_AGENT_RANGE_DAYS = 7;
const INTERNAL_COOLDOWN_DAYS = 7;

type RuntimeStatus = "running" | "needs_clarification" | "waiting_approval" | "no_change" | "failed" | "stale" | "budget_exhausted";
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableState = Mutable<Omit<StrategistRuntimeState, "candidates" | "rejectedCandidates" | "observations" | "runMode">> & {
  readonly runMode: StrategistRunMode;
  candidates: Array<StrategistRuntimeState["candidates"][number]>;
  rejectedCandidates: Array<StrategistRuntimeState["rejectedCandidates"][number]>;
  observations: StrategistRuntimeObservation[];
};

export type StrategistRuntimeSimulation = (input: SimulateCampaignPlanInput) => CampaignSimulationResult;
export type StrategistProposalWriter = (
  input: Parameters<CampaignSkeletonPatchService["createSkeletonPatchProposal"]>[0],
) => ReturnType<CampaignSkeletonPatchService["createSkeletonPatchProposal"]>;
export type ExecuteScriptedStrategistRuntimeInput = Readonly<{
  db: PrismaClient;
  runId: string;
  provider: StrategistPlannerProvider;
  now: Date;
  campaignDate: string;
  plannerDecisionLimit?: number;
  simulationLimit?: number;
  simulationHorizon?: number;
  simulate?: StrategistRuntimeSimulation;
  runMode?: StrategistRunMode;
  proposalWriter?: StrategistProposalWriter;
  runtimeVersion?: StrategistRuntimeVersion;
  constraintExtractor?: StrategistConstraintExtractor;
  traceContext?: TraceContext;
  calendarTool?: CalendarFreeBusyTool;
  calendarMcpLimit?: number;
}>;

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDistance(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function initialBudgets(input: ExecuteScriptedStrategistRuntimeInput): StrategistRuntimeBudgetSnapshot {
  const plannerLimit = Math.min(STRATEGIST_PLANNER_HARD_MAX, Math.max(1, input.plannerDecisionLimit ?? STRATEGIST_PLANNER_DEFAULT));
  const simulationLimit = Math.min(SIMULATION_HARD_MAX, Math.max(1, input.simulationLimit ?? SIMULATION_DEFAULT));
  const calendarMcpLimit = Math.min(CALENDAR_MCP_HARD_MAX, Math.max(1, input.calendarMcpLimit ?? CALENDAR_MCP_DEFAULT));
  return {
    constraintExtraction: { used: input.constraintExtractor ? 0 : 1, limit: 1 },
    plannerDecisions: { used: 0, limit: plannerLimit },
    batchSimulations: { used: 0, limit: simulationLimit },
    calendarMcp: { used: 0, limit: calendarMcpLimit },
    clarification: { used: 0, limit: 1 },
    ladderRevision: { used: 0, limit: 1 },
    proposalWrite: { used: 0, limit: 1 },
  };
}

function incrementBudget(state: MutableState, key: keyof StrategistRuntimeBudgetSnapshot) {
  const current = state.budgetSnapshot[key];
  state.budgetSnapshot = { ...state.budgetSnapshot, [key]: { ...current, used: current.used + 1 } };
}

function candidateOperations(candidate: StrategistCandidate): CampaignSkeletonPatchOperation[] {
  return [
    ...candidate.nodeOperations,
    ...candidate.goalDepth.map((entry) => ({ type: "set_goal_depth" as const, ...entry })),
    ...candidate.targetByDate.map((entry) => ({ type: "set_target_by_date" as const, ...entry })),
  ];
}

function candidateProposal(
  candidate: StrategistCandidate,
  baseVersion: number,
  rationale = candidate.rationaleSummary,
  runtimeVersion: StrategistRuntimeVersion = STRATEGIST_RUNTIME_VERSION,
  includeDateBudgetSuggestions = true,
) {
  return {
    patchSchemaVersion: CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION,
    baseVersion,
    trigger: runtimeVersion === PRODUCTION_STRATEGIST_RUNTIME_VERSION
      ? "strategist_plan_execute_runtime"
      : "strategist_scripted_runtime",
    rationale,
    operations: candidateOperations(candidate),
    dateBudgetSuggestions: includeDateBudgetSuggestions ? candidate.dailyBudgetSuggestions : [],
  };
}

function shouldPersistDateBudgetSuggestions(state: MutableState) {
  const requestText = state.request?.text ?? "";
  const explicitlyChangesBudget = /(?:调整|修改|设置|提高|增加|降低|减少).{0,16}(?:预算|每日上限|题数上限)|(?:budget|daily\s+cap).{0,16}(?:change|set|increase|decrease)/i.test(requestText);
  const promotesWhatIf = /基于.{0,24}What-if.{0,24}结果|based\s+on.{0,24}what-if.{0,24}result/i.test(requestText);
  return explicitlyChangesBudget || !promotesWhatIf;
}

function compactComparison(result: CampaignSimulationResult, candidateId: string) {
  const candidate = result.candidates.find((entry) => entry.candidateId === candidateId);
  if (!candidate) throw new Error(`Simulator omitted candidate '${candidateId}'.`);
  return Object.fromEntries(Object.entries(candidate.branches).map(([branch, value]) => [branch, {
    violations: value.violations.map((entry) => entry.code),
    unknowns: value.unknowns.map((entry) => entry.code),
    earliestReachableDates: value.earliestReachableDates,
    days: value.internalDayProjections.map((day) => ({
      campaignDate: day.campaignDate,
      budget: day.budget,
      phase: day.phase,
      selectedNodeIds: day.projection.kind === "task" ? [...new Set(day.projection.items.map((item) => item.nodeId))].sort() : [],
      violationCodes: day.violations.map((entry) => entry.code),
      unknownCodes: day.unknowns.map((entry) => entry.code),
    })),
  }]));
}

async function buildSimulationInput(input: {
  db: PrismaClient;
  campaignId: string;
  campaignDate: string;
  candidates: readonly Readonly<{ candidateId: string; skeleton: ReturnType<typeof projectCampaignSkeleton> }>[];
  constraints: StrategistResolvedConstraints | null | undefined;
  horizonOverride?: number;
}) {
  const campaign = await input.db.campaign.findUniqueOrThrow({ where: { id: input.campaignId }, include: { goal: true } });
  if (!campaign.goal) throw new Error("Campaign Goal is required for simulation.");
  const today = await input.db.campaignDailyTask.findUnique({ where: { campaignId_campaignDate: { campaignId: input.campaignId, campaignDate: input.campaignDate } }, select: { id: true } });
  const startCampaignDate = today ? addDays(input.campaignDate, 1) : input.campaignDate;
  const campaignEndDate = campaign.goal.endDate.toISOString().slice(0, 10);
  const endDate = input.constraints?.horizonEnd && input.constraints.horizonEnd < campaignEndDate
    ? input.constraints.horizonEnd
    : campaignEndDate;
  const availableDays = dayDistance(startCampaignDate, endDate) + 1;
  if (availableDays < 1) throw new Error("No future campaign date remains for simulation.");
  const horizon = Math.min(input.horizonOverride ?? 7, availableDays);
  const explicitCaps = new Map(input.constraints?.dailyCaps.map((entry) => [entry.campaignDate, entry.maxQuestions]) ?? []);
  const [states, repairs, availability, settlements, overrides, exposure, receipts] = await Promise.all([
    input.db.campaignLearnerNodeState.findMany({ where: { campaignId: input.campaignId }, orderBy: { nodeId: "asc" } }),
    input.db.campaignRepairQueueItem.findMany({ where: { campaignId: input.campaignId, status: "pending" }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }] }),
    buildCampaignProblemAvailability(input.db, campaign.userId, new Map()),
    input.db.campaignTaskItemSettlement.findMany({ where: { taskItem: { dailyTask: { campaignId: input.campaignId } } }, include: { taskItem: true }, orderBy: [{ settledAt: "asc" }, { id: "asc" }] }),
    input.db.campaignDailyBudgetOverride.findMany({ where: { campaignId: input.campaignId }, orderBy: [{ campaignDate: "asc" }, { id: "asc" }] }),
    buildExposurePlanningState(input.db, input.campaignId, input.candidates[0].skeleton.version),
    input.db.campaignTaskReceipt.findMany({ where: { campaignId: input.campaignId }, orderBy: [{ campaignDate: "desc" }, { id: "asc" }], take: 7 }),
  ]);
  const settledCounts = receipts.map((receipt) => receipt.settledCount);
  return {
    state: {
      campaignId: input.campaignId,
      endDate,
      curriculum: campaignCurriculumAssets,
      learnerNodeStates: states.map(projectCampaignNodeState).map(serializeLearnerNodeState),
      repairQueueCandidates: repairs.map((repair) => serializeRepairQueueCandidate({ repairQueueItemId: repair.id, nodeId: repair.nodeId, priority: repair.priority, createdAt: repair.createdAt })),
      problemAvailability: availability.map(serializeProblemAvailability),
      exposurePlanning: exposure,
      acceptedDailyBudgetOverrides: overrides
        .filter((override) => !explicitCaps.has(override.campaignDate))
        .map((override) => ({ campaignDate: override.campaignDate, maxQuestions: override.maxQuestions, status: override.status as "accepted" | "expired" | "revoked", expiresAt: override.expiresAt?.toISOString() ?? null })),
      settlements: settlements.map((settlement) => ({
        settlementId: settlement.id,
        problemSlug: settlement.taskItem.problemSlug,
        nodeId: settlement.taskItem.nodeId,
        slotRole: settlement.taskItem.slotRole as "advance" | "target" | "remedial" | "probe" | "mixed",
        positiveForMastery: settlement.positiveForMastery,
        negativeOutcome: settlement.negativeOutcome,
        settledAt: settlement.settledAt.toISOString(),
      })),
    },
    candidates: input.candidates,
    startCampaignDate,
    horizon,
    dailyBudgets: Array.from({ length: horizon }, (_, index) => {
      const date = addDays(startCampaignDate, index);
      const cap = explicitCaps.get(date);
      return cap === undefined ? campaign.goal!.dailyQuestionBudget : Math.min(campaign.goal!.dailyQuestionBudget, cap);
    }),
    observedPace: {
      sampleDays: receipts.length,
      observedCapacityRange: settledCounts.length > 0 ? { min: Math.min(...settledCounts), max: Math.max(...settledCounts) } : null,
      supportedPositiveItemsByDate: [],
    },
    options: { selectorVersion: DAILY_SELECTOR_VERSION, internalCooldownDays: INTERNAL_COOLDOWN_DAYS },
  } satisfies SimulateCampaignPlanInput;
}

function resolveRunMetadata(
  runtimeStateJson: string | null,
  requestedMode: StrategistRunMode | undefined,
  requestedVersion: StrategistRuntimeVersion | undefined,
) {
  if (!runtimeStateJson) return {
    runMode: strategistRunModeSchema.parse(requestedMode),
    runtimeVersion: strategistRuntimeVersionSchema.parse(requestedVersion ?? STRATEGIST_RUNTIME_VERSION),
    persisted: null,
  };
  const parsed: unknown = JSON.parse(runtimeStateJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Persisted Strategist Runtime state must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  // Early M4D1B1 builds stored the scripted provider kind here; those were
  // formal proposal runs, so normalize them at the compatibility boundary.
  const storedMode = !Object.hasOwn(record, "runMode") || record.runMode === "scripted"
    ? strategistRunModeSchema.parse(undefined)
    : strategistRunModeSchema.parse(record.runMode);
  if (requestedMode && requestedMode !== storedMode) {
    throw new Error("A CampaignStrategistRun cannot change runMode after creation.");
  }
  const storedVersion = strategistRuntimeVersionSchema.parse(record.runtimeVersion ?? requestedVersion ?? STRATEGIST_RUNTIME_VERSION);
  if (requestedVersion && requestedVersion !== storedVersion) {
    throw new Error("A CampaignStrategistRun cannot change runtimeVersion after creation.");
  }
  return { runMode: storedMode, runtimeVersion: storedVersion, persisted: record };
}

function initialState(
  contextDigest: string,
  budgetSnapshot: StrategistRuntimeBudgetSnapshot,
  runMode: StrategistRunMode,
  runtimeVersion: StrategistRuntimeVersion,
  persisted: Record<string, unknown> | null,
): MutableState {
  return {
    schemaVersion: STRATEGIST_RUNTIME_SCHEMA_VERSION,
    runtimeVersion,
    runMode,
    resolvedConstraints: null,
    origin: persisted?.origin === "user" || persisted?.origin === "simulation" ? persisted.origin : "automatic",
    campaignDate: typeof persisted?.campaignDate === "string" ? persisted.campaignDate : undefined,
    request: persisted?.request && typeof persisted.request === "object" && !Array.isArray(persisted.request)
      && typeof (persisted.request as Record<string, unknown>).text === "string"
      ? { text: (persisted.request as Record<string, string>).text.slice(0, 2_000) }
      : null,
    clarificationResponse: null,
    providerAudit: { modelCalls: 0, schemaRepairs: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 },
    calendarObservation: null,
    calendarFailures: [],
    calendarConfirmationRequired: false,
    externalDataAsOf: null,
    externalDataValidUntil: null,
    externalSourceDigest: null,
    strategyBrief: null,
    ladderState: { overturnedAssumptionIds: [] },
    ladderRevisionCount: 0,
    candidates: [],
    rejectedCandidates: [],
    observations: [],
    selectedCandidateId: null,
    budgetSnapshot,
    clarification: null,
    status: "running",
    contextDigest,
    strategyBriefDigest: null,
  };
}

function restoreState(
  persisted: Record<string, unknown> | null,
  fallback: MutableState,
): MutableState {
  if (!persisted || !Array.isArray(persisted.candidates) || !Array.isArray(persisted.observations)
    || !persisted.budgetSnapshot || typeof persisted.budgetSnapshot !== "object"
    || typeof persisted.contextDigest !== "string") return fallback;
  const restored = structuredClone(persisted) as unknown as MutableState;
  restored.runtimeVersion = fallback.runtimeVersion;
  Object.defineProperty(restored, "runMode", { value: fallback.runMode, writable: false, enumerable: true, configurable: true });
  restored.strategyBrief = restored.strategyBrief ? strategistStrategyBriefSchema.parse(restored.strategyBrief) : null;
  restored.resolvedConstraints = restored.resolvedConstraints
    ? strategistResolvedConstraintsSchema.parse(restored.resolvedConstraints)
    : null;
  restored.candidates = restored.candidates.map((entry) => ({
    ...entry,
    candidate: strategistCandidateSchema.parse(entry.candidate),
  }));
  restored.rejectedCandidates = Array.isArray(restored.rejectedCandidates) ? restored.rejectedCandidates : [];
  restored.observations = Array.isArray(restored.observations) ? restored.observations : [];
  restored.providerAudit ??= { modelCalls: 0, schemaRepairs: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 };
  restored.budgetSnapshot = {
    ...restored.budgetSnapshot,
    calendarMcp: restored.budgetSnapshot.calendarMcp ?? { used: 0, limit: CALENDAR_MCP_DEFAULT },
  };
  restored.calendarObservation = restored.calendarObservation
    ? calendarFreeBusyObservationSchema.parse(restored.calendarObservation)
    : null;
  restored.calendarFailures = Array.isArray(restored.calendarFailures) ? restored.calendarFailures : [];
  restored.calendarConfirmationRequired ??= false;
  restored.externalDataAsOf ??= null;
  restored.externalDataValidUntil ??= null;
  restored.externalSourceDigest ??= null;
  restored.clarificationResponse ??= null;
  return restored;
}

async function persist(input: ExecuteScriptedStrategistRuntimeInput, state: MutableState, status: RuntimeStatus, extra: Record<string, unknown> = {}) {
  state.status = status;
  await input.db.campaignStrategistRun.update({ where: { id: input.runId }, data: {
    runtimeStateJson: canonicalStrategistJson(state),
    status,
    inputTokens: state.providerAudit?.inputTokens ?? null,
    outputTokens: state.providerAudit?.outputTokens ?? null,
    totalTokens: (state.providerAudit?.inputTokens ?? 0) + (state.providerAudit?.outputTokens ?? 0),
    latencyMs: state.providerAudit?.latencyMs ?? null,
    updatedAt: input.now,
    ...extra,
  } });
}

async function safeTrace(context: TraceContext | undefined, input: { stage: string; kind?: "guard" | "tool"; status?: "succeeded" | "failed"; metadata: Record<string, unknown> }) {
  if (!context) return;
  const step = startTraceStep(context, { spanKind: input.kind ?? "guard" });
  await appendTraceEventBestEffort(context, {
    step,
    stage: input.stage,
    kind: input.kind ?? "guard",
    title: `Strategist Runtime · ${input.stage}`,
    status: input.status ?? "succeeded",
    details: { metadata: input.metadata },
  });
}

function rejected(candidate: StrategistCandidate, fingerprint: string, codes: readonly string[]): StrategistRuntimeObservation {
  return { observationId: `observation-${fingerprint.slice(0, 12)}`, type: "candidate_rejected", candidateId: candidate.candidateId, candidateFingerprint: fingerprint, accepted: false, rejectionCodes: [...codes] };
}

function isProviderResponse(value: unknown): value is StrategistPlannerProviderResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.hasOwn(record, "output") && !!record.audit && typeof record.audit === "object";
}

function classifyRuntimeFailure(error: unknown) {
  if (!(error instanceof Error)) return "unknown_error";
  const known: ReadonlyArray<readonly [string, string]> = [
    ["The first planner turn must declare StrategyBrief.", "strategy_brief_missing"],
    ["StrategyBrief can only be declared once.", "strategy_brief_redeclared"],
    ["Degradation ladder can only be revised once per run.", "ladder_revision_repeated"],
    ["Ladder revision must overturn a declared assumption.", "ladder_revision_unknown_assumption"],
    ["Unsupported Strategist Runtime action.", "unsupported_runtime_action"],
    ["No future campaign date remains for simulation.", "simulation_horizon_empty"],
  ];
  return known.find(([message]) => error.message === message)?.[1] ?? error.name;
}

function applyProviderAudit(state: MutableState, value: StrategistProviderAudit) {
  const current = state.providerAudit ?? { modelCalls: 0, schemaRepairs: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 };
  state.providerAudit = {
    modelCalls: current.modelCalls + value.modelCallCount,
    schemaRepairs: current.schemaRepairs + value.schemaRepairCount,
    latencyMs: current.latencyMs + value.latencyMs,
    inputTokens: current.inputTokens + value.inputTokens,
    outputTokens: current.outputTokens + value.outputTokens,
  };
}

async function deterministicFacts(input: ExecuteScriptedStrategistRuntimeInput, run: { campaignId: string; campaign: { userId: string } }) {
  const [campaign, overrides, pending] = await Promise.all([
    input.db.campaign.findUniqueOrThrow({ where: { id: run.campaignId }, include: { goal: true } }),
    input.db.campaignDailyBudgetOverride.findMany({ where: { campaignId: run.campaignId, status: "accepted" }, orderBy: [{ campaignDate: "asc" }, { id: "asc" }] }),
    input.db.campaignSkeletonPatch.count({ where: { campaignId: run.campaignId, status: "pending" } }),
  ]);
  if (!campaign.goal) throw new Error("Campaign Goal is required for Strategist constraint extraction.");
  return strategistResolvedConstraintsSchema.shape.deterministicFacts.parse({
    todayTaskImmutable: true,
    activeCampaign: campaign.status === "active",
    activeSkeletonVersion: campaign.activeSkeletonVersion,
    requiredEdges: campaignCurriculumAssets.graph.edges
      .filter((edge) => edge.type === "required")
      .map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
    campaignDailyQuestionBudget: campaign.goal.dailyQuestionBudget,
    acceptedDateOverrides: overrides.map((entry) => ({ campaignDate: entry.campaignDate, maxQuestions: entry.maxQuestions })),
    planningHorizon: { start: input.campaignDate, end: campaign.goal.endDate.toISOString().slice(0, 10) },
    pendingPatchExists: pending > 0,
    nodeIds: campaignCurriculumAssets.graph.nodes.map((node) => node.nodeId).sort(),
    userId: run.campaign.userId,
    campaignId: run.campaignId,
  });
}

function assertBriefPreservesUserGoals(state: MutableState) {
  if (!state.strategyBrief || !state.resolvedConstraints) return;
  const briefGoals = new Map(state.strategyBrief.softGoals.map((goal) => [goal.id, goal]));
  const changed = state.resolvedConstraints.userGoals.filter((goal) => {
    const briefGoal = briefGoals.get(goal.id);
    return !briefGoal || briefGoal.source !== "user" || briefGoal.nodeId !== goal.nodeId
      || briefGoal.requestedGoalDepth !== goal.requestedGoalDepth;
  });
  if (changed.length > 0) throw new Error(`StrategyBrief omitted or changed user goals: ${changed.map((goal) => goal.id).join(",")}`);
}

function latestSimulationFailed(state: MutableState) {
  const latest = [...state.observations].reverse().find((observation) => observation.type === "simulation");
  return latest?.accepted === false;
}

function latestFailedSimulationDates(state: MutableState) {
  const latest = [...state.observations].reverse().find((observation) => observation.type === "simulation");
  if (!latest || latest.accepted || !latest.comparison || typeof latest.comparison !== "object" || Array.isArray(latest.comparison)) return [];
  const dates = new Set<string>();
  for (const branch of Object.values(latest.comparison as Record<string, unknown>)) {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue;
    const days = (branch as Record<string, unknown>).days;
    if (!Array.isArray(days)) continue;
    for (const day of days) {
      if (!day || typeof day !== "object" || Array.isArray(day)) continue;
      const campaignDate = (day as Record<string, unknown>).campaignDate;
      if (typeof campaignDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(campaignDate)) dates.add(campaignDate);
    }
  }
  return [...dates].sort();
}

function externalObservationIsFresh(state: MutableState, now: Date) {
  return !!state.externalDataValidUntil && Date.parse(state.externalDataValidUntil) > now.valueOf();
}

async function calendarCallsForCampaignDate(input: ExecuteScriptedStrategistRuntimeInput, campaignId: string) {
  const runs = await input.db.campaignStrategistRun.findMany({
    where: { campaignId, id: { not: input.runId } },
    select: { runtimeStateJson: true },
  });
  return runs.reduce((total, run) => {
    try {
      const state = run.runtimeStateJson ? JSON.parse(run.runtimeStateJson) as Record<string, unknown> : null;
      if (!state || state.campaignDate !== input.campaignDate) return total;
      const budgets = state.budgetSnapshot as Record<string, { used?: unknown }> | undefined;
      const used = budgets?.calendarMcp?.used;
      return total + (typeof used === "number" && Number.isFinite(used) ? Math.max(0, Math.trunc(used)) : 0);
    } catch {
      return total;
    }
  }, 0);
}

async function calendarGateCode(input: ExecuteScriptedStrategistRuntimeInput, state: MutableState, campaignId: string) {
  if (!input.calendarTool?.enabled) return "calendar_capability_disabled";
  const permissions = state.resolvedConstraints?.permissions;
  if (!permissions?.calendarOptionalLookup || !permissions.calendarAuthorizedRange) return "calendar_not_authorized";
  if (!latestSimulationFailed(state)) return "calendar_simulation_not_failed";
  if (state.calendarConfirmationRequired && !state.clarificationResponse) return "calendar_confirmation_required";
  if (externalObservationIsFresh(state, input.now)) return "calendar_observation_fresh";
  if (state.budgetSnapshot.calendarMcp.used >= state.budgetSnapshot.calendarMcp.limit) return "calendar_run_budget_exhausted";
  if (await calendarCallsForCampaignDate(input, campaignId) + state.budgetSnapshot.calendarMcp.used >= CALENDAR_MCP_DAILY_CALL_LIMIT) {
    return "calendar_daily_quota_exhausted";
  }
  return null;
}

function validateCalendarActionRange(state: MutableState, action: { rangeStart: string; rangeEnd: string }) {
  const authorized = state.resolvedConstraints?.permissions.calendarAuthorizedRange;
  const horizon = state.resolvedConstraints?.deterministicFacts.planningHorizon;
  const relevantDates = latestFailedSimulationDates(state);
  const rangeStart = Date.parse(action.rangeStart);
  const rangeEnd = Date.parse(action.rangeEnd);
  if (!authorized || rangeStart < Date.parse(authorized.start) || rangeEnd > Date.parse(authorized.end)) return "calendar_range_not_authorized";
  if (!horizon || rangeStart < Date.parse(`${horizon.start}T00:00:00.000Z`)
    || rangeEnd > Date.parse(`${addDays(horizon.end, 1)}T00:00:00.000Z`)) return "calendar_range_outside_planning_horizon";
  if (relevantDates.length === 0
    || rangeStart < Date.parse(`${relevantDates[0]}T00:00:00.000Z`)
    || rangeEnd > Date.parse(`${addDays(relevantDates.at(-1)!, 1)}T00:00:00.000Z`)) return "calendar_range_not_relevant";
  if (rangeEnd <= rangeStart || rangeEnd - rangeStart > CALENDAR_MCP_MAX_AGENT_RANGE_DAYS * 86_400_000) {
    return "calendar_range_not_minimal";
  }
  return null;
}

async function allowedPlannerActions(input: ExecuteScriptedStrategistRuntimeInput, state: MutableState, campaignId: string) {
  const actions: Array<"simulate_campaign_plan" | "calendar_freebusy" | "request_clarification" | "finalize"> = ["simulate_campaign_plan"];
  if (await calendarGateCode(input, state, campaignId) === null) actions.push("calendar_freebusy");
  actions.push("request_clarification");
  if (!state.calendarConfirmationRequired || !!state.clarificationResponse) actions.push("finalize");
  return actions;
}

export async function executeScriptedStrategistRuntime(input: ExecuteScriptedStrategistRuntimeInput) {
  const claimed = await input.db.campaignStrategistRun.updateMany({
    where: { id: input.runId, status: "queued", startedAt: null },
    data: { status: "running", startedAt: input.now, attemptCount: { increment: 1 }, provider: input.provider.name, modelAlias: input.provider.modelAlias },
  });
  if (claimed.count !== 1) return { kind: "not_claimed" as const };

  const run = await input.db.campaignStrategistRun.findUniqueOrThrow({ where: { id: input.runId }, include: { campaign: true } });
  const traceContext = input.traceContext ?? (run.traceRunId ? createTraceContext({ prisma: input.db, userId: run.campaign.userId, path: "campaign_strategist", task: "plan_execute_runtime", traceRunId: run.traceRunId, bufferedRecorder: false, memoryOrigin: "test" }) : undefined);
  let state: MutableState | null = null;
  try {
    const metadata = resolveRunMetadata(run.runtimeStateJson, input.runMode, input.runtimeVersion);
    const runMode = metadata.runMode;
    const [campaign, pending] = await Promise.all([
      input.db.campaign.findUniqueOrThrow({ where: { id: run.campaignId } }),
      input.db.campaignSkeletonPatch.findFirst({ where: { campaignId: run.campaignId, status: "pending" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    if (campaign.activeSkeletonVersion !== run.activeSkeletonVersion) {
      state = initialState("0".repeat(64), initialBudgets(input), runMode, metadata.runtimeVersion, metadata.persisted);
      await persist(input, state, "stale", { completedAt: input.now, errorClass: "stale_skeleton" });
      return { kind: "stale" as const, state };
    }
    if (pending) {
      state = initialState("0".repeat(64), initialBudgets(input), runMode, metadata.runtimeVersion, metadata.persisted);
      await persist(input, state, "no_change", { completedAt: input.now, errorClass: "pending_patch_exists" });
      return { kind: "pending_patch" as const, state };
    }
    const assembled = await buildStrategistRuntimeContext({ db: input.db, campaignId: run.campaignId, campaignDate: input.campaignDate });
    const fallbackState = initialState(assembled.context.contextDigest, initialBudgets(input), runMode, metadata.runtimeVersion, metadata.persisted);
    state = restoreState(metadata.persisted, fallbackState);
    if (assembled.inputDigest !== run.inputDigest) {
      await persist(input, state, "stale", { completedAt: input.now, errorClass: "stale_context" });
      return { kind: "stale" as const, state };
    }
    if (state.contextDigest !== assembled.context.contextDigest) {
      await persist(input, state, "stale", { completedAt: input.now, errorClass: "stale_context" });
      return { kind: "stale" as const, state };
    }
    state.status = "running";
    state.campaignDate ??= input.campaignDate;
    if (input.constraintExtractor && !state.resolvedConstraints) {
      if (state.budgetSnapshot.constraintExtraction.used >= state.budgetSnapshot.constraintExtraction.limit) {
        await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "constraint_extraction_budget_exhausted" });
        return { kind: "budget_exhausted" as const, state };
      }
      incrementBudget(state, "constraintExtraction");
      const extracted = await input.constraintExtractor.extractConstraints({
        context: assembled.context,
        requestText: state.request?.text ?? null,
        deterministicFacts: await deterministicFacts(input, run),
      });
      state.resolvedConstraints = extracted.constraints;
      applyProviderAudit(state, extracted.audit);
      await safeTrace(traceContext, { stage: "constraint_extraction", metadata: {
        scope: extracted.constraints.scope,
        userGoalCount: extracted.constraints.userGoals.length,
        modelCallCount: extracted.audit.modelCallCount,
        schemaRepairCount: extracted.audit.schemaRepairCount,
      } });
      if (extracted.constraints.scope !== "future_route") {
        await persist(input, state, "no_change", { completedAt: input.now, errorClass: "unsupported_scope_today_immutable", rationaleSummary: "The request targets today's immutable task." });
        return { kind: "no_change" as const, state, reasonCode: "unsupported_scope_today_immutable" as const };
      }
    }
    await persist(input, state, "running");

    while (true) {
      if (state.budgetSnapshot.plannerDecisions.used >= state.budgetSnapshot.plannerDecisions.limit) {
        await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "planner_budget_exhausted" });
        return { kind: "budget_exhausted" as const, state };
      }
      incrementBudget(state, "plannerDecisions");
      const providerResult = await input.provider.next({
        context: assembled.context,
        state: structuredClone(state),
        allowedActions: await allowedPlannerActions(input, state, run.campaignId),
      });
      const rawTurn = isProviderResponse(providerResult) ? providerResult.output : providerResult;
      if (isProviderResponse(providerResult)) {
        const additionalCalls = Math.max(0, providerResult.audit.modelCallCount - 1);
        if (state.budgetSnapshot.plannerDecisions.used + additionalCalls > state.budgetSnapshot.plannerDecisions.limit) {
          await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "planner_budget_exhausted" });
          return { kind: "budget_exhausted" as const, state };
        }
        for (let index = 0; index < additionalCalls; index += 1) incrementBudget(state, "plannerDecisions");
        applyProviderAudit(state, providerResult.audit);
        await safeTrace(traceContext, { stage: "planner_decision", metadata: {
          modelCallCount: providerResult.audit.modelCallCount,
          schemaRepairCount: providerResult.audit.schemaRepairCount,
          latencyMs: providerResult.audit.latencyMs,
          budget: state.budgetSnapshot,
        } });
      }
      const parsed = strategistPlannerTurnSchema.safeParse(rawTurn);
      if (!parsed.success) {
        await safeTrace(traceContext, { stage: "invalid_action", status: "failed", metadata: { code: "invalid_action_schema", issueCodes: parsed.error.issues.map((issue) => issue.code) } });
        await persist(input, state, "failed", { completedAt: input.now, errorClass: "invalid_action_schema" });
        return { kind: "failed" as const, state, errorClass: "invalid_action_schema" };
      }
      const turn = parsed.data;
      if (!state.strategyBrief) {
        if (!turn.strategyBrief) throw new Error("The first planner turn must declare StrategyBrief.");
        state.strategyBrief = turn.strategyBrief;
        state.strategyBriefDigest = strategistDigest(turn.strategyBrief);
        assertBriefPreservesUserGoals(state);
      } else if (turn.strategyBrief) {
        throw new Error("StrategyBrief can only be declared once.");
      }

      if (turn.action.type === "calendar_freebusy") {
        const gateCode = await calendarGateCode(input, state, run.campaignId)
          ?? validateCalendarActionRange(state, turn.action);
        if (gateCode) {
          state.calendarFailures = [...(state.calendarFailures ?? []), { code: gateCode, occurredAt: input.now.toISOString() }];
          await safeTrace(traceContext, { stage: "calendar_freebusy_blocked", metadata: { code: gateCode, budget: state.budgetSnapshot } });
          await persist(input, state, "running");
          continue;
        }
        incrementBudget(state, "calendarMcp");
        try {
          const observation = calendarFreeBusyObservationSchema.parse(await input.calendarTool!.query({
            rangeStart: turn.action.rangeStart,
            rangeEnd: turn.action.rangeEnd,
          }));
          state.calendarObservation = observation;
          state.externalDataAsOf = observation.asOf;
          state.externalDataValidUntil = observation.validUntil;
          state.externalSourceDigest = observation.sourceDigest;
          state.calendarConfirmationRequired = !state.clarificationResponse;
          await safeTrace(traceContext, {
            stage: "calendar_freebusy",
            kind: "tool",
            metadata: {
              rangeStart: turn.action.rangeStart,
              rangeEnd: turn.action.rangeEnd,
              observation,
              budget: state.budgetSnapshot,
            },
          });
        } catch (error) {
          const code = error instanceof CalendarMcpError ? error.code : error instanceof ZodError ? "calendar_mcp_invalid_response" : "calendar_mcp_failed";
          state.calendarFailures = [...(state.calendarFailures ?? []), { code, occurredAt: input.now.toISOString() }];
          await safeTrace(traceContext, { stage: "calendar_freebusy_failed", kind: "tool", status: "failed", metadata: { code, budget: state.budgetSnapshot } });
        }
        await persist(input, state, "running");
        continue;
      }

      if (turn.action.type === "request_clarification") {
        if (state.budgetSnapshot.clarification.used >= state.budgetSnapshot.clarification.limit) {
          await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "clarification_budget_exhausted" });
          return { kind: "budget_exhausted" as const, state };
        }
        incrementBudget(state, "clarification");
        state.clarification = { question: turn.action.question, knownFacts: turn.action.knownFacts, tradeoff: turn.action.tradeoff };
        await safeTrace(traceContext, { stage: "request_clarification", metadata: { question: turn.action.question, knownFactCount: turn.action.knownFacts.length, tradeoff: turn.action.tradeoff, budget: state.budgetSnapshot } });
        await persist(input, state, "needs_clarification", { completedAt: input.now });
        return { kind: "needs_clarification" as const, state };
      }

      if (turn.action.type === "simulate_campaign_plan") {
        const action = turn.action;
        if (state.calendarConfirmationRequired && !state.clarificationResponse) {
          const code = "calendar_confirmation_required";
          state.calendarFailures = [...(state.calendarFailures ?? []), { code, occurredAt: input.now.toISOString() }];
          await safeTrace(traceContext, { stage: "calendar_candidate_blocked", metadata: { code, budget: state.budgetSnapshot } });
          await persist(input, state, "running");
          continue;
        }
        if (action.ladderRevision) {
          if (state.ladderRevisionCount >= 1) throw new Error("Degradation ladder can only be revised once per run.");
          const assumption = state.strategyBrief.assumptions.find((entry) => entry.id === action.ladderRevision!.overturnedAssumptionId);
          if (!assumption) throw new Error("Ladder revision must overturn a declared assumption.");
          state.strategyBrief = strategistStrategyBriefSchema.parse({ ...state.strategyBrief, degradationLadder: action.ladderRevision.degradationLadder });
          state.strategyBriefDigest = strategistDigest(state.strategyBrief);
          state.ladderRevisionCount += 1;
          state.ladderState = { overturnedAssumptionIds: [...state.ladderState.overturnedAssumptionIds, assumption.id] };
          incrementBudget(state, "ladderRevision");
        }
        const activeSkeletonRecord = await input.db.campaignSkeleton.findUniqueOrThrow({
          where: { campaignId_version: { campaignId: run.campaignId, version: run.activeSkeletonVersion } },
          include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
        });
        const activeSkeletonProjection = projectCampaignSkeleton(activeSkeletonRecord);
        const validatedCandidates: Array<Readonly<{ candidate: StrategistCandidate; fingerprint: string; skeleton: ReturnType<typeof projectCampaignSkeleton>; externalSourceDigest: string | null }>> = [];
        const explicitDailyCaps = new Set(state.resolvedConstraints?.dailyCaps.map((cap) => cap.campaignDate) ?? []);
        for (const candidate of action.candidates) {
          const fingerprint = fingerprintStrategistCandidate(candidate);
          const duplicate = state.observations.find((observation) => observation.candidateFingerprint === fingerprint);
          if (duplicate) {
            state.observations.push({ ...duplicate, observationId: `observation-${state.observations.length + 1}`, type: "duplicate_candidate", candidateId: candidate.candidateId });
            await safeTrace(traceContext, { stage: "duplicate_candidate", metadata: { candidateId: candidate.candidateId, candidateFingerprint: fingerprint, budget: state.budgetSnapshot } });
            continue;
          }
          if (state.calendarObservation && candidate.dailyBudgetSuggestions.some((suggestion) => explicitDailyCaps.has(suggestion.campaignDate))) {
            const codes = ["calendar_explicit_daily_cap_protected"];
            const observation = rejected(candidate, fingerprint, codes);
            state.observations.push(observation);
            state.rejectedCandidates.push({ candidateId: candidate.candidateId, fingerprint, codes });
            await safeTrace(traceContext, { stage: "candidate_rejected", metadata: { candidateId: candidate.candidateId, candidateFingerprint: fingerprint, rejectionCodes: codes, budget: state.budgetSnapshot } });
            continue;
          }
          const proposal = candidateProposal(candidate, run.activeSkeletonVersion, candidate.rationaleSummary, state.runtimeVersion);
          const validation = await validateStrategistPlanningProposal({ db: input.db, userId: run.campaign.userId, campaignId: run.campaignId, proposal, now: input.now });
          if (!validation.valid || !validation.resultingSkeletonPreview) {
            const codes = validation.errors.map((error) => error.code);
            const observation = rejected(candidate, fingerprint, codes);
            state.observations.push(observation);
            state.rejectedCandidates.push({ candidateId: candidate.candidateId, fingerprint, codes });
            await safeTrace(traceContext, { stage: "candidate_rejected", metadata: { candidateId: candidate.candidateId, candidateFingerprint: fingerprint, rejectionCodes: codes, budget: state.budgetSnapshot } });
            continue;
          }
          if (candidate.dailyBudgetSuggestions.length === 0
            && canonicalStrategistJson(validation.resultingSkeletonPreview) === canonicalStrategistJson(activeSkeletonProjection)) {
            const codes = ["no_meaningful_change"];
            const observation = rejected(candidate, fingerprint, codes);
            state.observations.push(observation);
            state.rejectedCandidates.push({ candidateId: candidate.candidateId, fingerprint, codes });
            await safeTrace(traceContext, { stage: "candidate_rejected", metadata: { candidateId: candidate.candidateId, candidateFingerprint: fingerprint, rejectionCodes: codes, budget: state.budgetSnapshot } });
            continue;
          }
          validatedCandidates.push({
            candidate,
            fingerprint,
            skeleton: validation.resultingSkeletonPreview,
            externalSourceDigest: state.calendarObservation && state.clarificationResponse && candidate.dailyBudgetSuggestions.length > 0
              ? state.externalSourceDigest ?? null
              : null,
          });
        }
        if (validatedCandidates.length > 0) {
          if (state.budgetSnapshot.batchSimulations.used >= state.budgetSnapshot.batchSimulations.limit) {
            await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "simulation_budget_exhausted" });
            return { kind: "budget_exhausted" as const, state };
          }
          incrementBudget(state, "batchSimulations");
          const simulationInput = await buildSimulationInput({
            db: input.db,
            campaignId: run.campaignId,
            campaignDate: input.campaignDate,
            candidates: validatedCandidates.map((entry) => ({ candidateId: entry.candidate.candidateId, skeleton: entry.skeleton })),
            constraints: state.resolvedConstraints,
            horizonOverride: input.simulationHorizon,
          });
          const result = (input.simulate ?? simulateCampaignPlan)(simulationInput);
          for (const { candidate, fingerprint, externalSourceDigest } of validatedCandidates) {
            const comparison = compactComparison(result, candidate.candidateId);
            const candidateResult = result.candidates.find((entry) => entry.candidateId === candidate.candidateId);
            if (!candidateResult) throw new Error(`Simulator omitted candidate '${candidate.candidateId}'.`);
            const violationCodes = [...new Set(Object.values(candidateResult.branches).flatMap((branch) => branch.violations.map((violation) => violation.code)))].sort();
            const observation: StrategistRuntimeObservation = { observationId: `observation-${state.observations.length + 1}`, type: "simulation", candidateId: candidate.candidateId, candidateFingerprint: fingerprint, accepted: violationCodes.length === 0, rejectionCodes: violationCodes, comparison };
            state.candidates.push({ candidate, fingerprint, baseSkeletonVersion: run.activeSkeletonVersion, externalSourceDigest });
            if (externalSourceDigest) state.calendarConfirmationRequired = false;
            state.observations.push(observation);
            if (!observation.accepted) state.rejectedCandidates.push({ candidateId: candidate.candidateId, fingerprint, codes: violationCodes });
            await safeTrace(traceContext, { stage: "simulate_campaign_plan", kind: "tool", metadata: { candidateId: candidate.candidateId, candidateFingerprint: fingerprint, accepted: observation.accepted, rejectionCodes: violationCodes, budget: state.budgetSnapshot } });
          }
        }
        await persist(input, state, "running");
        continue;
      }

      if (turn.action.type !== "finalize") throw new Error("Unsupported Strategist Runtime action.");
      const finalAction = turn.action;
      const selected = state.candidates.find((entry) => entry.candidate.candidateId === finalAction.candidateId);
      if (!selected || state.rejectedCandidates.some((entry) => entry.fingerprint === selected.fingerprint)) {
        const code = selected ? "candidate_rejected" : "unknown_candidate";
        await safeTrace(traceContext, { stage: "finalize_rejected", status: "failed", metadata: { candidateId: finalAction.candidateId, code, budget: state.budgetSnapshot } });
        const placeholder: StrategistCandidate = selected?.candidate ?? { candidateId: finalAction.candidateId, nodeOperations: [], goalDepth: [], targetByDate: [], dailyBudgetSuggestions: [], rationaleSummary: finalAction.finalSummary };
        state.observations.push(rejected(placeholder, selected?.fingerprint ?? "0".repeat(64), [code]));
        await persist(input, state, "failed", { completedAt: input.now, errorClass: `finalize_${code}` });
        return { kind: "failed" as const, state, errorClass: `finalize_${code}` };
      }
      if (state.runMode === "simulation") {
        const errorClass = "simulation_mode_proposal_forbidden";
        state.selectedCandidateId = selected.candidate.candidateId;
        await safeTrace(traceContext, {
          stage: "simulation_finalize_blocked",
          status: "failed",
          metadata: {
            candidateId: selected.candidate.candidateId,
            candidateFingerprint: selected.fingerprint,
            errorClass,
            budget: state.budgetSnapshot,
          },
        });
        await persist(input, state, "no_change", { completedAt: input.now, errorClass });
        return { kind: "simulation_complete" as const, state, errorClass };
      }
      if (selected.externalSourceDigest && (selected.externalSourceDigest !== state.externalSourceDigest
        || !externalObservationIsFresh(state, input.now))) {
        const errorClass = "stale_external_observation";
        await safeTrace(traceContext, { stage: "finalize_external_data_stale", status: "failed", metadata: {
          candidateId: selected.candidate.candidateId,
          candidateFingerprint: selected.fingerprint,
          externalSourceDigest: selected.externalSourceDigest,
          externalDataValidUntil: state.externalDataValidUntil,
          errorClass,
        } });
        await persist(input, state, "stale", { completedAt: input.now, errorClass });
        return { kind: "stale_external_data" as const, state, errorClass };
      }
      const freshCampaign = await input.db.campaign.findUniqueOrThrow({ where: { id: run.campaignId } });
      if (freshCampaign.activeSkeletonVersion !== selected.baseSkeletonVersion) {
        await persist(input, state, "stale", { completedAt: input.now, errorClass: "stale_skeleton" });
        return { kind: "stale" as const, state };
      }
      const freshContext = await buildStrategistRuntimeContext({ db: input.db, campaignId: run.campaignId, campaignDate: input.campaignDate });
      if (freshContext.context.contextDigest !== state.contextDigest) {
        await persist(input, state, "stale", { completedAt: input.now, errorClass: "stale_context" });
        return { kind: "stale" as const, state };
      }
      if (await input.db.campaignSkeletonPatch.count({ where: { campaignId: run.campaignId, status: "pending" } })) {
        await persist(input, state, "no_change", { completedAt: input.now, errorClass: "pending_patch_exists" });
        return { kind: "pending_patch" as const, state };
      }
      if (state.budgetSnapshot.proposalWrite.used >= state.budgetSnapshot.proposalWrite.limit) {
        await persist(input, state, "budget_exhausted", { completedAt: input.now, errorClass: "proposal_budget_exhausted" });
        return { kind: "budget_exhausted" as const, state };
      }
      const finalProposal = candidateProposal(
        selected.candidate,
        selected.baseSkeletonVersion,
        finalAction.finalSummary,
        state.runtimeVersion,
        shouldPersistDateBudgetSuggestions(state),
      );
      const finalValidation = await validateStrategistPlanningProposal({ db: input.db, userId: run.campaign.userId, campaignId: run.campaignId, proposal: finalProposal, now: input.now });
      if (!finalValidation.valid) {
        const codes = finalValidation.errors.map((error) => error.code);
        state.rejectedCandidates.push({ candidateId: selected.candidate.candidateId, fingerprint: selected.fingerprint, codes });
        state.observations.push(rejected(selected.candidate, selected.fingerprint, codes));
        await persist(input, state, "failed", { completedAt: input.now, errorClass: "finalize_policy_rejected" });
        return { kind: "failed" as const, state, errorClass: "finalize_policy_rejected" };
      }
      incrementBudget(state, "proposalWrite");
      const proposalWriter = input.proposalWriter ?? ((proposalInput) =>
        new CampaignSkeletonPatchService(input.db, { now: () => input.now }).createSkeletonPatchProposal(proposalInput));
      const proposalResult = await proposalWriter({ userId: run.campaign.userId, campaignId: run.campaignId, proposal: finalProposal });
      state.selectedCandidateId = selected.candidate.candidateId;
      await safeTrace(traceContext, { stage: "finalize", metadata: { candidateId: selected.candidate.candidateId, candidateFingerprint: selected.fingerprint, proposalPatchId: proposalResult.patch.id, publicDecisionSummary: finalAction.finalSummary, budget: state.budgetSnapshot } });
      await persist(input, state, "waiting_approval", { completedAt: input.now, proposalPatchId: proposalResult.patch.id, rationaleSummary: finalAction.finalSummary, outputDigest: strategistDigest(finalProposal) });
      return { kind: "waiting_approval" as const, state, patch: proposalResult.patch };
    }
  } catch (error) {
    if (state && error instanceof ProductionStrategistProviderError) {
      const additionalPlannerCalls = state.budgetSnapshot.constraintExtraction.used === 1 && !state.resolvedConstraints
        ? 0
        : Math.max(0, error.audit.modelCallCount - 1);
      for (let index = 0; index < additionalPlannerCalls
        && state.budgetSnapshot.plannerDecisions.used < state.budgetSnapshot.plannerDecisions.limit; index += 1) {
        incrementBudget(state, "plannerDecisions");
      }
      applyProviderAudit(state, error.audit);
      console.error("Production Strategist provider failure.", error.diagnostic);
    }
    const errorClass = error instanceof ProductionStrategistProviderError ? error.code
      : error instanceof ZodError ? "invalid_action_schema"
      : error instanceof CampaignSkeletonPatchError ? error.code
      : classifyRuntimeFailure(error);
    await safeTrace(traceContext, {
      stage: "runtime_failed",
      status: "failed",
      metadata: {
        errorClass,
        ...(error instanceof ProductionStrategistProviderError ? error.diagnostic : {}),
      },
    });
    if (state) {
      await persist(input, state, "failed", { completedAt: input.now, errorClass });
    } else {
      await input.db.campaignStrategistRun.update({
        where: { id: input.runId },
        data: { status: "failed", completedAt: input.now, errorClass, updatedAt: input.now },
      });
    }
    return { kind: "failed" as const, state: state ?? undefined, errorClass };
  }
}

/** The B1 scripted executor and B2 production executor intentionally share the
 * same bounded action loop; only their providers and explicit runtime versions differ. */
export const executeStrategistPlanExecuteRuntime = executeScriptedStrategistRuntime;
