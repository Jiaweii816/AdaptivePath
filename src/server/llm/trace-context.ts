import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  captureNormalizedTraceEvent,
  type PreCaptureTraceEvent,
  type TraceCaptureLevel,
} from "@/server/observability/runtime-trace-capture";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import { flushTraceEvents, markTraceRunDegradedBestEffort } from "@/server/observability/trace-store";
import { finalizeTraceRun } from "@/server/observability/trace-store";
import { TraceRecorder } from "@/server/observability/trace-recorder";
import { calculateCurrentLlmCost } from "@/server/observability/cost-model";
import { compactObject } from "@/server/observability/object-utils";
import {
  resolveMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";

export type TracePath = "review" | "chat" | "practice_run" | "mock_interview" | "memory" | "memory_background" | "campaign_strategist";
export type TraceSpanKind = "llm" | "tool" | "runner" | "retrieval" | "guard";

export type TraceContext = {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  traceRunId: string;
  workspaceSessionId?: string;
  turnOrdinal?: number;
  captureLevel?: TraceCaptureLevel;
  path: TracePath;
  task: string;
  problemId?: string;
  chatSessionId?: string;
  reviewAttemptId?: string;
  messageSequence?: number;
  stepIndex: number;
  agentIteration?: number;
  llmMsTotal: number;
  toolMsTotal: number;
  runnerMs?: number;
  latestLlmStepId?: string;
  recorder?: TraceRecorder;
};

export type TraceStep = {
  stepIndex: number;
  stepId: string;
  spanKind: TraceSpanKind;
  parentStepId?: string;
};

export type ProviderUsage = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
};

type LlmTraceStatus = "ok" | "error";
const warnedMissingTraceTasks = new Set<string>();

export function createTraceContext(input: {
  prisma: PrismaClient;
  userId: string;
  path: TracePath;
  task: string;
  problemId?: string;
  chatSessionId?: string;
  reviewAttemptId?: string;
  messageSequence?: number;
  traceRunId?: string;
  workspaceSessionId?: string;
  turnOrdinal?: number;
  captureLevel?: TraceCaptureLevel;
  initialTraceOverheadMs?: number;
  /** Direct-call eval/test seam; production foreground paths keep buffering. */
  bufferedRecorder?: boolean;
  memoryOrigin?: MemoryOrigin;
}): TraceContext {
  const context: TraceContext = {
    ...input,
    memoryOrigin: input.memoryOrigin ?? resolveMemoryOrigin(),
    traceRunId: input.traceRunId ?? randomUUID(),
    captureLevel: input.captureLevel ?? resolveTraceCaptureLevel(),
    stepIndex: 0,
    llmMsTotal: 0,
    toolMsTotal: 0,
  };
  if (
    (input.workspaceSessionId && input.bufferedRecorder !== false) ||
    input.bufferedRecorder === true
  ) {
    context.recorder = new TraceRecorder({
      prisma: input.prisma,
      traceRunId: context.traceRunId,
      workspaceSessionId: input.workspaceSessionId,
      capture: { detailLevel: context.captureLevel ?? resolveTraceCaptureLevel() },
      initialOverheadMs: input.initialTraceOverheadMs,
    });
    recordProcessMemorySample(context, "start");
  }
  return context;
}

export function setTraceAgentIteration(context: TraceContext | undefined, iteration: number) {
  if (context) context.agentIteration = iteration;
}

export function startTraceStep(
  context: TraceContext | undefined,
  input: { spanKind: TraceSpanKind; parentStepId?: string },
): TraceStep | undefined {
  if (!context) return undefined;
  context.stepIndex += 1;
  const step = {
    stepIndex: context.stepIndex,
    stepId: `${context.traceRunId}:${context.stepIndex}`,
    spanKind: input.spanKind,
    parentStepId: input.parentStepId,
  };
  if (input.spanKind === "llm") context.latestLlmStepId = step.stepId;
  return step;
}

export function addTraceLlmMs(context: TraceContext | undefined, latencyMs: number) {
  if (context) context.llmMsTotal += latencyMs;
}
export function addTraceToolMs(context: TraceContext | undefined, latencyMs: number) {
  if (context) context.toolMsTotal += latencyMs;
}
export function setTraceRunnerMs(context: TraceContext | undefined, latencyMs: number) {
  if (context) context.runnerMs = latencyMs;
}

