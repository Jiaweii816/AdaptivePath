import type { PrismaClient } from "@prisma/client";
import {
  estimateLlmCostUsd,
  MODEL_COST_PRICING_USD_PER_1M,
} from "./cost-model";
import { loadFormalTraceProjection } from "./formal-trace-projection";

type AgentObservabilityPrisma = Pick<
  PrismaClient,
  "l1MemoryEvent" | "agentTraceEvent"
>;

export type AgentObservabilityTraceRow = {
  id: string;
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  reviewAttemptId: string | null;
  eventType: string;
  eventJson: string;
  content: string | null;
  source: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type TimeWindowSummary = {
  start: string | null;
  end: string | null;
};

export type LatencySummary = {
  count: number;
  missingCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type TokenCostSummary = {
  usagePresentCount: number;
  usageMissingCount: number;
  usageMissingRate: number | null;
  inputTokens: NumericTotalAvg;
  outputTokens: NumericTotalAvg;
  totalTokens: NumericTotalAvg;
  estimatedCostUsd: number;
  unpricedUsageCount: number;
  pricedUsageCount: number;
};

export type NumericTotalAvg = {
  total: number;
  avg: number | null;
};

export type PathSummary = {
  path: "review" | "chat";
  count: number;
  traceRunCount: number;
  missingTraceRunIdCount: number;
  llmCallCount: number;
  latency: {
    totalMs: LatencySummary;
    runnerMs?: LatencySummary;
    llmMsTotal: LatencySummary;
    toolMsTotal?: LatencySummary;
  };
  tokens: TokenCostSummary;
  toolCallsPerChat?: number | null;
};

export type LlmCallGroupSummary = {
  path: string;
  task: string;
  model: string;
  responseModel: string;
  status: string;
  count: number;
  latencyMs: LatencySummary;
  tokens: TokenCostSummary;
  usageSourceBreakdown: Record<string, number>;
  errorCount: number;
  topErrors: ErrorFrequency[];
};

export type ToolGroupSummary = {
  toolName: string;
  callCount: number;
  resultCount: number;
  successCount: number;
  errorCount: number;
  errorKindBreakdown: Record<string, number>;
  latencyMs: LatencySummary;
  avgApproxResultTokens: number | null;
  invalidArgsCount: number;
  invalidArgsRate: number | null;
};

export type ErrorFrequency = {
  key: string;
  message: string;
  code: string | null;
  count: number;
};

export type AgentObservabilityReport = {
  generatedAt: string;
  db: {
    path: string;
    explicit: boolean;
  };
  timeWindow: TimeWindowSummary;
  sampleCounts: {
    reviewPathCount: number;
    chatPathCount: number;
    llmCallCount: number;
    toolCallCount: number;
  };
  providerUsage: {
    presentCount: number;
    missingCount: number;
    missingRate: number | null;
  };
  review: PathSummary;
  chat: PathSummary;
  llmCalls: LlmCallGroupSummary[];
  toolCalls: ToolGroupSummary[];
  malformedEventJsonCount: number;
  warningCount: number;
  warnings: string[];
  pricing: typeof MODEL_COST_PRICING_USD_PER_1M;
};

type ParsedTraceEvent = AgentObservabilityTraceRow & {
  eventJsonRecord: JsonRecord | null;
  malformedReason: string | null;
};

type JsonRecord = Record<string, unknown>;

type LlmCallObservation = {
  traceRunId: string | null;
  path: string;
  task: string;
  model: string;
  responseModel: string;
  status: string;
  latencyMs: number | null;
  usageSource: string;
  usageMissingReason: string | null;
  usageMissing: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type ToolCallObservation = {
  traceRunId: string | null;
  toolName: string;
};

type ToolResultObservation = {
  traceRunId: string | null;
  toolName: string;
  status: string;
  latencyMs: number | null;
  approxResultTokens: number | null;
  errorKind: string | null;
};

type PathEventObservation = {
  traceRunId: string | null;
  totalMs: number | null;
  runnerMs: number | null;
  llmMsTotal: number | null;
  toolMsTotal: number | null;
};

const OBSERVABILITY_EVENT_TYPES = [
  "coach_reply",
  "chat_reply",
  "llm_call",
  "tool_call",
  "tool_result",
  "reply_safety_replaced",
];

export async function loadAgentObservabilityRows(
  db: AgentObservabilityPrisma,
): Promise<AgentObservabilityTraceRow[]> {
  return loadFormalTraceProjection(db, {
    eventTypes: OBSERVABILITY_EVENT_TYPES,
    order: "asc",
  });
}

export function buildAgentObservabilityReport(args: {
  rows: AgentObservabilityTraceRow[];
  dbPath: string;
  explicitDb: boolean;
  generatedAt?: Date;
}): AgentObservabilityReport {
  const generatedAt = args.generatedAt ?? new Date();
  const warnings: string[] = [];
  const parsedEvents = args.rows.map(parseTraceEvent);
  const malformedEventJsonCount = parsedEvents.filter(
    (event) => event.malformedReason,
  ).length;

  if (malformedEventJsonCount > 0) {
    warnings.push(
      `${malformedEventJsonCount} projected rows had malformed or non-object eventJson and were partially ignored.`,
    );
  }

  const reviewEvents = parsedEvents
    .filter((event) => event.eventType === "coach_reply")
    .map(readPathEvent);
  const chatEvents = parsedEvents
    .filter((event) => event.eventType === "chat_reply")
    .map(readPathEvent);
  const llmCalls = parsedEvents
    .filter((event) => event.eventType === "llm_call")
    .map(readLlmCall);
  const toolCalls = parsedEvents
    .filter((event) => event.eventType === "tool_call")
    .map(readToolCall);
  const toolResults = parsedEvents
    .filter((event) => event.eventType === "tool_result")
    .map(readToolResult);

  addOldTraceWarnings({
    warnings,
    reviewEvents,
    chatEvents,
    llmCalls,
    toolCalls,
    toolResults,
  });

  const review = buildPathSummary({
    path: "review",
    pathEvents: reviewEvents,
    llmCalls,
    toolCalls,
  });
  const chat = buildPathSummary({
    path: "chat",
    pathEvents: chatEvents,
    llmCalls,
    toolCalls,
  });
  const providerUsage = summarizeProviderUsage(llmCalls);

  return {
    generatedAt: generatedAt.toISOString(),
    db: {
      path: args.dbPath,
      explicit: args.explicitDb,
    },
    timeWindow: buildTimeWindow(args.rows),
    sampleCounts: {
      reviewPathCount: review.count,
      chatPathCount: chat.count,
      llmCallCount: llmCalls.length,
      toolCallCount: toolCalls.length,
    },
    providerUsage,
    review,
    chat,
    llmCalls: buildLlmCallGroups(llmCalls),
    toolCalls: buildToolGroups({ toolCalls, toolResults }),
    malformedEventJsonCount,
    warningCount: warnings.length,
    warnings,
    pricing: MODEL_COST_PRICING_USD_PER_1M,
  };
}

export function groupEventsByTraceRunId<T extends { traceRunId: string | null }>(
  events: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const event of events) {
    if (!event.traceRunId) {
      continue;
    }

    const current = grouped.get(event.traceRunId) ?? [];
    current.push(event);
    grouped.set(event.traceRunId, current);
  }

  return grouped;
}

export function computePercentile(
  values: number[],
  percentile: number,
): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return null;
  }

  const bounded = Math.max(0, Math.min(100, percentile));
  const index = Math.max(0, Math.ceil((bounded / 100) * sorted.length) - 1);
  return sorted[index];
}

