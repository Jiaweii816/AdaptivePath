import { createHash } from "node:crypto";
import {
  normalizedTraceEventSchema,
  type NormalizedTraceEvent,
} from "@/server/observability/runtime-trace-contract";

export const DEFAULT_TRACE_CAPTURE_LIMITS = {
  // The Coach system prompt runs a little over 8 KiB, so an 8 KiB cap punched a hole
  // through the middle of the single message a reader most needs to see intact — and
  // the trace could only report that it had done so. 32 KiB keeps it whole with room
  // to grow; the truncation machinery stays for messages that genuinely overrun.
  promptMessageBytes: 32 * 1024,
  promptTotalBytes: 128 * 1024,
  rawModelResponseBytes: 32 * 1024,
  toolArgumentsBytes: 16 * 1024,
  toolResultBytes: 16 * 1024,
  stdoutBytes: 16 * 1024,
  stderrBytes: 16 * 1024,
  codeSnapshotBytes: 32 * 1024,
  retrievalItemCount: 50,
  retrievalItemBytes: 1024,
} as const;

export type TraceCaptureLimits = {
  [Key in keyof typeof DEFAULT_TRACE_CAPTURE_LIMITS]: number;
};
export type TraceSecretEnvironment = Readonly<Record<string, string | undefined>>;
export type TraceCaptureLevel = NormalizedTraceEvent["capture"]["detailLevel"];

const CAPTURED_TRACE_EVENT = Symbol("patterncoach.captured-trace-event");
export type CapturedTraceEvent = NormalizedTraceEvent & {
  readonly [CAPTURED_TRACE_EVENT]: true;
};

export type PreCaptureTraceEvent = Omit<
  NormalizedTraceEvent,
  "identity" | "capture"
> & {
  identity: Omit<NormalizedTraceEvent["identity"], "eventDigest"> & {
    eventDigest?: string;
  };
  capture?: Partial<NormalizedTraceEvent["capture"]>;
};

export type CaptureTraceEventOptions = {
  detailLevel: TraceCaptureLevel;
  limits?: Partial<TraceCaptureLimits>;
  secretValues?: readonly string[];
  env?: TraceSecretEnvironment;
};

type CaptureState = {
  redactedFields: Set<string>;
  truncatedFields: Set<string>;
  secretValues: string[];
  limits: TraceCaptureLimits;
  retrievalItemsRemaining: number;
};

const REDACTED_VALUE = "[REDACTED]";
const REASONING_REDACTED_VALUE = "[REDACTED: reasoning text not captured]";
const SUMMARY_ONLY_VALUE = "summary_only";
const MIN_CAPTURE_LIMIT_BYTES = 64;

const SECRET_ENV_NAME =
  /(?:api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|cookie|password|passwd|client[_-]?secret|leetcode[_-]?session|secret)/i;

const SECRET_KEY_NAMES = new Set([
  "apikey",
  "authorization",
  "proxyauthorization",
  "authheader",
  "authtoken",
  "cookie",
  "setcookie",
  "leetcodesession",
  "password",
  "passwd",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "idtoken",
  "clientsecret",
  "secret",
]);

const REASONING_KEY_NAMES = new Set([
  "reasoning",
  "reasoningcontent",
  "reasoningtext",
  "chainofthought",
  "thinking",
  "thinkingcontent",
  "thinkingtext",
]);

/**
 * Applies the capture policy before any payload is persisted. The returned
 * digest is computed over the final redacted/truncated/summary-shaped event.
 */