export function traceStepEventJson(context: TraceContext | undefined, step: TraceStep | undefined) {
  return {
    traceRunId: context?.traceRunId,
    stepIndex: step?.stepIndex,
    stepId: step?.stepId,
    spanKind: step?.spanKind,
    parentStepId: step?.parentStepId,
    agentIteration: context?.agentIteration,
  };
}

export async function appendLlmCallTrace(args: {
  traceContext?: TraceContext;
  step?: TraceStep;
  task?: string;
  source?: string;
  content?: string;
  model: string;
  responseModel?: string | null;
  latencyMs: number;
  status: LlmTraceStatus;
  finishReason?: string | null;
  usage?: ProviderUsage | null;
  usageMissingReason?: "error_response" | "provider_omitted";
  error?: unknown;
  provider?: string;
  mode?: "standard" | "thinking" | string;
  prompt?: Array<{ role: string; content: unknown; estimatedTokens?: number }>;
  estimatedTokens?: number;
  input?: unknown;
  rawOutput?: unknown;
  parsedOutput?: unknown;
  visibleOutput?: unknown;
  extraEventJson?: Record<string, unknown>;
}) {
  const context = args.traceContext;
  if (!context) {
    warnMissingTraceContext(args.task);
    return;
  }
  const usage = normalizeProviderUsage({
    usage: args.usage,
    missingReason: args.usageMissingReason ?? (args.status === "error" ? "error_response" : "provider_omitted"),
  });
  const task = args.task ?? context.task;
  const mode = args.mode ?? (args.extraEventJson?.thinking === true ? "thinking" : "standard");
  const provider = args.provider ?? inferPricingProvider(args.model);
  const pricing = calculateCurrentLlmCost({
    provider,
    modelId: args.model,
    mode,
    providerInputTokens: usage.usage?.inputTokens ?? null,
    providerOutputTokens: usage.usage?.outputTokens ?? null,
    providerTotalTokens: usage.usage?.totalTokens ?? null,
    providerCachedTokens: usage.usage?.cachedTokens,
    providerReasoningTokens: usage.usage?.reasoningTokens,
  });
  const output = compactObject({
    rawResponse: args.rawOutput,
    parsedResponse: args.parsedOutput,
    visibleResponse: args.visibleOutput,
    error: args.error ? normalizeLlmError(args.error) : undefined,
  });
  const flushed = await appendTraceEventBestEffort(context, {
    eventId: randomUUID(),
    step: args.step,
    stage: "llm",
    kind: "llm",
    title: `LLM · ${task}`,
    status: args.status === "ok" ? "succeeded" : "failed",
    durationMs: args.latencyMs,
    details: {
      input: args.input,
      prompt: args.prompt,
      output: Object.keys(output).length > 0 ? output : undefined,
      metadata: {
        source: args.source ?? `${context.path}:${task}`,
        task,
        model: args.model,
        responseModel: args.responseModel ?? null,
        finishReason: args.finishReason ?? null,
        contentSummary: args.content,
        pricingProvider: provider,
        pricingMode: mode,
        pricingUnpricedComponents: pricing.unpricedComponents,
        ...args.extraEventJson,
      },
    },
    metrics: {
      providerInputTokens: usage.usage?.inputTokens ?? undefined,
      providerOutputTokens: usage.usage?.outputTokens ?? undefined,
      providerTotalTokens: usage.usage?.totalTokens ?? undefined,
      providerCachedTokens: usage.usage?.cachedTokens ?? undefined,
      providerReasoningTokens: usage.usage?.reasoningTokens ?? undefined,
      usageSource: usage.usageSource,
      usageMissingReason: usage.usageMissingReason ?? undefined,
      estimatedTokens: normalizeTokenCount(args.estimatedTokens) ?? undefined,
      estimatedCostUsd: pricing.estimatedCostUsd ?? undefined,
      pricingVersion: pricing.pricingVersion,
      pricingStatus: pricing.pricingStatus,
    },
  });
  if (
    !context.workspaceSessionId &&
    (context.path === "mock_interview" ||
      context.path === "memory" ||
      context.path === "memory_background" ||
      context.path === "campaign_strategist")
  ) {
    await finalizeUnscopedLlmRunBestEffort(
      context,
      args.status === "ok" && flushed ? "succeeded" : "failed",
    );
  }
}

