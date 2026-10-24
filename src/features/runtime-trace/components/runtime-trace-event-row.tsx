"use client";

import {
  Bot,
  CircleDot,
  Database,
  FileOutput,
  HardDrive,
  Play,
  Save,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RuntimeTraceStatusBadge } from "./runtime-trace-drawer";
import {
  RuntimeTraceWaterfall,
  WATERFALL_DURATION_CLASS,
  WATERFALL_LANE_CLASS,
} from "./runtime-trace-waterfall";
import { TraceDisclosure } from "./runtime-trace-primitives";
import {
  RuntimeTraceEventCaptureContext,
  RuntimeTraceEventPayloadPanels,
} from "./runtime-trace-event-panels";
import {
  formatTraceCost,
  formatTraceDuration,
  formatTraceTokens,
  humanizeTraceLabel,
  isAttentionStatus,
  isLiveStatus,
  readToolCalls,
  shouldAutoExpandEvent,
  type RuntimeTraceEventViewModel,
  type RuntimeTraceToolCall,
} from "./runtime-trace-view-model";
import type { LlmExchangeProjection } from "./llm-exchange-projection";
import { projectContextMemory, type ContextMemoryProjection } from "./context-memory-projection";

/** One event row: its own scan-line summary plus the expanded detail panels. */

const TRACE_KIND_ICONS: Record<string, typeof Bot> = {
  llm: Bot,
  tool: Wrench,
  runner: TerminalSquare,
  retrieval: Database,
  memory: Database,
  persistence: Save,
  guard: ShieldCheck,
  user_input: UserRound,
  workspace_snapshot: HardDrive,
  lifecycle: Play,
  background_job: FileOutput,
};

export function RuntimeTraceEvent({
  event,
  turnStartedAtMs,
  turnDurationMs,
  isLatestTurn = false,
  llmProjection,
}: {
  event: RuntimeTraceEventViewModel;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  isLatestTurn?: boolean;
  llmProjection?: LlmExchangeProjection;
}) {
  const toolCalls = readToolCalls(event.metadata);
  const payloadFlags = [
    ...(event.redactedFields ?? []).map((field) => `redacted: ${field}`),
    ...(event.truncatedFields ?? []).map((field) => `truncated: ${field}`),
    ...(event.unavailableFields ?? []).map((field) => `unavailable: ${field}`),
  ];

  const contextMemoryProjection = projectContextMemory(event);
  return (
    <TraceDisclosure
      defaultOpen={event.kind === "llm" || event.stage === "context_memory" ? isLatestTurn : shouldAutoExpandEvent(event)}
      persistenceKey={`event:${event.eventId ?? event.id}`}
      className="bg-white"
      summaryClassName="px-2 py-2 hover:bg-stone-50"
      summary={
        <RuntimeTraceEventSummary
          event={event}
          turnStartedAtMs={turnStartedAtMs}
          turnDurationMs={turnDurationMs}
          contextMemoryProjection={contextMemoryProjection}
        />
      }
    >
      <RuntimeTraceEventDetails event={event} toolCalls={toolCalls} payloadFlags={payloadFlags} llmProjection={llmProjection} contextMemoryProjection={contextMemoryProjection} />
    </TraceDisclosure>
  );
}

function RuntimeTraceEventSummary({
  event,
  turnStartedAtMs,
  turnDurationMs,
  contextMemoryProjection,
}: {
  event: RuntimeTraceEventViewModel;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  contextMemoryProjection: ContextMemoryProjection | null;
}) {
  const Icon = TRACE_KIND_ICONS[event.kind] ?? CircleDot;

  const memoryDelta = memoryDeltaSummary(event.payload?.memoryDelta);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-stone-400">
        {event.seq ?? ""}
      </span>
      <span className={cn("shrink-0", traceKindAccent(event.kind))}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-[12px]", traceTitleEmphasis(event.kind))}>
        {event.title}
        {/* The iteration is what distinguishes two otherwise identical loop rows —
            it belongs in the title, not in a tile you must expand the row to see. */}
        {event.agentIteration !== null && event.agentIteration !== undefined ? (
          <span className="ml-1 font-mono font-normal opacity-60">#{event.agentIteration}</span>
        ) : null}
      </span>

      {event.kind === "llm" ? (
        <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums text-stone-400 lg:flex">
          {event.model ? <span>{event.model}</span> : null}
          <span>{formatTokenFlow(event)}</span>
          {event.pricingStatus ? (
            <span>{formatTraceCost(event.estimatedCostUsd, event.pricingStatus)}</span>
          ) : null}
          <span>{llmFinishReason(event) ?? "?"}</span>
          <span>{llmToolMode(event) ?? "?"}</span>
        </span>
      ) : null}
      {memoryDelta ? (
        <span className="shrink-0 font-mono text-[10px] text-emerald-700">{memoryDelta}</span>
      ) : null}
      {contextMemoryProjection && contextMemoryProjection.type !== "unsupported" ? (
        <span className="shrink-0 font-mono text-[10px] text-emerald-700">{contextMemoryProjection.candidateLabel}{contextMemoryProjection.type === "coach" && contextMemoryProjection.retrievalStatus ? ` · ${contextMemoryProjection.retrievalStatus}` : contextMemoryProjection.type === "history" && contextMemoryProjection.mode ? ` · ${contextMemoryProjection.mode}` : ""}</span>
      ) : null}

      <span className="hidden shrink-0 rounded-[3px] bg-stone-100 px-1 py-px font-mono text-[9px] text-stone-500 md:inline">
        {humanizeTraceLabel(event.stage)}
      </span>

      {shouldShowStatusBadge(event.status) ? (
        <RuntimeTraceStatusBadge status={event.status} />
      ) : (
        // A routine success is the expected outcome. A green pill on every plumbing
        // row is what drowned the agent loop. Stay silent visually, not semantically.
        <span className="sr-only">{humanizeTraceLabel(event.status)}</span>
      )}

      {turnStartedAtMs !== undefined && turnDurationMs !== undefined ? (
        <RuntimeTraceWaterfall
          event={event}
          turnStartedAtMs={turnStartedAtMs}
          turnDurationMs={turnDurationMs}
        />
      ) : (
        <span className={cn(WATERFALL_LANE_CLASS, "hidden h-3.5 sm:block")} aria-hidden="true" />
      )}

      <span
        className={cn(
          WATERFALL_DURATION_CLASS,
          "font-mono text-[10px] tabular-nums",
          isLoopKind(event.kind) ? "font-semibold text-stone-800" : "text-stone-400",
        )}
      >
        {formatTraceDuration(event.durationMs)}
      </span>
    </div>
  );
}