export function captureNormalizedTraceEvent(
  input: PreCaptureTraceEvent,
  options: CaptureTraceEventOptions,
): CapturedTraceEvent {
  const state: CaptureState = {
    redactedFields: new Set(input.capture?.redactedFields ?? []),
    truncatedFields: new Set(input.capture?.truncatedFields ?? []),
    secretValues: normalizeSecretValues([
      ...collectEnvironmentSecretValues(options.env ?? process.env),
      ...(options.secretValues ?? []),
    ]),
    limits: resolveLimits(options.limits),
    retrievalItemsRemaining:
      options.limits?.retrievalItemCount ??
      DEFAULT_TRACE_CAPTURE_LIMITS.retrievalItemCount,
  };

  const redacted = redactDeep(input, "$", state) as PreCaptureTraceEvent;
  const details =
    options.detailLevel === "full"
      ? captureFullDetails(redacted.details, redacted.scope.kind, state)
      : captureSummaryDetails(redacted.details);

  const eventWithoutDigest = {
    ...redacted,
    identity: {
      ...redacted.identity,
      eventDigest: undefined,
    },
    details,
    capture: {
      detailLevel: options.detailLevel,
      payloadState:
        options.detailLevel === "full"
          ? ("captured" as const)
          : ("summary_only" as const),
      redactedFields: nonEmptySorted(state.redactedFields),
      truncatedFields: nonEmptySorted(state.truncatedFields),
      unavailableFields: input.capture?.unavailableFields,
    },
  };
  const eventDigest = computeTraceEventDigest(eventWithoutDigest);

  const captured = normalizedTraceEventSchema.parse({
    ...eventWithoutDigest,
    identity: {
      ...eventWithoutDigest.identity,
      eventDigest,
    },
  });
  Object.defineProperty(captured, CAPTURED_TRACE_EVENT, {
    value: true,
    enumerable: false,
  });
  return captured as CapturedTraceEvent;
}

export function isCapturedTraceEvent(
  event: NormalizedTraceEvent,
): event is CapturedTraceEvent {
  return (event as Partial<CapturedTraceEvent>)[CAPTURED_TRACE_EVENT] === true;
}

/** Computes the canonical digest while always excluding an existing digest. */
export function computeTraceEventDigest(
  event: Omit<NormalizedTraceEvent, "identity"> & {
    identity: Omit<NormalizedTraceEvent["identity"], "eventDigest"> & {
      eventDigest?: string;
    };
  },
) {
  const canonicalEvent = {
    ...event,
    identity: {
      ...event.identity,
      eventDigest: undefined,
    },
  };

  return createHash("sha256")
    .update(stableStringify(canonicalEvent))
    .digest("hex");
}

export function collectEnvironmentSecretValues(
  env: TraceSecretEnvironment,
): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && Boolean(value))
    .map(([, value]) => value as string)
    // Tiny environment values are too collision-prone for safe global string
    // replacement. Their named fields are still redacted by key.
    .filter((value) => Buffer.byteLength(value, "utf8") >= 8);
}

/**
 * Truncates by UTF-8 bytes without splitting a Unicode code point. The marker
 * is inline and the original head and tail are both retained.
 */
export function truncateUtf8HeadTail(value: string, maxBytes: number): string {
  assertByteLimit(maxBytes);
  const originalBytes = Buffer.byteLength(value, "utf8");
  if (originalBytes <= maxBytes) {
    return value;
  }

  const marker = `\n…[TRUNCATED: ${originalBytes} UTF-8 BYTES]…\n`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= maxBytes) {
    return takeUtf8Prefix(marker, maxBytes);
  }

  const contentBudget = maxBytes - markerBytes;
  const headBudget = Math.ceil(contentBudget / 2);
  const tailBudget = Math.floor(contentBudget / 2);
  const head = takeUtf8Prefix(value, headBudget);
  const tail = takeUtf8Suffix(value, tailBudget);

  return `${head}${marker}${tail}`;
}