export async function appendTraceEventBestEffort(
  context: TraceContext,
  input: {
    eventId?: string;
    step?: TraceStep;
    stage: string;
    kind: PreCaptureTraceEvent["scope"]["kind"];
    title: string;
    status: PreCaptureTraceEvent["lifecycle"]["status"];
    occurredAt?: Date;
    startedAt?: Date;
    endedAt?: Date;
    durationMs?: number;
    details?: PreCaptureTraceEvent["details"];
    metrics?: PreCaptureTraceEvent["metrics"];
  },
  ) {
  try {
    // A foreground recorder is created only after the allocator committed its
    // root Run. Avoid one trace-only DB read per buffered event.
    if (!context.recorder) await ensureDurableTraceRun(context);
    const event: PreCaptureTraceEvent = {
      identity: {
        eventId: input.eventId ?? randomUUID(),
        traceRunId: context.traceRunId,
        workspaceSessionId: context.workspaceSessionId,
        turnOrdinal: context.turnOrdinal,
        stepId: input.step?.stepId,
        parentStepId: input.step?.parentStepId,
        stepIndex: input.step?.stepIndex,
        agentIteration: context.agentIteration,
      },
      scope: {
        path: normalizeTracePath(context.path),
        stage: input.stage,
        kind: input.kind,
        title: input.title,
      },
      lifecycle: {
        status: input.status,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        startedAt: input.startedAt?.toISOString(),
        endedAt: input.endedAt?.toISOString(),
        // Wall clocks can move backwards during a Turn (for example after a
        // host/WSL clock correction). Telemetry must not degrade an otherwise
        // successful product path because an elapsed sample crossed that
        // adjustment.
        durationMs:
          input.durationMs === undefined
            ? undefined
            : Math.max(0, input.durationMs),
      },
      details: input.details,
      metrics: input.metrics,
    };
    if (context.recorder) {
      context.recorder.record(event);
      return { buffered: true } as const;
    }
    const captured = captureNormalizedTraceEvent(event, {
      detailLevel: context.captureLevel ?? resolveTraceCaptureLevel(),
    });
    return await flushTraceEvents(context.prisma, [captured]);
  } catch (error) {
    console.warn(`Unable to append new-store trace event for ${context.traceRunId}:`, error);
    context.recorder?.markDegraded();
    await markTraceRunDegradedBestEffort(context.prisma, context.traceRunId);
    return undefined;
  }
}

export function recordProcessMemorySample(
  context: TraceContext,
  sample: "start" | "end",
) {
  try {
    const usage = process.memoryUsage();
    const event: PreCaptureTraceEvent = {
      identity: {
        eventId: `${context.traceRunId}:process-memory:${sample}`,
        traceRunId: context.traceRunId,
        workspaceSessionId: context.workspaceSessionId,
        turnOrdinal: context.turnOrdinal,
      },
      scope: {
        path: normalizeTracePath(context.path),
        stage: "resource_sample",
        kind: "lifecycle",
        title: `Process memory sample · ${sample}`,
      },
      lifecycle: { status: "succeeded", occurredAt: new Date().toISOString() },
      details: {
        metadata: {
          sample,
          measurementScope: "process-wide",
          attribution: "not_per_turn_allocation",
        },
      },
      metrics: {
        memoryRssBytes: usage.rss,
        memoryHeapUsedBytes: usage.heapUsed,
        resourceScope: "process_sample",
        pricingStatus: "not_applicable",
      },
    };
    if (context.recorder) context.recorder.record(event);
  } catch (error) {
    context.recorder?.markDegraded();
    console.warn(`Unable to capture process-wide memory sample for ${context.traceRunId}:`, error);
  }
}

export async function attachTraceRunReferences(
  context: TraceContext,
  refs: { chatSessionId?: string; reviewAttemptId?: string; runId?: string },
) {
  Object.assign(context, refs);
  const startedAt = performance.now();
  try {
    await context.prisma.agentTraceRun.updateMany({
      where: { id: context.traceRunId },
      data: refs,
    });
  } catch (error) {
    context.recorder?.markDegraded();
    await markTraceRunDegradedBestEffort(context.prisma, context.traceRunId);
    throw error;
  } finally {
    context.recorder?.addOverheadMs(performance.now() - startedAt);
  }
}