export function summarizeTokenCost(
  calls: Array<{
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    usageMissing: boolean;
  }>,
): TokenCostSummary {
  let usagePresentCount = 0;
  let usageMissingCount = 0;
  let inputTotal = 0;
  let outputTotal = 0;
  let totalTokenTotal = 0;
  let estimatedCostUsd = 0;
  let unpricedUsageCount = 0;
  let pricedUsageCount = 0;

  for (const call of calls) {
    if (call.usageMissing) {
      usageMissingCount += 1;
      continue;
    }

    usagePresentCount += 1;
    inputTotal += call.inputTokens ?? 0;
    outputTotal += call.outputTokens ?? 0;
    totalTokenTotal +=
      call.totalTokens ?? (call.inputTokens ?? 0) + (call.outputTokens ?? 0);

    const cost = estimateLlmCostUsd({
      modelId: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    });

    if (cost) {
      pricedUsageCount += 1;
      estimatedCostUsd += cost.totalUsd;
    } else {
      unpricedUsageCount += 1;
    }
  }

  return {
    usagePresentCount,
    usageMissingCount,
    usageMissingRate: rate(usageMissingCount, calls.length),
    inputTokens: totalAvg(inputTotal, usagePresentCount),
    outputTokens: totalAvg(outputTotal, usagePresentCount),
    totalTokens: totalAvg(totalTokenTotal, usagePresentCount),
    estimatedCostUsd,
    unpricedUsageCount,
    pricedUsageCount,
  };
}

