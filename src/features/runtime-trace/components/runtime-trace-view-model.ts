// View-model type declarations live in ./runtime-trace-types; re-exported
// here so existing `from "./runtime-trace-view-model"` imports (and the
// components/index.ts barrel's `export *`) keep working unchanged.
export * from "./runtime-trace-types";
import type {
  RuntimeTraceEventViewModel,
  RuntimeTracePromptPart,
  RuntimeTraceRunViewModel,
  RuntimeTraceStatus,
  RuntimeTraceTurnGroup,
} from "./runtime-trace-types";

const ATTENTION_STATUSES = new Set(["failed", "degraded", "incomplete"]);
const LIVE_STATUSES = new Set(["started", "running", "open", "active", "pending"]);
/** Kinds a debugger reaches for first: something broke, or a tool actually did something. */
const AUTO_EXPAND_KINDS = new Set(["error", "tool"]);

export function buildRuntimeTraceTimeline(
  runs: readonly RuntimeTraceRunViewModel[],
  events: readonly RuntimeTraceEventViewModel[],
): RuntimeTraceTurnGroup[] {
  const ordinals = new Set<number>();
  for (const run of runs) {
    const ordinal = run.turnOrdinal ?? run.originatingTurnOrdinal;
    if (ordinal !== null && ordinal !== undefined) ordinals.add(ordinal);
  }
  for (const event of events) {
    if (event.turnOrdinal !== null && event.turnOrdinal !== undefined) {
      ordinals.add(event.turnOrdinal);
    }
  }

  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
  const latestOrdinal = sortedOrdinals.at(-1);

  return sortedOrdinals.map((turnOrdinal) => {
    const turnRuns = runs.filter(
      (run) =>
        run.turnOrdinal === turnOrdinal ||
        (run.turnOrdinal === null && run.originatingTurnOrdinal === turnOrdinal),
    );
    const runIds = new Set(turnRuns.map((run) => run.id));
    const turnEvents = events.filter(
      (event) => event.turnOrdinal === turnOrdinal || runIds.has(event.traceRunId),
    );
    const rootRun = turnRuns.find((run) => run.turnOrdinal === turnOrdinal);
    const orderedEvents = pairToolEvents(
      [...turnEvents].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0)),
    );
    const isLatest = turnOrdinal === latestOrdinal;

    return {
      key: `turn:${turnOrdinal}`,
      turnOrdinal,
      rootRun,
      runs: turnRuns,
      events: orderedEvents,
      isLatest,
      autoExpand:
        isLatest ||
        isLiveStatus(rootRun?.status) ||
        isAttentionStatus(rootRun?.status) ||
        isAttentionStatus(rootRun?.traceCompleteness) ||
        turnEvents.some(shouldAutoExpandEvent),
    };
  });
}

export function shouldAutoExpandEvent(event: RuntimeTraceEventViewModel) {
  return (
    AUTO_EXPAND_KINDS.has(event.kind) ||
    isAttentionStatus(event.status) ||
    isLiveStatus(event.status)
  );
}

export function isLiveStatus(status: RuntimeTraceStatus | null | undefined) {
  return status ? LIVE_STATUSES.has(status) : false;
}

export function isAttentionStatus(status: RuntimeTraceStatus | null | undefined) {
  return status ? ATTENTION_STATUSES.has(status) : false;
}

export function humanizeTraceLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Lighter-weight than humanizeTraceLabel: underscores to spaces, no title-casing. */
export function humanizeStatus(value: string) {
  return value.replace(/_/g, " ");
}

export function formatTraceDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

export function formatTraceTokens(tokens: number | null | undefined) {
  if (tokens === null || tokens === undefined) return "—";
  return `${new Intl.NumberFormat("en-US").format(tokens)} tok`;
}

export function formatTraceCost(
  cost: number | null | undefined,
  pricingStatus: string | null | undefined,
) {
  if (pricingStatus === "unpriced") return "unpriced";
  if (cost === null || cost === undefined) return "—";
  const formatted = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  return `$${formatted}${pricingStatus === "partial" ? " known" : ""}`;
}

