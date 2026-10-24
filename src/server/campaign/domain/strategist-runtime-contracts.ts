import { createHash } from "node:crypto";
import { z } from "zod";
import { campaignDateSchema, campaignNodeIdSchema } from "./contracts";
import {
  CAMPAIGN_PATCH_MAX_OPERATIONS,
  CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH,
  campaignGoalDepthSchema,
  campaignSkeletonPatchOperationSchema,
  canonicalJson,
  dateBudgetSuggestionSchema,
} from "./skeleton-patch-contracts";

export const STRATEGIST_RUNTIME_SCHEMA_VERSION = 1 as const;
export const STRATEGIST_RUNTIME_VERSION = "scripted-plan-execute-v1";
export const PRODUCTION_STRATEGIST_RUNTIME_VERSION = "plan-execute-v1";
export const strategistRuntimeVersionSchema = z.enum([
  STRATEGIST_RUNTIME_VERSION,
  PRODUCTION_STRATEGIST_RUNTIME_VERSION,
]);
export type StrategistRuntimeVersion = z.infer<typeof strategistRuntimeVersionSchema>;
/** runMode describes the immutable purpose of the run, not the currently
 * executing tool or action. */
export const strategistRunModeSchema = z.enum(["proposal", "simulation"]).default("proposal");
export type StrategistRunMode = z.infer<typeof strategistRunModeSchema>;
export const STRATEGIST_RUNTIME_CONTEXT_MAX_CHARS = 20_000;
export const STRATEGIST_RUNTIME_NODE_LIMIT = 20;
export const STRATEGIST_RUNTIME_REPAIR_LIMIT = 10;

const publicText = z.string().trim().min(1).max(CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const isoDateTime = z.string().datetime({ offset: true });

export const strategistSoftGoalSchema = z.object({
  id: z.string().trim().min(1).max(100),
  nodeId: campaignNodeIdSchema,
  source: z.enum(["user", "system"]),
  requestedGoalDepth: campaignGoalDepthSchema,
}).strict();

export const strategistAssumptionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  statement: publicText,
}).strict();

export const strategistDegradationStepSchema = z.object({
  level: z.enum(["L1", "L2"]),
  goalId: z.string().trim().min(1).max(100),
  action: z.enum(["remove_system_goal", "downgrade_user_goal_to_exposure"]),
}).strict();

export const strategistStrategyBriefSchema = z.object({
  schemaVersion: z.literal(STRATEGIST_RUNTIME_SCHEMA_VERSION),
  objective: publicText,
  hardConstraints: z.array(publicText).max(20),
  softGoals: z.array(strategistSoftGoalSchema).max(20),
  assumptions: z.array(strategistAssumptionSchema).max(20),
  degradationLadder: z.array(strategistDegradationStepSchema).max(20),
  candidateDimensions: z.array(publicText).max(20),
  stopCondition: publicText,
}).strict().superRefine((brief, context) => {
  const goals = new Map(brief.softGoals.map((goal) => [goal.id, goal]));
  for (const [index, step] of brief.degradationLadder.entries()) {
    const goal = goals.get(step.goalId);
    if (!goal) {
      context.addIssue({ code: "custom", path: ["degradationLadder", index, "goalId"], message: "Ladder step must reference a declared soft goal." });
    } else if (step.action === "remove_system_goal" && goal.source !== "system") {
      context.addIssue({ code: "custom", path: ["degradationLadder", index, "action"], message: "Only a system goal may be removed." });
    } else if (step.action === "downgrade_user_goal_to_exposure" && (goal.source !== "user" || goal.requestedGoalDepth !== "mastery")) {
      context.addIssue({ code: "custom", path: ["degradationLadder", index, "action"], message: "L2 may only downgrade a user mastery goal to exposure." });
    }
  }
  const firstL2 = brief.degradationLadder.findIndex((step) => step.level === "L2");
  if (firstL2 >= 0 && brief.degradationLadder.slice(firstL2 + 1).some((step) => step.level === "L1")) {
    context.addIssue({ code: "custom", path: ["degradationLadder"], message: "L1 system-goal removal must precede L2 user-goal downgrade." });
  }
});
export type StrategistStrategyBrief = z.infer<typeof strategistStrategyBriefSchema>;

const candidateNodeOperationSchema = campaignSkeletonPatchOperationSchema.refine(
  (operation) => operation.type !== "set_goal_depth" && operation.type !== "set_target_by_date",
  { message: "goalDepth and targetByDate use their dedicated candidate dimensions" },
);

