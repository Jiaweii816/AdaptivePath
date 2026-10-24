import { createHash } from "node:crypto";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_OPERATION_NAME_VALUE_CHAT,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
} from "@opentelemetry/semantic-conventions/incubating";
import type { AgentObservabilityTraceRow } from "@/server/observability/agent-observability";

export type GenAiSpan = {
  traceId: string;
  spanId: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, string | number>;
  kind: "llm" | "tool" | "path";
};

type JsonRecord = Record<string, unknown>;

type ParsedRow = {
  row: AgentObservabilityTraceRow;
  json: JsonRecord;
  traceRunId: string;
  startMs: number;
};

/**
 * Convert the legacy/formal observability projection into an exporter-neutral
 * span description. IDs are hashes instead of padded database IDs so every ID
 * is valid OpenTelemetry hex while rows from one traceRunId still share a trace.
 */
export function mapRowsToSpans(
  rows: AgentObservabilityTraceRow[],
): GenAiSpan[] {
  const parsedRows = rows.map(parseRow);
  const toolResults = indexToolResults(parsedRows);

  return parsedRows
    .flatMap((parsed): GenAiSpan[] => {
      if (parsed.row.eventType === "llm_call") {
        return [mapLlmSpan(parsed)];
      }

      if (parsed.row.eventType === "tool_call") {
        return [mapToolSpan(parsed, toolResults)];
      }

      if (
        parsed.row.eventType === "coach_reply" ||
        parsed.row.eventType === "chat_reply"
      ) {
        return [mapPathSpan(parsed)];
      }

      // A tool_result supplies the duration/status of its tool_call span. It is
      // not emitted separately, which avoids two waterfall spans for one call.
      return [];
    })
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.spanId.localeCompare(right.spanId),
    );
}