function captureFullDetails(
  details: NormalizedTraceEvent["details"],
  kind: NormalizedTraceEvent["scope"]["kind"],
  state: CaptureState,
): NormalizedTraceEvent["details"] {
  if (!details) {
    return undefined;
  }

  const captured = { ...details };

  if (captured.prompt) {
    captured.prompt = capturePrompt(captured.prompt, state);
  }

  if (captured.retrieval !== undefined) {
    captured.retrieval = captureRetrievalValue(
      captured.retrieval,
      "$.details.retrieval",
      state,
    );
  }

  if (kind === "tool") {
    if (captured.input !== undefined) {
      captured.input = truncateUnknownValue(
        captured.input,
        state.limits.toolArgumentsBytes,
        "$.details.input",
        state,
      );
    }
    if (captured.output !== undefined) {
      captured.output = truncateUnknownValue(
        captured.output,
        state.limits.toolResultBytes,
        "$.details.output",
        state,
      );
    }
  } else if (kind === "llm" && captured.output !== undefined) {
    captured.output = truncateUnknownValue(
      captured.output,
      state.limits.rawModelResponseBytes,
      "$.details.output",
      state,
    );
  }

  return applyNamedFieldLimits(captured, "$.details", state) as typeof captured;
}

function captureSummaryDetails(
  details: NormalizedTraceEvent["details"],
): NormalizedTraceEvent["details"] {
  if (!details) {
    return undefined;
  }

  return {
    input:
      details.input === undefined ? undefined : summarizeUnknown(details.input),
    prompt: details.prompt?.map((message) => ({
      role: message.role,
      content: summarizeUnknown(message.content),
      estimatedTokens: message.estimatedTokens,
    })),
    retrieval:
      details.retrieval === undefined
        ? undefined
        : summarizeUnknown(details.retrieval),
    output:
      details.output === undefined ? undefined : summarizeUnknown(details.output),
    stateDelta:
      details.stateDelta === undefined
        ? undefined
        : summarizeUnknown(details.stateDelta),
    memoryDelta:
      details.memoryDelta === undefined
        ? undefined
        : summarizeUnknown(details.memoryDelta),
    metadata:
      details.metadata === undefined
        ? undefined
        : summarizeMetadata(details.metadata),
  };
}

function capturePrompt(
  prompt: NonNullable<NormalizedTraceEvent["details"]>["prompt"],
  state: CaptureState,
) {
  if (!prompt) {
    return prompt;
  }

  const messages = prompt.map((message, index) => ({
    ...message,
    content: truncateUnknownValue(
      message.content,
      state.limits.promptMessageBytes,
      `$.details.prompt[${index}].content`,
      state,
    ),
  }));

  if (utf8JsonBytes(messages) <= state.limits.promptTotalBytes) {
    return messages;
  }

  const retained = [...messages];
  let removed = 0;
  while (
    retained.length > 2 &&
    utf8JsonBytes(withPromptElision(retained, removed || 1)) >
      state.limits.promptTotalBytes
  ) {
    retained.splice(Math.floor(retained.length / 2), 1);
    removed += 1;
  }

  state.truncatedFields.add("$.details.prompt");
  const withElision = withPromptElision(retained, removed);
  if (utf8JsonBytes(withElision) <= state.limits.promptTotalBytes) {
    return withElision;
  }

  // This can only be reached with unusually small custom limits. Preserve the
  // first and last message roles while applying a fair remaining byte budget.
  return withElision.map((message, index) => ({
    ...message,
    content: truncateUnknownValue(
      message.content,
      Math.max(
        MIN_CAPTURE_LIMIT_BYTES,
        Math.floor(state.limits.promptTotalBytes / withElision.length) - 64,
      ),
      `$.details.prompt[${index}].content`,
      state,
    ),
  }));
}

function withPromptElision(
  retained: NonNullable<NormalizedTraceEvent["details"]>["prompt"],
  removed: number,
) {
  if (!retained || removed <= 0) {
    return retained ?? [];
  }

  const insertionIndex = Math.ceil(retained.length / 2);
  return [
    ...retained.slice(0, insertionIndex),
    {
      role: "trace_capture",
      content: `…[TRUNCATED: ${removed} PROMPT MESSAGE${removed === 1 ? "" : "S"}]…`,
    },
    ...retained.slice(insertionIndex),
  ];
}