/**
 * Narrows the flat, seq-ordered event list to what a debugger actually asked for:
 * a subset of kinds (the loop vs. pipeline noise), free text against title and
 * payload, or both together.
 */
export function filterTraceEvents(
  events: readonly RuntimeTraceEventViewModel[],
  filter: { kinds?: readonly string[]; query?: string },
): RuntimeTraceEventViewModel[] {
  const kinds = filter.kinds?.length ? new Set(filter.kinds) : null;
  const query = filter.query?.trim().toLowerCase();

  return events.filter((event) => {
    if (kinds && !kinds.has(event.kind)) return false;
    if (!query) return true;
    const haystack = `${event.title} ${JSON.stringify(event.payload ?? {})}`.toLowerCase();
    return haystack.includes(query);
  });
}

/** Renders a payload panel only when the capture actually holds something. */
export function hasTraceContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true; // `{}` is meaningful: it means "called with no arguments".
}

export type RuntimeTraceLlmExchange = {
  policy: unknown;
  tooling: {
    toolMode: unknown;
    toolChoice: unknown;
    availableTools: unknown;
    requiredActions: unknown;
  };
  currentMessage: RuntimeTracePromptPart | null;
  toolContext: RuntimeTracePromptPart[];
  fixedContext: {
    systemMessageCount: number;
    priorChatMessageCount: number;
    cachedTokens: number | null;
  };
  output: unknown;
};

/**
 * Projects a verbose provider capture into the parts that change during one
 * bounded-agent iteration. Full prompt/schema payloads remain available in
 * Raw view, while Timeline focuses on policy, tool availability, the current
 * user message, tool observations accumulated this turn, and parsed output.
 */
export function projectLlmTraceExchange(
  event: RuntimeTraceEventViewModel,
): RuntimeTraceLlmExchange | null {
  if (event.kind !== "llm") return null;
  const prompt = event.payload?.prompt ?? [];
  const input = objectRecord(event.payload?.input);
  const output = objectRecord(event.payload?.output);
  const currentUserIndex = lastRoleIndex(prompt, "user");
  const currentMessage =
    currentUserIndex >= 0 ? (prompt[currentUserIndex] ?? null) : null;
  const beforeCurrent =
    currentUserIndex >= 0 ? prompt.slice(0, currentUserIndex) : prompt;
  const afterCurrent =
    currentUserIndex >= 0 ? prompt.slice(currentUserIndex + 1) : [];

  return {
    policy: input?.policy ?? null,
    tooling: {
      toolMode: input?.toolMode ?? null,
      toolChoice: input?.toolChoice ?? null,
      availableTools: input?.availableTools ?? [],
      requiredActions: input?.requiredActions ?? [],
    },
    currentMessage,
    toolContext: afterCurrent.filter((part) => part.role !== "system"),
    fixedContext: {
      systemMessageCount: prompt.filter((part) => part.role === "system").length,
      priorChatMessageCount: beforeCurrent.filter(
        (part) => part.role === "user" || part.role === "assistant",
      ).length,
      cachedTokens: event.providerCachedTokens ?? null,
    },
    output:
      output?.parsedResponse ??
      output?.visibleResponse ??
      output?.error ??
      output?.rawResponse ??
      event.payload?.output ??
      null,
  };
}

function lastRoleIndex(prompt: readonly RuntimeTracePromptPart[], role: string) {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    if (prompt[index]?.role === role) return index;
  }
  return -1;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type ToolEventRole = "call" | "result";

function readToolMeta(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const toolCallId = record.toolCallId;
  const eventRole = record.eventRole;
  if (typeof toolCallId !== "string") return null;
  if (eventRole !== "call" && eventRole !== "result") return null;
  return { toolCallId, eventRole: eventRole as ToolEventRole, toolName: record.toolName };
}

/**
 * The capture layer emits a tool invocation as two append-only events so an
 * in-flight call is observable before its result lands. A human reading the log
 * wants one row: what went in, what came back. Pair them here, in presentation.
 */