function parseTraceEvent(row: AgentObservabilityTraceRow): ParsedTraceEvent {
  try {
    const parsed = JSON.parse(row.eventJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ...row,
        eventJsonRecord: null,
        malformedReason: "eventJson was not an object",
      };
    }

    return {
      ...row,
      eventJsonRecord: parsed as JsonRecord,
      malformedReason: null,
    };
  } catch (error) {
    return {
      ...row,
      eventJsonRecord: null,
      malformedReason:
        error instanceof Error ? error.message : "eventJson could not be parsed",
    };
  }
}

function readPathEvent(event: ParsedTraceEvent): PathEventObservation {
  const json = event.eventJsonRecord;
  const timings = asRecord(json?.timings);

  return {
    traceRunId: readString(json?.traceRunId),
    totalMs: readNumber(timings?.totalMs),
    runnerMs: readNumber(timings?.runnerMs),
    llmMsTotal: readNumber(timings?.llmMsTotal),
    toolMsTotal: readNumber(timings?.toolMsTotal),
  };
}

function readLlmCall(event: ParsedTraceEvent): LlmCallObservation {
  const json = event.eventJsonRecord;
  const usage = asRecord(json?.usage);
  const inputTokens =
    readNumber(usage?.inputTokens) ?? readNumber(json?.["gen_ai.usage.input_tokens"]);
  const outputTokens =
    readNumber(usage?.outputTokens) ?? readNumber(json?.["gen_ai.usage.output_tokens"]);
  const totalTokens =
    readNumber(usage?.totalTokens) ?? readNumber(json?.["gen_ai.usage.total_tokens"]);
  const usageSource = readString(json?.usageSource) ?? "missing";
  const hasUsageObject = Boolean(usage);
  const hasAnyToken =
    inputTokens !== null || outputTokens !== null || totalTokens !== null;
  const usageMissing = usageSource === "missing" || (!hasUsageObject && !hasAnyToken);
  const error = asRecord(json?.error);
  const sourceParts = (event.source ?? "").split(":");

  return {
    traceRunId: readString(json?.traceRunId),
    path: readString(json?.path) ?? sourceParts[0] ?? "unknown",
    task: readString(json?.task) ?? sourceParts[1] ?? "unknown",
    model: readString(json?.model) ?? "unknown",
    responseModel: readString(json?.responseModel) ?? "null",
    status: readString(json?.status) ?? "unknown",
    latencyMs: readNumber(json?.latencyMs),
    usageSource,
    usageMissingReason: readString(json?.usageMissingReason),
    usageMissing,
    inputTokens,
    outputTokens,
    totalTokens,
    errorCode: readString(error?.code),
    errorMessage: readString(error?.message),
  };
}

function readToolCall(event: ParsedTraceEvent): ToolCallObservation {
  const json = event.eventJsonRecord;

  return {
    traceRunId: readString(json?.traceRunId),
    toolName: readString(json?.toolName) ?? "unknown",
  };
}

function readToolResult(event: ParsedTraceEvent): ToolResultObservation {
  const json = event.eventJsonRecord;
  const errorKind = readString(json?.errorKind);

  return {
    traceRunId: readString(json?.traceRunId),
    toolName: readString(json?.toolName) ?? "unknown",
    status: normalizeToolResultStatus(json),
    latencyMs: readNumber(json?.latencyMs),
    approxResultTokens: readNumber(json?.approxResultTokens),
    errorKind,
  };
}

function normalizeToolResultStatus(json: JsonRecord | null) {
  const status = readString(json?.status);
  if (status) {
    return status;
  }

  if (json?.errorKind || json?.error) {
    return "error";
  }

  if (json && "result" in json) {
    return "ok";
  }

  return "unknown";
}