async function ensureDurableTraceRun(context: TraceContext) {
  const existing = await context.prisma.agentTraceRun.findUnique({
    where: { id: context.traceRunId },
    select: { id: true, traceCompleteness: true },
  });
  if (existing) {
    if (!context.workspaceSessionId && existing.traceCompleteness !== "open") {
      await context.prisma.agentTraceRun.update({
        where: { id: context.traceRunId },
        data: {
          status: "running",
          traceCompleteness: "open",
          endedAt: null,
          durationMs: null,
          finalFlushAt: null,
        },
      });
    }
    return;
  }
  if (context.path === "review" || context.path === "chat") {
    throw new Error(`Foreground trace ${context.traceRunId} has no allocated Workspace root Run.`);
  }
  await context.prisma.agentTraceRun.create({
    data: {
      id: context.traceRunId,
      userId: context.userId,
      problemId: context.problemId,
      path: normalizeTracePath(context.path),
      actionKind: context.task,
      memoryOrigin: context.memoryOrigin,
      processInstanceId: getProcessInstanceId(),
      chatSessionId: context.chatSessionId,
    },
  });
}

async function finalizeUnscopedLlmRunBestEffort(
  context: TraceContext,
  status: "succeeded" | "failed",
) {
  try {
    await finalizeTraceRun(context.prisma, {
      traceRunId: context.traceRunId,
      status,
      traceCompleteness: "complete",
      endedAt: new Date(),
      traceOverheadMs: 0,
    });
  } catch (error) {
    console.warn(`Unable to finalize unscoped trace ${context.traceRunId}:`, error);
    await markTraceRunDegradedBestEffort(context.prisma, context.traceRunId);
  }
}

function resolveTraceCaptureLevel(): TraceCaptureLevel {
  const configured = process.env.TRACE_CAPTURE_LEVEL?.trim().toLowerCase();
  if (configured === "full" || configured === "summary") return configured;
  return process.env.NODE_ENV === "development" ? "full" : "summary";
}

function normalizeTracePath(path: TracePath) {
  return path === "memory" ? "memory_background" as const : path;
}

function inferPricingProvider(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("qwen")) return "qwen";
  return "unknown";
}

function normalizeProviderUsage(args: {
  usage?: ProviderUsage | null;
  missingReason: "error_response" | "provider_omitted";
}) {
  const inputTokens = normalizeTokenCount(args.usage?.prompt_tokens);
  const outputTokens = normalizeTokenCount(args.usage?.completion_tokens);
  const totalTokens = normalizeTokenCount(args.usage?.total_tokens);
  const cachedTokens = normalizeTokenCount(
    args.usage?.prompt_tokens_details?.cached_tokens ?? args.usage?.prompt_cache_hit_tokens,
  );
  const reasoningTokens = normalizeTokenCount(args.usage?.completion_tokens_details?.reasoning_tokens);
  const hasUsage = [inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens].some((value) => value !== null);
  if (!hasUsage) {
    return { usage: null, usageSource: "missing" as const, usageMissingReason: args.missingReason };
  }
  return {
    usage: { inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens },
    usageSource: "provider" as const,
    usageMissingReason: null,
  };
}

function normalizeTokenCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function normalizeLlmError(error: unknown) {
  const record = asRecord(error);
  const nestedError = asRecord(record.error);
  const response = asRecord(record.response);
  return {
    type: readString(record.type) ?? readString(nestedError.type) ?? (error instanceof Error ? error.name : typeof error),
    code: readString(record.code) ?? readString(nestedError.code),
    message: readString(record.message) ?? readString(nestedError.message) ?? (error instanceof Error ? error.message : String(error)),
    status: readNumber(record.status) ?? readNumber(response.status),
    requestId: readString(record.requestId) ?? readString(record.request_id),
  };
}

function warnMissingTraceContext(task?: string) {
  const key = task ?? "unknown";
  if (warnedMissingTraceTasks.has(key)) return;
  warnedMissingTraceTasks.add(key);
  console.warn(`LLM call ${key} had no TraceContext; skipping new-store trace.`);
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
