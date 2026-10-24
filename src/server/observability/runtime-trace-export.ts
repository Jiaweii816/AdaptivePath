import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  normalizedTraceEventSchema,
  pricingStatusSchema,
  runStatusSchema,
  traceCompletenessSchema,
  tracePathSchema,
  type NormalizedTraceEvent,
} from "@/server/observability/runtime-trace-contract";
import { compactObject } from "@/server/observability/object-utils";

export const TRACE_EXPORT_VERSION = "runtime-trace-v3" as const;

export const traceExportPayloadStateSchema = z.enum([
  "full",
  "summary_only",
  "partially_pruned",
  "pruned",
]);

export const traceExportCompletenessSchema = z.enum([
  "complete",
  "degraded",
  "incomplete",
]);

export const TRACE_REPLAY_REASON_CODES = [
  "no_trace_runs",
  "trace_degraded",
  "trace_incomplete",
  "trace_open",
  "payload_summary_only",
  "payload_partially_pruned",
  "payload_pruned",
  "payload_unavailable",
  "required_payload_missing",
  "required_payload_truncated",
  "run_evidence_missing",
  "run_evidence_invalid",
] as const;

export const traceReplayIneligibleReasonSchema = z.object({
  code: z.enum(TRACE_REPLAY_REASON_CODES),
  message: z.string().min(1),
  traceRunId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  fields: z.array(z.string().min(1)).optional(),
});

const traceExportSessionSchema = z.object({
  id: z.string().min(1),
  user: z.object({ id: z.string().min(1), handle: z.string().min(1) }),
  problem: z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
  }),
  browserInstanceId: z.string().min(1),
  startTrigger: z.string().min(1),
  captureLevel: z.enum(["summary", "full"]),
  foregroundStatus: z.enum(["active", "closed", "abandoned"]),
  backgroundStatus: z.enum(["idle", "pending", "settled", "failed"]),
  startedAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  foregroundEndedAt: z.string().datetime({ offset: true }).nullable(),
  endReason: z.string().nullable(),
  settledAt: z.string().datetime({ offset: true }).nullable(),
});

const traceExportRunSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1).nullable(),
  parentTraceRunId: z.string().min(1).nullable(),
  originatingTraceRunId: z.string().min(1).nullable(),
  turnOrdinal: z.number().int().positive().nullable(),
  originatingTurnOrdinal: z.number().int().positive().nullable(),
  path: tracePathSchema,
  actionKind: z.string().nullable(),
  status: runStatusSchema,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  providerInputTokens: z.number().int().nonnegative().nullable(),
  providerOutputTokens: z.number().int().nonnegative().nullable(),
  providerTotalTokens: z.number().int().nonnegative().nullable(),
  providerReasoningTokens: z.number().int().nonnegative().nullable(),
  providerCachedTokens: z.number().int().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  pricingVersion: z.string().nullable(),
  pricingStatus: pricingStatusSchema,
  unpricedLlmCallCount: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  traceOverheadMs: z.number().int().nonnegative().nullable(),
  traceCompleteness: traceCompletenessSchema,
  finalFlushAt: z.string().datetime({ offset: true }).nullable(),
  reviewAttemptId: z.string().nullable(),
  chatSessionId: z.string().nullable(),
  runId: z.string().nullable(),
});

export const runtimeTraceExportSchema = z.object({
  exportVersion: z.literal(TRACE_EXPORT_VERSION),
  session: traceExportSessionSchema,
  runs: z.array(traceExportRunSchema),
  events: z.array(normalizedTraceEventSchema),
  payloadState: traceExportPayloadStateSchema,
  traceCompleteness: traceExportCompletenessSchema,
  replayEligible: z.boolean(),
  replayIneligibleReasons: z.array(traceReplayIneligibleReasonSchema),
});

export type RuntimeTraceExport = z.infer<typeof runtimeTraceExportSchema>;
export type TraceReplayIneligibleReason = z.infer<
  typeof traceReplayIneligibleReasonSchema
>;

/**
 * Returns null for both an unknown Session and a Session owned by another
 * learner. The route must not reveal whether another learner's id exists.
 */