function buildPathSummary(args: {
  path: "review" | "chat";
  pathEvents: PathEventObservation[];
  llmCalls: LlmCallObservation[];
  toolCalls: ToolCallObservation[];
}): PathSummary {
  const traceRunIds = new Set(
    args.pathEvents
      .map((event) => event.traceRunId)
      .filter((traceRunId): traceRunId is string => Boolean(traceRunId)),
  );
  const llmCalls = args.llmCalls.filter(
    (call) => call.traceRunId && traceRunIds.has(call.traceRunId),
  );
  const linkedPathEventCount = args.pathEvents.filter((event) => event.traceRunId)
    .length;
  const associatedToolCallCount = args.toolCalls.filter(
    (call) => call.traceRunId && traceRunIds.has(call.traceRunId),
  ).length;

  const summary: PathSummary = {
    path: args.path,
    count: args.pathEvents.length,
    traceRunCount: traceRunIds.size,
    missingTraceRunIdCount: args.pathEvents.filter((event) => !event.traceRunId)
      .length,
    llmCallCount: llmCalls.length,
    latency: {
      totalMs: summarizeLatency(args.pathEvents.map((event) => event.totalMs)),
      llmMsTotal: summarizeLatency(
        args.pathEvents.map((event) => event.llmMsTotal),
      ),
    },
    tokens: summarizeTokenCost(llmCalls),
  };

  if (args.path === "review") {
    summary.latency.runnerMs = summarizeLatency(
      args.pathEvents.map((event) => event.runnerMs),
    );
  } else {
    summary.latency.toolMsTotal = summarizeLatency(
      args.pathEvents.map((event) => event.toolMsTotal),
    );
    summary.toolCallsPerChat =
      linkedPathEventCount > 0
        ? associatedToolCallCount / linkedPathEventCount
        : null;
  }

  return summary;
}

function buildLlmCallGroups(
  calls: LlmCallObservation[],
): LlmCallGroupSummary[] {
  const groups = new Map<string, LlmCallObservation[]>();

  for (const call of calls) {
    const key = [
      call.path,
      call.task,
      call.model,
      call.responseModel,
      call.status,
    ].join("\u001f");
    const current = groups.get(key) ?? [];
    current.push(call);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];

      return {
        path: first.path,
        task: first.task,
        model: first.model,
        responseModel: first.responseModel,
        status: first.status,
        count: group.length,
        latencyMs: summarizeLatency(group.map((call) => call.latencyMs)),
        tokens: summarizeTokenCost(group),
        usageSourceBreakdown: countBy(group.map((call) => call.usageSource)),
        errorCount: group.filter((call) => call.status === "error" || call.errorMessage)
          .length,
        topErrors: topErrors(group),
      };
    })
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

function buildToolGroups(args: {
  toolCalls: ToolCallObservation[];
  toolResults: ToolResultObservation[];
}): ToolGroupSummary[] {
  const toolNames = new Set<string>([
    ...args.toolCalls.map((call) => call.toolName),
    ...args.toolResults.map((result) => result.toolName),
  ]);

  return [...toolNames]
    .map((toolName) => {
      const calls = args.toolCalls.filter((call) => call.toolName === toolName);
      const results = args.toolResults.filter((result) => result.toolName === toolName);
      const successCount = results.filter((result) => result.status === "ok").length;
      const errorResults = results.filter(
        (result) => result.status === "error" || result.errorKind,
      );
      const invalidArgsCount = errorResults.filter(
        (result) => result.errorKind === "invalid_args",
      ).length;
      const approxResultTokens = results
        .map((result) => result.approxResultTokens)
        .filter((value): value is number => value !== null);
      const denominator = calls.length || results.length;

      return {
        toolName,
        callCount: calls.length,
        resultCount: results.length,
        successCount,
        errorCount: errorResults.length,
        errorKindBreakdown: countBy(
          errorResults.map((result) => result.errorKind ?? "unknown_error"),
        ),
        latencyMs: summarizeLatency(results.map((result) => result.latencyMs)),
        avgApproxResultTokens:
          approxResultTokens.length > 0
            ? average(approxResultTokens)
            : null,
        invalidArgsCount,
        invalidArgsRate: rate(invalidArgsCount, denominator),
      };
    })
    .sort((a, b) => b.callCount - a.callCount || a.toolName.localeCompare(b.toolName));
}