function RuntimeTraceEventDetails({
  event,
  toolCalls,
  payloadFlags,
  llmProjection,
  contextMemoryProjection,
}: {
  event: RuntimeTraceEventViewModel;
  toolCalls: RuntimeTraceToolCall[] | null;
  payloadFlags: string[];
  llmProjection?: LlmExchangeProjection;
  contextMemoryProjection: ContextMemoryProjection | null;
}) {
  return (
    <div className="space-y-3 border-t border-stone-100 bg-[#fcfbf8] px-3 py-3">
      <RuntimeTraceEventCaptureContext event={event} payloadFlags={payloadFlags} />
      <RuntimeTraceEventPayloadPanels event={event} toolCalls={toolCalls} llmProjection={llmProjection} contextMemoryProjection={contextMemoryProjection} />
    </div>
  );
}

function llmFinishReason(event: RuntimeTraceEventViewModel) {
  const metadata = record(event.payload?.metadata ?? event.metadata);
  return typeof metadata?.finishReason === "string" ? metadata.finishReason : null;
}

function llmToolMode(event: RuntimeTraceEventViewModel) {
  const input = record(event.payload?.input);
  return typeof input?.toolMode === "string" ? input.toolMode : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}


/** The agent loop. Everything else is plumbing and is rendered quietly. */
const LOOP_KINDS = new Set(["llm", "tool", "runner", "error"]);

function isLoopKind(kind: string) {
  return LOOP_KINDS.has(kind);
}

function traceKindAccent(kind: string) {
  if (kind === "llm") return "text-blue-600";
  if (kind === "memory" || kind === "retrieval") return "text-emerald-600";
  if (kind === "tool" || kind === "runner") return "text-violet-600";
  if (kind === "error") return "text-red-600";
  return "text-stone-300";
}

/**
 * Visual weight must track information value. The old view rendered every title in
 * the same bold near-black, so a `Process memory sample` shouted as loudly as the LLM
 * call that ate 4 of the turn's 6 seconds. Plumbing recedes; the loop reads first.
 */
function traceTitleEmphasis(kind: string) {
  if (kind === "llm") return "font-semibold text-blue-700";
  if (kind === "tool" || kind === "runner") return "font-semibold text-violet-700";
  if (kind === "error") return "font-semibold text-red-700";
  return "font-normal text-stone-500";
}

/** Success is the expected outcome — only deviations earn a badge. */
function shouldShowStatusBadge(status: string) {
  return isAttentionStatus(status) || isLiveStatus(status);
}

/**
 * The one thing the boxed token ledger said that the old scan line did not: the
 * in/out split, and how much of the input the provider served from cache. Carried
 * here as a single line so the box could go without losing the breakdown.
 */
function formatTokenFlow(event: RuntimeTraceEventViewModel) {
  const input = event.providerInputTokens;
  const output = event.providerOutputTokens;
  if (input === null || input === undefined || output === null || output === undefined) {
    return formatTraceTokens(event.providerTotalTokens);
  }

  const format = new Intl.NumberFormat("en-US");
  const cached = event.providerCachedTokens;
  const cachedSuffix =
    cached !== null && cached !== undefined
      ? ` (${format.format(cached)} cached · ${formatCachePercent(cached, input)})`
      : "";
  return `${format.format(input)}→${format.format(output)} tok${cachedSuffix}`;
}

function formatCachePercent(cached: number, input: number) {
  if (input <= 0) return "0%";
  return `${Math.round((cached / input) * 100)}%`;
}

function memoryDeltaSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const added = firstNumber(record, ["added", "created", "inserted", "factsAdded"]);
  const removed = firstNumber(record, ["removed", "deleted", "factsRemoved"]);
  const updated = firstNumber(record, ["updated", "changed", "factsUpdated"]);
  const parts = [
    added ? `+${added}` : null,
    removed ? `−${removed}` : null,
    updated ? `${updated} updated` : null,
  ].filter(Boolean);
  // No countable add/remove/update key means we genuinely don't know what
  // changed — say nothing rather than fabricate a claim.
  return parts.length ? `${parts.join(" / ")} memory` : null;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
    if (Array.isArray(record[key])) return record[key].length;
  }
  return 0;
}