function mapLlmSpan(parsed: ParsedRow): GenAiSpan {
  const { json, row } = parsed;
  const usage = asRecord(json.usage);
  const task = readString(json.task) ?? taskFromSource(row.source) ?? "unknown";
  const model =
    readString(json.model) ?? readString(json[ATTR_GEN_AI_REQUEST_MODEL]);
  const provider =
    readString(json[ATTR_GEN_AI_PROVIDER_NAME]) ??
    readString(json.provider) ??
    inferProvider(model) ??
    readString(json.pricingProvider);
  const inputTokens =
    readNonNegativeNumber(usage?.inputTokens) ??
    readNonNegativeNumber(json[ATTR_GEN_AI_USAGE_INPUT_TOKENS]);
  const outputTokens =
    readNonNegativeNumber(usage?.outputTokens) ??
    readNonNegativeNumber(json[ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]);
  const attributes: Record<string, string | number> = {
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_CHAT,
    "patterncoach.task": task,
  };

  setStringAttribute(attributes, ATTR_GEN_AI_PROVIDER_NAME, provider);
  setStringAttribute(attributes, ATTR_GEN_AI_REQUEST_MODEL, model);
  setNumberAttribute(attributes, ATTR_GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
  setNumberAttribute(attributes, ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
  setStringAttribute(attributes, "patterncoach.path", readString(json.path));
  setStringAttribute(attributes, "patterncoach.status", readString(json.status));

  return spanBase(parsed, {
    name: `${GEN_AI_OPERATION_NAME_VALUE_CHAT} ${model ?? task}`,
    durationMs: readDuration(json.latencyMs),
    timestampRole: "end",
    attributes,
    kind: "llm",
  });
}

function mapToolSpan(
  parsed: ParsedRow,
  toolResults: Map<string, ParsedRow>,
): GenAiSpan {
  const { json } = parsed;
  const result = toolResults.get(toolCorrelationKey(parsed));
  const toolName =
    readString(json.toolName) ?? readString(result?.json.toolName) ?? "unknown";
  const attributes: Record<string, string | number> = {
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
    [ATTR_GEN_AI_TOOL_NAME]: toolName,
  };

  setStringAttribute(
    attributes,
    "patterncoach.status",
    readString(result?.json.status) ?? readString(json.status),
  );

  return spanBase(parsed, {
    name: `${GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL} ${toolName}`,
    durationMs:
      readDuration(result?.json.latencyMs) ?? readDuration(json.latencyMs),
    attributes,
    kind: "tool",
  });
}

function mapPathSpan(parsed: ParsedRow): GenAiSpan {
  const { json, row } = parsed;
  const timings = asRecord(json.timings);
  const path = row.eventType === "coach_reply" ? "review" : "chat";
  const attributes: Record<string, string | number> = {
    "patterncoach.path": readString(json.path) ?? path,
    "patterncoach.event_type": row.eventType,
  };
  setStringAttribute(attributes, "patterncoach.status", readString(json.status));

  return spanBase(parsed, {
    name: `${path} turn`,
    durationMs:
      readDuration(timings?.totalMs) ?? readDuration(json.latencyMs),
    timestampRole: "end",
    attributes,
    kind: "path",
  });
}

function spanBase(
  parsed: ParsedRow,
  input: {
    name: string;
    durationMs: number | undefined;
    timestampRole?: "start" | "end";
    attributes: Record<string, string | number>;
    kind: GenAiSpan["kind"];
  },
): GenAiSpan {
  const durationMs = input.durationMs ?? 0;
  const startMs =
    input.timestampRole === "end"
      ? Math.max(0, parsed.startMs - durationMs)
      : parsed.startMs;
  const endMs =
    input.timestampRole === "end" ? parsed.startMs : parsed.startMs + durationMs;
  return {
    traceId: otelHexId(`trace:${parsed.traceRunId}`, 32),
    spanId: otelHexId(
      `span:${parsed.traceRunId}:${parsed.row.id}:${parsed.row.eventType}`,
      16,
    ),
    name: input.name,
    startMs,
    endMs,
    attributes: input.attributes,
    kind: input.kind,
  };
}

function parseRow(row: AgentObservabilityTraceRow): ParsedRow {
  const json = parseJsonRecord(row.eventJson);
  const explicitTraceRunId =
    readString(json.traceRunId) ??
    readString((row as AgentObservabilityTraceRow & { traceRunId?: unknown }).traceRunId);

  return {
    row,
    json,
    // Missing IDs must not merge unrelated rows into one fabricated trace.
    traceRunId: explicitTraceRunId ?? `unscoped:${row.id}`,
    startMs: readDateMs(row.occurredAt) ?? readDateMs(row.createdAt) ?? 0,
  };
}

function indexToolResults(rows: ParsedRow[]) {
  const results = new Map<string, ParsedRow>();
  for (const row of rows) {
    if (row.row.eventType !== "tool_result") continue;
    const key = toolCorrelationKey(row);
    const current = results.get(key);
    if (!current || row.startMs < current.startMs) results.set(key, row);
  }
  return results;
}

function toolCorrelationKey(parsed: ParsedRow) {
  const stepId = readString(parsed.json.stepId);
  if (stepId) return `${parsed.traceRunId}:step:${stepId}`;

  const toolCallId = readString(parsed.json.toolCallId);
  if (toolCallId) return `${parsed.traceRunId}:call:${toolCallId}`;

  return `${parsed.traceRunId}:tool:${readString(parsed.json.toolName) ?? "unknown"}`;
}

function otelHexId(seed: string, length: 16 | 32) {
  return createHash("sha256").update(seed).digest("hex").slice(0, length);
}

function parseJsonRecord(value: string): JsonRecord {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readDuration(value: unknown) {
  return readNonNegativeNumber(value);
}

function readDateMs(value: Date) {
  const time = value.getTime();
  return Number.isFinite(time) ? time : undefined;
}

function setStringAttribute(
  attributes: Record<string, string | number>,
  name: string,
  value: string | undefined,
) {
  if (value !== undefined) attributes[name] = value;
}

function setNumberAttribute(
  attributes: Record<string, string | number>,
  name: string,
  value: number | undefined,
) {
  if (value !== undefined) attributes[name] = value;
}

function taskFromSource(source: string | null) {
  const separator = source?.indexOf(":") ?? -1;
  return separator >= 0 ? readString(source?.slice(separator + 1)) : undefined;
}

function inferProvider(model: string | undefined) {
  const normalized = model?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("qwen")) return "qwen";
  if (/^(gpt-|o\d|text-embedding-)/u.test(normalized)) return "openai";
  if (normalized.includes("claude")) return "anthropic";
  return undefined;
}