function summarizeLatency(values: Array<number | null>): LatencySummary {
  const numericValues = values.filter((value): value is number => value !== null);

  return {
    count: numericValues.length,
    missingCount: values.length - numericValues.length,
    p50Ms: computePercentile(numericValues, 50),
    p95Ms: computePercentile(numericValues, 95),
  };
}

function summarizeProviderUsage(calls: LlmCallObservation[]) {
  const missingCount = calls.filter((call) => call.usageMissing).length;
  const presentCount = calls.length - missingCount;

  return {
    presentCount,
    missingCount,
    missingRate: rate(missingCount, calls.length),
  };
}

function buildTimeWindow(rows: AgentObservabilityTraceRow[]): TimeWindowSummary {
  if (rows.length === 0) {
    return { start: null, end: null };
  }

  const times = rows.map((row) => row.occurredAt.getTime());
  const start = new Date(Math.min(...times));
  const end = new Date(Math.max(...times));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function topErrors(calls: LlmCallObservation[]): ErrorFrequency[] {
  const counts = new Map<
    string,
    { message: string; code: string | null; count: number }
  >();

  for (const call of calls) {
    if (call.status !== "error" && !call.errorMessage) {
      continue;
    }

    const message = call.errorMessage ?? "unknown error";
    const code = call.errorCode ?? null;
    const key = code ? `${code}: ${message}` : message;
    const current = counts.get(key) ?? { message, code, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }

  return [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 5);
}

function addOldTraceWarnings(args: {
  warnings: string[];
  reviewEvents: PathEventObservation[];
  chatEvents: PathEventObservation[];
  llmCalls: LlmCallObservation[];
  toolCalls: ToolCallObservation[];
  toolResults: ToolResultObservation[];
}) {
  const missingPathTraceCount = [...args.reviewEvents, ...args.chatEvents].filter(
    (event) => !event.traceRunId,
  ).length;
  const missingPathTimingCount = [...args.reviewEvents, ...args.chatEvents].filter(
    (event) => event.totalMs === null,
  ).length;
  const missingLlmTraceCount = args.llmCalls.filter((call) => !call.traceRunId).length;
  const missingToolTraceCount = [...args.toolCalls, ...args.toolResults].filter(
    (event) => !event.traceRunId,
  ).length;

  if (missingPathTraceCount > 0) {
    args.warnings.push(
      `${missingPathTraceCount} completed path rows are missing traceRunId, so their LLM/tool costs cannot be linked.`,
    );
  }

  if (missingPathTimingCount > 0) {
    args.warnings.push(
      `${missingPathTimingCount} completed path rows are missing eventJson.timings.totalMs and are excluded from path latency percentiles.`,
    );
  }

  if (missingLlmTraceCount > 0) {
    args.warnings.push(
      `${missingLlmTraceCount} llm_call rows are missing traceRunId and are excluded from Review/Chat path cost rollups.`,
    );
  }

  if (missingToolTraceCount > 0) {
    args.warnings.push(
      `${missingToolTraceCount} tool rows are missing traceRunId and may be absent from avg tool calls per Chat.`,
    );
  }

  if (args.llmCalls.some((call) => !call.usageMissing && call.model === "unknown")) {
    args.warnings.push(
      "Some provider usage rows have unknown model ids; their tokens are counted but cost is unpriced.",
    );
  }

  args.warnings.push(
    "Estimated costs use provider usage only; missing usage is excluded from cost totals.",
  );
  args.warnings.push(
    "DeepSeek estimated input cost uses cache-miss pricing because L1 usage does not yet split cache-hit tokens.",
  );
  args.warnings.push(
    "DeepSeek foreground defaults use deepseek-v4-flash for non-thinking calls and deepseek-v4-pro for thinking calls; legacy deepseek-chat/deepseek-reasoner ids were retired on 2026-07-24 15:59 UTC.",
  );
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function totalAvg(total: number, count: number): NumericTotalAvg {
  return {
    total,
    avg: count > 0 ? total / count : null,
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