export async function exportRuntimeTraceSession(
  prisma: PrismaClient,
  input: { userId: string; sessionId: string },
): Promise<RuntimeTraceExport | null> {
  const session = await prisma.problemWorkspaceSession.findFirst({
    where: { id: input.sessionId, userId: input.userId },
    include: {
      user: { select: { id: true, handle: true } },
      problem: { select: { id: true, slug: true, title: true } },
      traceRuns: { orderBy: [{ turnOrdinal: "asc" }, { startedAt: "asc" }] },
      traceEvents: {
        orderBy: [{ seq: "asc" }, { occurredAt: "asc" }, { id: "asc" }],
        include: { payload: true },
      },
    },
  });

  if (!session) return null;

  const events = session.traceEvents.map(projectNormalizedEvent);
  const runs = session.traceRuns.map((run) => ({
    id: run.id,
    workspaceSessionId: run.workspaceSessionId,
    parentTraceRunId: run.parentTraceRunId,
    originatingTraceRunId: run.originatingTraceRunId,
    turnOrdinal: run.turnOrdinal,
    originatingTurnOrdinal: run.originatingTurnOrdinal,
    path: tracePathSchema.parse(run.path),
    actionKind: run.actionKind,
    status: runStatusSchema.parse(run.status),
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    providerInputTokens: run.providerInputTokens,
    providerOutputTokens: run.providerOutputTokens,
    providerTotalTokens: run.providerTotalTokens,
    providerReasoningTokens: run.providerReasoningTokens,
    providerCachedTokens: run.providerCachedTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    pricingVersion: run.pricingVersion,
    pricingStatus: pricingStatusSchema.parse(run.pricingStatus),
    unpricedLlmCallCount: run.unpricedLlmCallCount,
    llmCallCount: run.llmCallCount,
    toolCallCount: run.toolCallCount,
    errorCount: run.errorCount,
    traceOverheadMs: run.traceOverheadMs,
    traceCompleteness: traceCompletenessSchema.parse(run.traceCompleteness),
    finalFlushAt: run.finalFlushAt?.toISOString() ?? null,
    reviewAttemptId: run.reviewAttemptId,
    chatSessionId: run.chatSessionId,
    runId: run.runId,
  }));
  const payloadState = aggregatePayloadState(events);
  const traceCompleteness = aggregateTraceCompleteness(runs);
  const replayIneligibleReasons = collectReplayIneligibleReasons({
    runs,
    events,
    payloadState,
  });

  return runtimeTraceExportSchema.parse({
    exportVersion: TRACE_EXPORT_VERSION,
    session: {
      id: session.id,
      user: session.user,
      problem: session.problem,
      browserInstanceId: session.browserInstanceId,
      startTrigger: session.startTrigger,
      captureLevel: session.captureLevel,
      foregroundStatus: session.foregroundStatus,
      backgroundStatus: session.backgroundStatus,
      startedAt: session.startedAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      foregroundEndedAt: session.foregroundEndedAt?.toISOString() ?? null,
      endReason: session.endReason,
      settledAt: session.settledAt?.toISOString() ?? null,
    },
    runs,
    events,
    payloadState,
    traceCompleteness,
    replayEligible: replayIneligibleReasons.length === 0,
    replayIneligibleReasons,
  });
}

type ExportEvent = RuntimeTraceExport["events"][number];
type ExportRun = RuntimeTraceExport["runs"][number];

export function aggregatePayloadState(
  events: readonly ExportEvent[],
): RuntimeTraceExport["payloadState"] {
  if (events.length === 0) return "full";
  const states = events.map((event) => event.capture.payloadState);
  if (states.every((state) => state === "captured")) return "full";
  if (states.every((state) => state === "pruned")) return "pruned";
  if (states.every((state) => state === "summary_only")) return "summary_only";
  if (
    states.every((state) => state === "captured" || state === "summary_only")
  ) {
    return "summary_only";
  }
  return "partially_pruned";
}

export function aggregateTraceCompleteness(
  runs: readonly Pick<ExportRun, "traceCompleteness">[],
): RuntimeTraceExport["traceCompleteness"] {
  if (
    runs.some(
      (run) =>
        run.traceCompleteness === "open" ||
        run.traceCompleteness === "incomplete",
    )
  ) {
    return "incomplete";
  }
  return runs.some((run) => run.traceCompleteness === "degraded")
    ? "degraded"
    : "complete";
}

