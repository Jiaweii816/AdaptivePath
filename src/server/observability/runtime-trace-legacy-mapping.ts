import type {
  NormalizedTraceEvent,
  EventStatus,
  TracePath,
} from "@/server/observability/runtime-trace-contract";
import { captureNormalizedTraceEvent } from "@/server/observability/runtime-trace-capture";
import type { CapturedTraceEvent } from "@/server/observability/runtime-trace-capture";

export const LEGACY_TELEMETRY_EVENT_TYPES = [
  "llm_call",
  "tool_call",
  "tool_result",
  "retrieval_trace",
  "reply_safety_replaced",
] as const;

export type LegacyTelemetryEventType = (typeof LEGACY_TELEMETRY_EVENT_TYPES)[number];

export type LegacyL1TelemetryRow = {
  id: string;
  eventType: string;
  eventJson?: unknown;
  source?: string | null;
  occurredAt: string | Date;
};

const mappingTable = {
  llm_call: { stage: "legacy_llm", kind: "llm", title: "Legacy LLM call" },
  tool_call: { stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool call" },
  tool_result: { stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool result" },
  retrieval_trace: { stage: "legacy_context_memory", kind: "retrieval", title: "Legacy memory retrieval" },
  reply_safety_replaced: { stage: "legacy_guard", kind: "guard", title: "Legacy reply safety guard" },
} as const;

export function isLegacyTelemetryEventType(value: string): value is LegacyTelemetryEventType {
  return (LEGACY_TELEMETRY_EVENT_TYPES as readonly string[]).includes(value);
}

export function mapLegacyL1TelemetryEvent(
  row: LegacyL1TelemetryRow,
): CapturedTraceEvent {
  if (!isLegacyTelemetryEventType(row.eventType)) {
    throw new Error(`L1 event ${row.eventType} is not a telemetry-only legacy family.`);
  }

  const legacyJson = parseLegacyEventJson(row.eventJson);
  const mapping = mappingTable[row.eventType];
  const traceRunId = readString(legacyJson.traceRunId) ?? `legacy:run:${row.id}`;
  const legacyPath = mapLegacyPath(legacyJson.path, row.source);
  const eventWithoutDigest = {
    identity: {
      eventId: `legacy:l1:${row.id}`,
      traceRunId,
      stepId: readString(legacyJson.stepId),
      parentStepId: readString(legacyJson.parentStepId),
      stepIndex: readNonnegativeInteger(legacyJson.stepIndex),
      agentIteration: readNonnegativeInteger(legacyJson.agentIteration),
    },
    scope: {
      path: legacyPath.path,
      ...mapping,
    },
    lifecycle: {
      status: mapLegacyStatus(row.eventType, legacyJson),
      occurredAt: normalizeTimestamp(row.occurredAt),
      durationMs: readNonnegativeNumber(legacyJson.latencyMs),
    },
    details: withLegacySource(
      mapLegacyDetails(row.eventType, legacyJson),
      row.source,
    ),
    metrics: mapLegacyMetrics(row.eventType, legacyJson),
    capture: {
      unavailableFields: legacyUnavailableFields(
        row.eventType,
        legacyPath.unavailable,
        legacyJson,
      ),
    },
  };

  // Legacy payloads still pass through the same capture-time privacy and size
  // policy as new events. The digest therefore represents only the final
  // redacted/truncated representation that is safe to persist.
  return captureNormalizedTraceEvent(eventWithoutDigest, {
    detailLevel: "full",
  });
}

function mapLegacyPath(
  path: unknown,
  source: string | null | undefined,
): { path: TracePath; unavailable: boolean } {
  const normalized = readString(path)?.toLowerCase();
  if (normalized === "review" || normalized === "chat" || normalized === "practice_run" || normalized === "mock_interview") {
    return { path: normalized, unavailable: false };
  }
  if (normalized === "memory" || normalized === "memory_background") {
    return { path: "memory_background", unavailable: false };
  }

  const sourceValue = source?.toLowerCase() ?? "";
  if (sourceValue.startsWith("review")) return { path: "review", unavailable: false };
  if (sourceValue.startsWith("mock_interview")) return { path: "mock_interview", unavailable: false };
  if (sourceValue.startsWith("memory_agent")) return { path: "memory_background", unavailable: false };
  if (sourceValue === "chat_reply" || sourceValue.startsWith("chat")) return { path: "chat", unavailable: false };

  // Historical retrieval rows did not always carry path. Keep them unscoped and
  // mark the unavailable field instead of inventing a workspace Session.
  return { path: "memory_background", unavailable: true };
}

function mapLegacyStatus(eventType: LegacyTelemetryEventType, json: Record<string, unknown>): EventStatus {
  const status = readString(json.status)?.toLowerCase();
  if (status === "ok" || status === "reused" || status === "succeeded") return "succeeded";
  if (status === "error" || status === "failed") return "failed";
  if (status === "denied" || status === "skipped") return "skipped";
  if (status === "degraded") return "degraded";
  if (status === "started") return "started";
  if (eventType === "tool_call") return "started";
  if (eventType === "retrieval_trace") {
    const degraded = readString(json.degraded)?.trim().toLowerCase();
    const healthyLexicalMode = degraded === "fts_only" || degraded === "lexical_only";
    return json.degraded === true ||
      (degraded !== undefined && degraded !== "none" && !healthyLexicalMode)
      ? "degraded"
      : "succeeded";
  }
  if (eventType === "reply_safety_replaced") return "succeeded";
  if (json.error || json.errorKind) return "failed";
  // Historical tool results often omitted `status` while still carrying the
  // successful result payload. Preserve the pre-cutover reader semantics,
  // which treated those rows as successful, instead of inventing degradation.
  if (eventType === "tool_result" && "result" in json) return "succeeded";
  return "degraded";
}

function mapLegacyMetrics(eventType: LegacyTelemetryEventType, json: Record<string, unknown>) {
  if (eventType !== "llm_call") return undefined;
  const usage = asRecord(json.usage);
  const providerInputTokens = readNonnegativeInteger(
    usage.inputTokens ?? json["gen_ai.usage.input_tokens"],
  );
  const providerOutputTokens = readNonnegativeInteger(
    usage.outputTokens ?? json["gen_ai.usage.output_tokens"],
  );
  const providerTotalTokens = readNonnegativeInteger(
    usage.totalTokens ?? json["gen_ai.usage.total_tokens"],
  );
  const providerCachedTokens = readFirstNonnegativeInteger(
    json.providerCachedTokens,
    json.cachedTokens,
    asRecord(usage.promptTokensDetails).cachedTokens,
    asRecord(usage.prompt_tokens_details).cached_tokens,
  );
  const providerReasoningTokens = readFirstNonnegativeInteger(
    json.providerReasoningTokens,
    json.reasoningTokens,
    asRecord(usage.completionTokensDetails).reasoningTokens,
    asRecord(usage.completion_tokens_details).reasoning_tokens,
  );
  const hasProviderUsage = [
    providerInputTokens,
    providerOutputTokens,
    providerTotalTokens,
    providerCachedTokens,
    providerReasoningTokens,
  ].some((value) => value !== undefined);
  const usageSource =
    json.usageSource === "provider" || hasProviderUsage
      ? ("provider" as const)
      : ("missing" as const);
  const missingReason: "error_response" | "provider_omitted" | undefined =
    usageSource === "missing" &&
    (json.usageMissingReason === "error_response" || json.usageMissingReason === "provider_omitted")
      ? json.usageMissingReason
      : undefined;

  return {
    providerInputTokens,
    providerOutputTokens,
    providerTotalTokens,
    providerCachedTokens,
    providerReasoningTokens,
    usageSource,
    usageMissingReason: missingReason,
  };
}

function legacyUnavailableFields(
  eventType: LegacyTelemetryEventType,
  pathUnavailable: boolean,
  json?: Record<string, unknown>,
) {
  const common = [
    "workspaceSessionId",
    ...(pathUnavailable ? ["path"] : []),
    ...(readString(json?.traceRunId) === undefined ? ["traceRunId"] : []),
  ];
  if (eventType === "llm_call") {
    const metrics = mapLegacyMetrics(eventType, json ?? {});
    return [
      ...common,
      "prompt",
      "rawResponse",
      ...(metrics?.providerCachedTokens === undefined
        ? ["providerCachedTokens"]
        : []),
      ...(metrics?.providerReasoningTokens === undefined
        ? ["providerReasoningTokens"]
        : []),
    ];
  }
  return [
    ...common,
    ...((eventType === "tool_call" || eventType === "tool_result") &&
    readNonnegativeInteger(json?.agentIteration) === undefined
      ? ["agentIteration"]
      : []),
  ];
}

function mapLegacyDetails(
  eventType: LegacyTelemetryEventType,
  json: Record<string, unknown>,
): NormalizedTraceEvent["details"] {
  if (eventType === "tool_call") {
    return {
      input: json.arguments,
      metadata: omitKeys(json, ["arguments"]),
    };
  }
  if (eventType === "tool_result") {
    return {
      output: json.result,
      metadata: omitKeys(json, ["result"]),
    };
  }
  if (eventType === "retrieval_trace") {
    return {
      retrieval: json,
      metadata: pickKeys(json, [
        "profileId",
        "traceCorrelationId",
        "degraded",
      ]),
    };
  }
  if (eventType === "reply_safety_replaced") {
    return {
      output: pickKeys(json, [
        "rawLlmReply",
        "originalReply",
        "replacement",
      ]),
      stateDelta: pickKeys(json, ["reason", "guard", "strategy"]),
      metadata: omitKeys(json, [
        "rawLlmReply",
        "originalReply",
        "replacement",
      ]),
    };
  }
  return { metadata: json };
}

function withLegacySource(
  details: NormalizedTraceEvent["details"],
  source: string | null | undefined,
): NormalizedTraceEvent["details"] {
  if (!source) return details;
  return {
    ...details,
    metadata: {
      ...details?.metadata,
      source,
    },
  };
}

function pickKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    keys.flatMap((key) => (key in value ? [[key, value[key]]] : [])),
  );
}

function omitKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const omitted = new Set(keys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omitted.has(key)),
  );
}

function parseLegacyEventJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNonnegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readNonnegativeInteger(value: unknown) {
  const number = readNonnegativeNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function readFirstNonnegativeInteger(...values: unknown[]) {
  for (const value of values) {
    const number = readNonnegativeInteger(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function normalizeTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid legacy occurredAt: ${String(value)}`);
  return date.toISOString();
}