function captureRetrievalValue(
  value: unknown,
  path: string,
  state: CaptureState,
): unknown {
  if (Array.isArray(value)) {
    const limited = limitRetrievalArrayHeadTail(
      value,
      path,
      state,
    );
    return limited.map((item, index) =>
      isElisionItem(item)
        ? item
        : truncateUnknownValue(
            item,
            state.limits.retrievalItemBytes,
            `${path}[${index}]`,
            state,
          ),
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        captureRetrievalValue(child, childPath(path, key), state),
      ]),
    );
  }

  return value;
}

function applyNamedFieldLimits(
  value: unknown,
  path: string,
  state: CaptureState,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      applyNamedFieldLimits(item, `${path}[${index}]`, state),
    );
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const nextPath = childPath(path, key);
      const normalizedKey = normalizeKey(key);
      const limit =
        normalizedKey === "stdout"
          ? state.limits.stdoutBytes
          : normalizedKey === "stderr"
            ? state.limits.stderrBytes
            : normalizedKey === "code" || normalizedKey === "codesnapshot"
              ? state.limits.codeSnapshotBytes
              : undefined;
      const limited =
        limit === undefined
          ? child
          : truncateUnknownValue(child, limit, nextPath, state);
      return [key, applyNamedFieldLimits(limited, nextPath, state)];
    }),
  );
}

function truncateUnknownValue(
  value: unknown,
  maxBytes: number,
  path: string,
  state: CaptureState,
): unknown {
  assertByteLimit(maxBytes);
  const serialized = typeof value === "string" ? value : safeJsonStringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return value;
  }

  state.truncatedFields.add(path);
  return truncateUtf8HeadTail(serialized, maxBytes);
}

function redactDeep(value: unknown, path: string, state: CaptureState): unknown {
  if (typeof value === "string") {
    const redacted = redactString(value, state.secretValues);
    if (redacted !== value) {
      state.redactedFields.add(path);
    }
    return redacted;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactDeep(item, `${path}[${index}]`, state));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const nextPath = childPath(path, key);
      if (isReasoningField(key) && isReasoningPayload(child)) {
        state.redactedFields.add(nextPath);
        return [key, REASONING_REDACTED_VALUE];
      }
      if (isSecretField(key)) {
        state.redactedFields.add(nextPath);
        return [key, REDACTED_VALUE];
      }
      if (
        normalizeKey(key) === "content" &&
        readRole(value) === "reasoning"
      ) {
        state.redactedFields.add(nextPath);
        return [key, REASONING_REDACTED_VALUE];
      }
      return [key, redactDeep(child, nextPath, state)];
    }),
  );
}

function redactString(value: string, secretValues: readonly string[]) {
  let result = value;
  for (const secret of secretValues) {
    result = result.split(secret).join(REDACTED_VALUE);
  }

  result = result
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_-]?key|authorization|leetcode[_-]?session|cookie)\s*[:=]\s*)(["']?)[^\s,;"']+\2/gi,
      "$1[REDACTED]",
    )
    .replace(
      /("(?:reasoning_content|reasoning|chain_of_thought|thinking_content)"\s*:\s*")((?:\\.|[^"\\])*)"/gi,
      '$1[REDACTED: reasoning text not captured]"',
    )
    .replace(
      /<(think|reasoning)>[\s\S]*?<\/\1>/gi,
      "<$1>[REDACTED: reasoning text not captured]</$1>",
    );

  return result;
}

function summarizeUnknown(value: unknown) {
  const serialized = safeJsonStringify(value);
  const summary: Record<string, unknown> = {
    capture: SUMMARY_ONLY_VALUE,
    valueType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
    utf8Bytes: Buffer.byteLength(serialized, "utf8"),
  };

  if (Array.isArray(value)) {
    summary.itemCount = value.length;
  } else if (isRecord(value)) {
    summary.keys = Object.keys(value).sort().slice(0, 20);
  }

  return summary;
}