export function collectReplayIneligibleReasons(input: {
  runs: readonly Pick<ExportRun, "id" | "traceCompleteness">[];
  events: readonly ExportEvent[];
  payloadState: RuntimeTraceExport["payloadState"];
}): TraceReplayIneligibleReason[] {
  const reasons: TraceReplayIneligibleReason[] = [];
  if (input.runs.length === 0) {
    reasons.push(reason("no_trace_runs", "The export contains no Trace Runs."));
  }

  for (const run of input.runs) {
    if (run.traceCompleteness === "degraded") {
      reasons.push(
        reason("trace_degraded", "A selected Trace Run has degraded telemetry.", {
          traceRunId: run.id,
        }),
      );
    } else if (run.traceCompleteness === "incomplete") {
      reasons.push(
        reason("trace_incomplete", "A selected Trace Run is incomplete.", {
          traceRunId: run.id,
        }),
      );
    } else if (run.traceCompleteness === "open") {
      reasons.push(
        reason("trace_open", "A selected Trace Run has not completed its final flush.", {
          traceRunId: run.id,
        }),
      );
    }
  }

  if (input.payloadState === "summary_only") {
    reasons.push(
      reason("payload_summary_only", "The export contains summary-only payloads."),
    );
  } else if (input.payloadState === "partially_pruned") {
    reasons.push(
      reason(
        "payload_partially_pruned",
        "The export contains pruned or unavailable payloads.",
      ),
    );
  } else if (input.payloadState === "pruned") {
    reasons.push(reason("payload_pruned", "The export payloads were pruned."));
  }

  for (const event of input.events) {
    if (event.capture.payloadState === "unavailable") {
      reasons.push(
        reason("payload_unavailable", "An event payload is unavailable.", {
          eventId: event.identity.eventId,
          traceRunId: event.identity.traceRunId,
        }),
      );
    }

    const requiredFields = requiredReplayPayloadFields(event);
    if (requiredFields.length === 0) continue;
    const missingFields = requiredFields.filter(
      (field) => !hasDetailField(event, field),
    );
    if (missingFields.length > 0) {
      reasons.push(
        reason(
          "required_payload_missing",
          `Event ${event.identity.eventId} is missing replay payload: ${missingFields.join(", ")}.`,
          {
            eventId: event.identity.eventId,
            traceRunId: event.identity.traceRunId,
            fields: missingFields,
          },
        ),
      );
    }
    const truncatedFields = event.capture.truncatedFields ?? [];
    const requiredTruncations = truncatedFields.filter((field) =>
      requiredFields.some((required) => field.includes(`details.${required}`)),
    );
    if (requiredTruncations.length > 0) {
      reasons.push(
        reason(
          "required_payload_truncated",
          `Event ${event.identity.eventId} has truncated replay payload.`,
          {
            eventId: event.identity.eventId,
            traceRunId: event.identity.traceRunId,
            fields: requiredTruncations,
          },
        ),
      );
    }
  }

  return deduplicateReasons(reasons);
}