export function pairToolEvents(
  events: readonly RuntimeTraceEventViewModel[],
): RuntimeTraceEventViewModel[] {
  const resultsByCallId = new Map<string, RuntimeTraceEventViewModel>();
  const callIdsPresent = new Set<string>();
  for (const event of events) {
    const meta = readToolMeta(event.metadata);
    if (meta?.eventRole === "result") resultsByCallId.set(meta.toolCallId, event);
    if (meta?.eventRole === "call") callIdsPresent.add(meta.toolCallId);
  }

  const merged: RuntimeTraceEventViewModel[] = [];
  for (const event of events) {
    const meta = readToolMeta(event.metadata);
    if (meta?.eventRole === "result") {
      // Merged into its call row below — but only if that call row is
      // actually in this list. A filter (e.g. free-text search matching only
      // the result's payload) can leave a result whose call was excluded;
      // that orphan must still render as its own row, not vanish silently.
      if (callIdsPresent.has(meta.toolCallId)) continue;
      merged.push(event);
      continue;
    }
    if (meta?.eventRole !== "call") {
      merged.push(event);
      continue;
    }

    const result = resultsByCallId.get(meta.toolCallId);
    const toolName = typeof meta.toolName === "string" ? meta.toolName : event.title;
    merged.push(
      result
        ? {
            ...event,
            title: toolName,
            status: result.status,
            durationMs: result.durationMs,
            payload: { ...event.payload, output: result.payload?.output },
          }
        : { ...event, title: toolName },
    );
  }
  return merged;
}

export interface RuntimeTraceToolCall {
  id: string;
  name: string;
  arguments: unknown;
  argumentsParseError?: boolean;
}

/** Reads the captured tool calls off an event's metadata, if any. */
export function readToolCalls(metadata: unknown): RuntimeTraceToolCall[] | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const calls = (metadata as Record<string, unknown>).toolCalls;
  if (!Array.isArray(calls) || calls.length === 0) return null;
  return calls.filter(
    (call): call is RuntimeTraceToolCall =>
      Boolean(call) && typeof call === "object" && typeof (call as RuntimeTraceToolCall).name === "string",
  );
}

/** An instantaneous event must still be locatable on the axis. */
export const MIN_WATERFALL_WIDTH_PERCENT = 0.8;

/**
 * Places one event on the turn's shared "0 -> turn duration" time axis so a
 * waterfall bar can be drawn: offset = elapsed time before the event started,
 * width = the event's own duration, both as a percentage of the turn total.
 */
export function buildWaterfallGeometry(input: {
  event: Pick<RuntimeTraceEventViewModel, "occurredAt" | "durationMs">;
  turnStartedAtMs: number;
  turnDurationMs: number;
}): { offsetPercent: number; widthPercent: number } | null {
  if (!input.event.occurredAt || input.turnDurationMs <= 0) return null;
  const occurredAtMs = Date.parse(input.event.occurredAt);
  if (!Number.isFinite(occurredAtMs)) return null;

  // `occurredAt` is when the event was *recorded*, which for a completed span is
  // its END. Plotting the bar there pins every long call at ~100% offset, where the
  // width clamp crushes it to a dot — the 4s LLM call, the single most important bar
  // in the turn, vanished. Recover the start by subtracting its own duration.
  // Instantaneous events carry no duration, so this leaves them exactly where they fired.
  const durationMs = input.event.durationMs ?? 0;
  const startedAtMs = occurredAtMs - durationMs;

  const offsetMs = Math.max(0, startedAtMs - input.turnStartedAtMs);
  const offsetPercent = Math.min(100, (offsetMs / input.turnDurationMs) * 100);
  const rawWidthPercent = (durationMs / input.turnDurationMs) * 100;

  return {
    offsetPercent,
    widthPercent: Math.min(
      100 - offsetPercent,
      Math.max(MIN_WATERFALL_WIDTH_PERCENT, rawWidthPercent),
    ),
  };
}