function summarizeMetadata(metadata: Record<string, unknown>) {
  const retainedStructuredKeys = new Set(["strategySignals", "timings"]);
  const scalarEntries = Object.entries(metadata).filter(
    ([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value),
  );
  const structuredEntries = Object.entries(metadata).filter(
    ([key, value]) => retainedStructuredKeys.has(key) && value !== undefined,
  );
  // toolCalls is what FunctionCallPanel renders. Its arguments can carry the
  // learner's full solution plus a test array — too large for summary-detail
  // capture — but the tool name and call id are the minimum needed to answer
  // "what did this turn call?", so they must survive even at summary level.
  const toolCalls = metadata.toolCalls;
  const toolCallsEntry: Array<[string, unknown]> =
    Array.isArray(toolCalls) && toolCalls.length > 0
      ? [["toolCalls", summarizeToolCallsForMetadata(toolCalls)]]
      : [];

  return Object.fromEntries(
    [...scalarEntries, ...structuredEntries, ...toolCallsEntry].slice(0, 50),
  );
}

function summarizeToolCallsForMetadata(toolCalls: unknown[]) {
  return toolCalls.map((call) => {
    if (!call || typeof call !== "object") return call;
    const record = call as Record<string, unknown>;
    return {
      id: record.id,
      name: record.name,
      arguments: summarizeUnknown(record.arguments),
    };
  });
}

function limitRetrievalArrayHeadTail(
  values: unknown[],
  path: string,
  state: CaptureState,
) {
  const limit = state.retrievalItemsRemaining;
  if (values.length <= limit) {
    state.retrievalItemsRemaining -= values.length;
    return values;
  }

  state.truncatedFields.add(path);
  if (limit <= 1) {
    state.retrievalItemsRemaining = 0;
    return [
      {
        traceCaptureElision: `…[TRUNCATED: ${values.length} RETRIEVAL ITEMS]…`,
      },
    ];
  }

  const retainedCount = limit - 1;
  const headCount = Math.ceil(retainedCount / 2);
  const tailCount = Math.floor(retainedCount / 2);
  state.retrievalItemsRemaining = 0;
  return [
    ...values.slice(0, headCount),
    {
      traceCaptureElision: `…[TRUNCATED: ${values.length - retainedCount} RETRIEVAL ITEMS]…`,
    },
    ...values.slice(values.length - tailCount),
  ];
}

function isElisionItem(value: unknown) {
  return isRecord(value) && typeof value.traceCaptureElision === "string";
}

function resolveLimits(overrides?: Partial<TraceCaptureLimits>): TraceCaptureLimits {
  const limits = { ...DEFAULT_TRACE_CAPTURE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (name === "retrievalItemCount") {
      if (!Number.isInteger(value) || value < 2) {
        throw new Error(`${name} must be an integer >= 2.`);
      }
      continue;
    }
    assertByteLimit(value, name);
  }
  return limits;
}

function assertByteLimit(value: number, name = "maxBytes") {
  if (!Number.isInteger(value) || value < MIN_CAPTURE_LIMIT_BYTES) {
    throw new Error(`${name} must be an integer >= ${MIN_CAPTURE_LIMIT_BYTES}.`);
  }
}

function normalizeSecretValues(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
}

function isSecretField(key: string) {
  const normalized = normalizeKey(key);
  return (
    SECRET_KEY_NAMES.has(normalized) ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("leetcodesession")
  );
}

function isReasoningField(key: string) {
  return REASONING_KEY_NAMES.has(normalizeKey(key));
}

function isReasoningPayload(value: unknown) {
  return typeof value === "string" || (typeof value === "object" && value !== null);
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readRole(value: Record<string, unknown>) {
  return typeof value.role === "string" ? value.role.toLowerCase() : undefined;
}

function childPath(parent: string, key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function takeUtf8Prefix(value: string, maxBytes: number) {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function takeUtf8Suffix(value: string, maxBytes: number) {
  let bytes = 0;
  const result: string[] = [];
  const characters = Array.from(value);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result.push(character);
    bytes += characterBytes;
  }
  return result.reverse().join("");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function utf8JsonBytes(value: unknown) {
  return Buffer.byteLength(safeJsonStringify(value), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptySorted(values: Set<string>) {
  const sorted = [...values].sort();
  return sorted.length > 0 ? sorted : undefined;
}