function projectNormalizedEvent(event: {
  eventId: string;
  eventDigest: string;
  workspaceSessionId: string | null;
  traceRunId: string;
  parentTraceRunId: string | null;
  turnOrdinal: number | null;
  stepId: string | null;
  parentStepId: string | null;
  stepIndex: number | null;
  agentIteration: number | null;
  path: string;
  stage: string;
  kind: string;
  title: string;
  status: string;
  occurredAt: Date;
  clientOccurredAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerReasoningTokens: number | null;
  providerCachedTokens: number | null;
  usageSource: string | null;
  usageMissingReason: string | null;
  estimatedTokens: number | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
  pricingStatus: string | null;
  memoryRssBytes: number | null;
  memoryHeapUsedBytes: number | null;
  resourceScope: string | null;
  detailLevel: string;
  payloadState: string;
  redactedFieldsJson: string | null;
  truncatedFieldsJson: string | null;
  unavailableFieldsJson: string | null;
  metadataJson: string | null;
  payload: {
    promptJson: string | null;
    inputJson: string | null;
    outputJson: string | null;
    retrievalJson: string | null;
    stateDeltaJson: string | null;
    memoryDeltaJson: string | null;
    detailMetadataJson: string | null;
    stdout: string | null;
    stderr: string | null;
  } | null;
}): NormalizedTraceEvent {
  const smallMetadata = parseJsonRecord(event.metadataJson);
  const detailMetadata = parseJsonRecord(event.payload?.detailMetadataJson ?? null);
  const output = parseJson(event.payload?.outputJson ?? null);
  const outputWithStreams = attachCapturedStreams(
    output,
    event.payload?.stdout ?? null,
    event.payload?.stderr ?? null,
  );
  const details = compactObject({
    input: parseJson(event.payload?.inputJson ?? null),
    prompt: parseJson(event.payload?.promptJson ?? null),
    retrieval: parseJson(event.payload?.retrievalJson ?? null),
    output: outputWithStreams,
    stateDelta: parseJson(event.payload?.stateDeltaJson ?? null),
    memoryDelta: parseJson(event.payload?.memoryDeltaJson ?? null),
    metadata:
      Object.keys(smallMetadata).length > 0 ||
      Object.keys(detailMetadata).length > 0
        ? { ...smallMetadata, ...detailMetadata }
        : undefined,
  });

  return normalizedTraceEventSchema.parse({
    identity: compactObject({
      eventId: event.eventId,
      eventDigest: event.eventDigest,
      workspaceSessionId: event.workspaceSessionId ?? undefined,
      traceRunId: event.traceRunId,
      parentTraceRunId: event.parentTraceRunId ?? undefined,
      turnOrdinal: event.turnOrdinal ?? undefined,
      stepId: event.stepId ?? undefined,
      parentStepId: event.parentStepId ?? undefined,
      stepIndex: event.stepIndex ?? undefined,
      agentIteration: event.agentIteration ?? undefined,
    }),
    scope: {
      path: event.path,
      stage: event.stage,
      kind: event.kind,
      title: event.title,
    },
    lifecycle: compactObject({
      status: event.status,
      occurredAt: event.occurredAt.toISOString(),
      clientOccurredAt: event.clientOccurredAt?.toISOString(),
      startedAt: event.startedAt?.toISOString(),
      endedAt: event.endedAt?.toISOString(),
      durationMs: event.durationMs ?? undefined,
    }),
    ...(Object.keys(details).length > 0 ? { details } : {}),
    metrics: compactObject({
      providerInputTokens: event.providerInputTokens ?? undefined,
      providerOutputTokens: event.providerOutputTokens ?? undefined,
      providerTotalTokens: event.providerTotalTokens ?? undefined,
      providerReasoningTokens: event.providerReasoningTokens ?? undefined,
      providerCachedTokens: event.providerCachedTokens ?? undefined,
      usageSource: event.usageSource ?? undefined,
      usageMissingReason: event.usageMissingReason ?? undefined,
      estimatedTokens: event.estimatedTokens ?? undefined,
      estimatedCostUsd: event.estimatedCostUsd ?? undefined,
      pricingVersion: event.pricingVersion ?? undefined,
      pricingStatus: event.pricingStatus ?? undefined,
      memoryRssBytes: event.memoryRssBytes ?? undefined,
      memoryHeapUsedBytes: event.memoryHeapUsedBytes ?? undefined,
      resourceScope: event.resourceScope ?? undefined,
    }),
    capture: compactObject({
      detailLevel: event.detailLevel,
      payloadState: event.payloadState,
      redactedFields: parseStringArray(event.redactedFieldsJson),
      truncatedFields: parseStringArray(event.truncatedFieldsJson),
      unavailableFields: parseStringArray(event.unavailableFieldsJson),
    }),
  });
}

type RequiredDetailField = "input" | "prompt" | "output";

function requiredReplayPayloadFields(event: ExportEvent): RequiredDetailField[] {
  const role = readEventRole(event);
  switch (event.scope.kind) {
    case "workspace_snapshot":
      return ["input"];
    case "llm":
      return ["prompt", "output"];
    case "tool":
      return role === "call"
        ? ["input"]
        : role === "result"
          ? ["output"]
          : ["input", "output"];
    case "runner":
      return role === "request"
        ? ["input"]
        : role === "result"
          ? ["output"]
          : ["input", "output"];
    default:
      return [];
  }
}

function readEventRole(event: ExportEvent) {
  const role = event.details?.metadata?.eventRole;
  return typeof role === "string" ? role : undefined;
}

function hasDetailField(event: ExportEvent, field: RequiredDetailField) {
  return event.details?.[field] !== undefined;
}

function reason(
  code: TraceReplayIneligibleReason["code"],
  message: string,
  context: Omit<TraceReplayIneligibleReason, "code" | "message"> = {},
): TraceReplayIneligibleReason {
  return { code, message, ...context };
}

function deduplicateReasons(reasons: TraceReplayIneligibleReason[]) {
  const seen = new Set<string>();
  return reasons.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function attachCapturedStreams(
  output: unknown,
  stdout: string | null,
  stderr: string | null,
) {
  if (stdout === null && stderr === null) return output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return compactObject({
      ...(output as Record<string, unknown>),
      stdout: (output as Record<string, unknown>).stdout ?? stdout ?? undefined,
      stderr: (output as Record<string, unknown>).stderr ?? stderr ?? undefined,
    });
  }
  return compactObject({ value: output, stdout: stdout ?? undefined, stderr: stderr ?? undefined });
}

function parseJson(value: string | null): unknown | undefined {
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonRecord(value: string | null) {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseStringArray(value: string | null) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
    ? parsed
    : undefined;
}