export const strategistCandidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(100),
  nodeOperations: z.array(candidateNodeOperationSchema).max(CAMPAIGN_PATCH_MAX_OPERATIONS),
  goalDepth: z.array(z.object({ nodeId: campaignNodeIdSchema, goalDepth: campaignGoalDepthSchema }).strict()).max(20),
  targetByDate: z.array(z.object({ nodeId: campaignNodeIdSchema, targetByDate: campaignDateSchema.nullable() }).strict()).max(20),
  dailyBudgetSuggestions: z.array(dateBudgetSuggestionSchema).max(90),
  rationaleSummary: publicText,
}).strict().superRefine((candidate, context) => {
  for (const [key, values] of [["goalDepth", candidate.goalDepth], ["targetByDate", candidate.targetByDate]] as const) {
    const seen = new Set<string>();
    values.forEach((entry, index) => {
      if (seen.has(entry.nodeId)) context.addIssue({ code: "custom", path: [key, index, "nodeId"], message: "Candidate dimensions cannot repeat a node." });
      seen.add(entry.nodeId);
    });
  }
});
export type StrategistCandidate = z.infer<typeof strategistCandidateSchema>;

export function fingerprintStrategistCandidate(candidate: StrategistCandidate): string {
  const goalDepth = [...candidate.goalDepth].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const targetByDate = [...candidate.targetByDate].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const dailyBudgetSuggestions = [...candidate.dailyBudgetSuggestions].sort((left, right) => left.campaignDate.localeCompare(right.campaignDate));
  return createHash("sha256").update([
    canonicalJson(candidate.nodeOperations),
    canonicalJson(goalDepth),
    canonicalJson(targetByDate),
    canonicalJson(dailyBudgetSuggestions),
  ].join("")).digest("hex");
}

const strategyBriefEnvelope = z.object({ strategyBrief: strategistStrategyBriefSchema.optional() }).strict();
const ladderRevisionSchema = z.object({
  overturnedAssumptionId: z.string().trim().min(1).max(100),
  degradationLadder: z.array(strategistDegradationStepSchema).max(20),
  publicSummary: publicText,
}).strict();

export const strategistPlannerActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simulate_campaign_plan"),
    candidates: z.array(strategistCandidateSchema).min(1).max(3),
    ladderRevision: ladderRevisionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("calendar_freebusy"),
    rangeStart: isoDateTime,
    rangeEnd: isoDateTime,
    purpose: z.literal("find_optional_relaxation"),
  }).strict(),
  z.object({
    type: z.literal("request_clarification"),
    question: publicText,
    knownFacts: z.array(publicText).min(1).max(10),
    tradeoff: publicText,
  }).strict(),
  z.object({
    type: z.literal("finalize"),
    candidateId: z.string().trim().min(1).max(100),
    finalSummary: publicText,
  }).strict(),
]);

export const strategistPlannerTurnSchema = z.object({
  strategyBrief: strategyBriefEnvelope.shape.strategyBrief,
  action: strategistPlannerActionSchema,
}).strict();
export type StrategistPlannerTurn = z.infer<typeof strategistPlannerTurnSchema>;

export const calendarFreeBusyIntervalSchema = z.object({
  start: isoDateTime,
  end: isoDateTime,
}).strict().refine((interval) => Date.parse(interval.end) > Date.parse(interval.start), {
  message: "Calendar interval end must be after start.",
});

export const calendarFreeBusyQuerySchema = z.object({
  rangeStart: isoDateTime,
  rangeEnd: isoDateTime,
}).strict().refine((query) => Date.parse(query.rangeEnd) > Date.parse(query.rangeStart), {
  message: "Calendar query end must be after start.",
});
export type CalendarFreeBusyQuery = z.infer<typeof calendarFreeBusyQuerySchema>;

export const calendarFreeBusyObservationSchema = z.object({
  busyIntervals: z.array(calendarFreeBusyIntervalSchema).max(200),
  freeIntervals: z.array(calendarFreeBusyIntervalSchema).max(200),
  allDay: z.array(campaignDateSchema).max(31),
  asOf: isoDateTime,
  validUntil: isoDateTime,
  providerScope: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/),
  sourceDigest: digest,
}).strict();
export type CalendarFreeBusyObservation = z.infer<typeof calendarFreeBusyObservationSchema>;

