import { z } from "zod";

export const SESSION_FOREGROUND_STATUSES = ["active", "closed", "abandoned"] as const;
export const SESSION_BACKGROUND_STATUSES = ["idle", "pending", "settled", "failed"] as const;
export const RUN_STATUSES = ["running", "succeeded", "failed", "degraded"] as const;
export const TRACE_COMPLETENESS_STATES = ["open", "complete", "degraded", "incomplete"] as const;
export const EVENT_KINDS = [
  "user_input",
  "workspace_snapshot",
  "llm",
  "tool",
  "runner",
  "retrieval",
  "memory",
  "guard",
  "persistence",
  "lifecycle",
  "background_job",
  "error",
] as const;
export const EVENT_STATUSES = ["started", "succeeded", "failed", "degraded", "skipped"] as const;
export const BACKGROUND_JOB_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export const BACKGROUND_JOB_FAILURE_REASONS = ["process_restart", "timeout", "error"] as const;
export const BACKGROUND_JOB_KINDS = [
  "activity_extraction",
  "chat_consolidation",
  "assisted_repair_consolidation",
  "reflection",
  "embed_backfill",
  "interview_feedback",
  "campaign_strategist",
  "operational_aggregation",
] as const;
export const PAYLOAD_STATES = ["captured", "summary_only", "pruned", "unavailable"] as const;
export const PRICING_STATUSES = ["priced", "partial", "unpriced", "not_applicable"] as const;
export const TRACE_PATHS = ["review", "chat", "practice_run", "mock_interview", "memory_background", "campaign_strategist"] as const;
export const TRACE_DETAIL_LEVELS = ["summary", "full"] as const;

export const sessionForegroundStatusSchema = z.enum(SESSION_FOREGROUND_STATUSES);
export const sessionBackgroundStatusSchema = z.enum(SESSION_BACKGROUND_STATUSES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const traceCompletenessSchema = z.enum(TRACE_COMPLETENESS_STATES);
export const eventKindSchema = z.enum(EVENT_KINDS);
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export const backgroundJobStatusSchema = z.enum(BACKGROUND_JOB_STATUSES);
export const backgroundJobFailureReasonSchema = z.enum(BACKGROUND_JOB_FAILURE_REASONS);
export const backgroundJobKindSchema = z.enum(BACKGROUND_JOB_KINDS);
export const payloadStateSchema = z.enum(PAYLOAD_STATES);
export const pricingStatusSchema = z.enum(PRICING_STATUSES);
export const tracePathSchema = z.enum(TRACE_PATHS);
export const traceDetailLevelSchema = z.enum(TRACE_DETAIL_LEVELS);

export type SessionForegroundStatus = z.infer<typeof sessionForegroundStatusSchema>;
export type SessionBackgroundStatus = z.infer<typeof sessionBackgroundStatusSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type TraceCompleteness = z.infer<typeof traceCompletenessSchema>;
export type EventStatus = z.infer<typeof eventStatusSchema>;
export type BackgroundJobStatus = z.infer<typeof backgroundJobStatusSchema>;
export type BackgroundJobFailureReason = z.infer<typeof backgroundJobFailureReasonSchema>;
export type BackgroundJobKind = z.infer<typeof backgroundJobKindSchema>;
export type PayloadState = z.infer<typeof payloadStateSchema>;
export type TracePath = z.infer<typeof tracePathSchema>;

const sessionForegroundTransitions = {
  active: ["closed", "abandoned"],
  closed: [],
  abandoned: [],
} as const satisfies Record<SessionForegroundStatus, readonly SessionForegroundStatus[]>;

const sessionBackgroundTransitions = {
  idle: ["pending", "settled"],
  pending: ["settled", "failed"],
  settled: ["pending"],
  failed: ["pending"],
} as const satisfies Record<SessionBackgroundStatus, readonly SessionBackgroundStatus[]>;

const runStatusTransitions = {
  running: ["succeeded", "failed", "degraded"],
  succeeded: ["degraded"],
  failed: ["degraded"],
  degraded: [],
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

const traceCompletenessTransitions = {
  open: ["complete", "degraded", "incomplete"],
  complete: ["degraded"],
  degraded: [],
  incomplete: [],
} as const satisfies Record<TraceCompleteness, readonly TraceCompleteness[]>;

const eventStatusTransitions = {
  started: ["succeeded", "failed", "degraded", "skipped"],
  succeeded: [],
  failed: [],
  degraded: [],
  skipped: [],
} as const satisfies Record<EventStatus, readonly EventStatus[]>;

const backgroundJobStatusTransitions = {
  pending: ["running", "failed"],
  running: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
} as const satisfies Record<BackgroundJobStatus, readonly BackgroundJobStatus[]>;

const payloadStateTransitions = {
  captured: ["pruned"],
  summary_only: ["pruned"],
  pruned: [],
  unavailable: [],
} as const satisfies Record<PayloadState, readonly PayloadState[]>;

function isAllowedTransition<T extends string>(
  transitions: Record<T, readonly T[]>,
  from: T,
  to: T,
) {
  return from === to || transitions[from].includes(to);
}

export const canTransitionSessionForegroundStatus = (from: SessionForegroundStatus, to: SessionForegroundStatus) =>
  isAllowedTransition(sessionForegroundTransitions, from, to);
export const canTransitionSessionBackgroundStatus = (from: SessionBackgroundStatus, to: SessionBackgroundStatus) =>
  isAllowedTransition(sessionBackgroundTransitions, from, to);
export const canTransitionRunStatus = (from: RunStatus, to: RunStatus) =>
  isAllowedTransition(runStatusTransitions, from, to);
export const canTransitionTraceCompleteness = (from: TraceCompleteness, to: TraceCompleteness) =>
  isAllowedTransition(traceCompletenessTransitions, from, to);
export const canTransitionEventStatus = (from: EventStatus, to: EventStatus) =>
  isAllowedTransition(eventStatusTransitions, from, to);
export const canTransitionBackgroundJobStatus = (from: BackgroundJobStatus, to: BackgroundJobStatus) =>
  isAllowedTransition(backgroundJobStatusTransitions, from, to);
export const canTransitionPayloadState = (from: PayloadState, to: PayloadState) =>
  isAllowedTransition(payloadStateTransitions, from, to);

const optionalStringArray = z.array(z.string().min(1)).optional();
const timestampSchema = z.string().datetime({ offset: true });

export const normalizedTraceEventSchema = z.object({
  identity: z.object({
    eventId: z.string().min(1),
    eventDigest: z.string().regex(/^[a-f0-9]{64}$/),
    workspaceSessionId: z.string().min(1).optional(),
    traceRunId: z.string().min(1),
    parentTraceRunId: z.string().min(1).optional(),
    turnOrdinal: z.number().int().positive().optional(),
    stepId: z.string().min(1).optional(),
    parentStepId: z.string().min(1).optional(),
    stepIndex: z.number().int().nonnegative().optional(),
    agentIteration: z.number().int().nonnegative().optional(),
  }),
  scope: z.object({
    path: tracePathSchema,
    stage: z.string().min(1),
    kind: eventKindSchema,
    title: z.string().min(1),
  }),
  lifecycle: z.object({
    status: eventStatusSchema,
    occurredAt: timestampSchema,
    clientOccurredAt: timestampSchema.optional(),
    startedAt: timestampSchema.optional(),
    endedAt: timestampSchema.optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  details: z.object({
    input: z.unknown().optional(),
    prompt: z.array(z.object({
      role: z.string(),
      content: z.unknown(),
      estimatedTokens: z.number().nonnegative().optional(),
    })).optional(),
    retrieval: z.unknown().optional(),
    output: z.unknown().optional(),
    stateDelta: z.unknown().optional(),
    memoryDelta: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  metrics: z.object({
    providerInputTokens: z.number().int().nonnegative().optional(),
    providerOutputTokens: z.number().int().nonnegative().optional(),
    providerTotalTokens: z.number().int().nonnegative().optional(),
    providerReasoningTokens: z.number().int().nonnegative().optional(),
    providerCachedTokens: z.number().int().nonnegative().optional(),
    usageSource: z.enum(["provider", "missing"]).optional(),
    usageMissingReason: z.enum(["error_response", "provider_omitted"]).optional(),
    estimatedTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    pricingVersion: z.string().min(1).optional(),
    pricingStatus: pricingStatusSchema.optional(),
    memoryRssBytes: z.number().int().nonnegative().optional(),
    memoryHeapUsedBytes: z.number().int().nonnegative().optional(),
    resourceScope: z.enum(["process_sample", "unavailable"]).optional(),
  }).optional(),
  capture: z.object({
    detailLevel: traceDetailLevelSchema,
    payloadState: payloadStateSchema,
    redactedFields: optionalStringArray,
    truncatedFields: optionalStringArray,
    unavailableFields: optionalStringArray,
  }),
});

export type NormalizedTraceEvent = z.infer<typeof normalizedTraceEventSchema>;