export const strategistResolvedConstraintsSchema = z.object({
  schemaVersion: z.literal(STRATEGIST_RUNTIME_SCHEMA_VERSION),
  hardConstraints: z.array(publicText).max(20),
  userGoals: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    topic: z.string().trim().min(1).max(100),
    nodeId: campaignNodeIdSchema,
    priority: z.number().int().min(1).max(100),
    requestedGoalDepth: campaignGoalDepthSchema,
  }).strict()).max(20),
  permissions: z.object({
    calendarOptionalLookup: z.boolean(),
    calendarAuthorizedRange: z.object({ start: isoDateTime, end: isoDateTime }).strict().nullable().optional(),
  }).strict(),
  horizonEnd: campaignDateSchema.nullable(),
  dailyCaps: z.array(z.object({ campaignDate: campaignDateSchema, maxQuestions: z.number().int().min(3) }).strict()).max(90),
  assumptions: z.array(publicText).max(20),
  scope: z.enum(["future_route", "unsupported_today_mutation"]),
  deterministicFacts: z.object({
    todayTaskImmutable: z.literal(true),
    activeCampaign: z.boolean(),
    activeSkeletonVersion: z.number().int().positive(),
    requiredEdges: z.array(z.object({ from: campaignNodeIdSchema, to: campaignNodeIdSchema }).strict()),
    campaignDailyQuestionBudget: z.number().int().min(3),
    acceptedDateOverrides: z.array(z.object({ campaignDate: campaignDateSchema, maxQuestions: z.number().int().min(3) }).strict()),
    planningHorizon: z.object({ start: campaignDateSchema, end: campaignDateSchema }).strict(),
    pendingPatchExists: z.boolean(),
    nodeIds: z.array(campaignNodeIdSchema),
    userId: z.string().min(1),
    campaignId: z.string().min(1),
  }).strict(),
}).strict();
export type StrategistResolvedConstraints = z.infer<typeof strategistResolvedConstraintsSchema>;

export type StrategistRuntimeBudgetSnapshot = Readonly<{
  constraintExtraction: Readonly<{ used: number; limit: 1 }>;
  plannerDecisions: Readonly<{ used: number; limit: number }>;
  batchSimulations: Readonly<{ used: number; limit: number }>;
  calendarMcp: Readonly<{ used: number; limit: number }>;
  clarification: Readonly<{ used: number; limit: 1 }>;
  ladderRevision: Readonly<{ used: number; limit: 1 }>;
  proposalWrite: Readonly<{ used: number; limit: 1 }>;
}>;

export type StrategistRuntimeObservation = Readonly<{
  observationId: string;
  type: "simulation" | "duplicate_candidate" | "candidate_rejected";
  candidateId: string;
  candidateFingerprint: string;
  accepted: boolean;
  rejectionCodes: readonly string[];
  comparison?: unknown;
}>;

export type StrategistRuntimeState = Readonly<{
  schemaVersion: typeof STRATEGIST_RUNTIME_SCHEMA_VERSION;
  runtimeVersion: StrategistRuntimeVersion;
  /** Immutable for the lifetime of one CampaignStrategistRun. */
  runMode: StrategistRunMode;
  strategyBrief: StrategistStrategyBrief | null;
  resolvedConstraints?: StrategistResolvedConstraints | null;
  origin?: "automatic" | "user" | "simulation";
  campaignDate?: string;
  request?: Readonly<{ text: string }> | null;
  clarificationResponse?: Readonly<{ answer: string; answeredAt: string }> | null;
  providerAudit?: Readonly<{ modelCalls: number; schemaRepairs: number; latencyMs: number; inputTokens: number; outputTokens: number }>;
  ladderState: Readonly<{ overturnedAssumptionIds: readonly string[] }>;
  ladderRevisionCount: number;
  candidates: readonly Readonly<{ candidate: StrategistCandidate; fingerprint: string; baseSkeletonVersion: number; externalSourceDigest?: string | null }> [];
  rejectedCandidates: readonly Readonly<{ candidateId: string; fingerprint: string; codes: readonly string[] }> [];
  observations: readonly StrategistRuntimeObservation[];
  calendarObservation?: CalendarFreeBusyObservation | null;
  calendarFailures?: readonly Readonly<{ code: string; occurredAt: string }>[];
  calendarConfirmationRequired?: boolean;
  externalDataAsOf?: string | null;
  externalDataValidUntil?: string | null;
  externalSourceDigest?: string | null;
  selectedCandidateId: string | null;
  budgetSnapshot: StrategistRuntimeBudgetSnapshot;
  clarification: Readonly<{ question: string; knownFacts: readonly string[]; tradeoff: string }> | null;
  status: string;
  contextDigest: string;
  strategyBriefDigest: string | null;
}>;

export type StrategistRuntimeContext = Readonly<{
  schemaVersion: typeof STRATEGIST_RUNTIME_SCHEMA_VERSION;
  goal: unknown;
  route: unknown;
  recentPerformance: unknown;
  repairSummary: unknown;
  problemSupply: unknown;
  planningHistory: unknown;
  externalPracticeSummary: unknown;
  truncation: Readonly<{ truncated: boolean; droppedCounts: Readonly<Record<string, number>> }>;
  contextDigest: string;
}>;

export const strategistDigestSchema = digest;
