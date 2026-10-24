"use client";

import { Bot, HardDrive, UserRound, Wrench } from "lucide-react";
import { DarkDataPanel } from "./runtime-trace-primitives";
import { LlmExchangePanels } from "./llm-exchange-panels";
import { ContextMemoryPanels } from "./context-memory-panels";
import { projectContextMemory, type ContextMemoryProjection } from "./context-memory-projection";
import type { LlmExchangeProjection } from "./llm-exchange-projection";
import {
  formatTraceTokens,
  hasTraceContent,
  humanizeTraceLabel,
  type RuntimeTraceEventViewModel,
  type RuntimeTracePromptPart,
  type RuntimeTraceToolCall,
} from "./runtime-trace-view-model";

/**
 * Per-event detail panels shown inside an expanded Runtime Trace event: the
 * provider token ledger, prompt-by-role breakdown, function-calling JSON,
 * a human-meaning wrapper for memory/state deltas, and the capture-loss
 * notice. Kept apart from `runtime-trace-timeline.tsx` so that file can stay
 * focused on turn/event orchestration.
 */

/** Facts about the capture itself: model/iteration, provider usage, and any redaction/truncation/loss flags. */
export function RuntimeTraceEventCaptureContext({
  event,
  payloadFlags,
}: {
  event: RuntimeTraceEventViewModel;
  payloadFlags: string[];
}) {
  return (
    <>
      <TraceCaptureNotice event={event} />

      {/*
        Model, iteration, token totals and cost all live on the collapsed row's scan
        line already. Restating them here as tiles and a boxed ledger was the same
        number three times inside one event.
      */}

      {payloadFlags.length > 0 ? (
        <div aria-label="Capture transformations" className="flex flex-wrap gap-1">
          {payloadFlags.map((flag) => (
            <span
              key={flag}
              className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900"
            >
              {flag}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Names the `input` panel for what it actually holds, per event kind. "Input" told the
 * reader nothing: on an LLM event it is the request envelope around the messages —
 * dominated by the tool JSON Schema — and readers reasonably assumed it was the prompt.
 */
function inputPanelTitle(kind: string) {
  if (kind === "runner") return "Runner request";
  if (kind === "llm") return "Request params · tool schema (sent alongside the prompt)";
  return "Input";
}

/** The actual captured content: memory delta, function calls, prompt, request params, retrieval, output, streams, state delta. */
export function RuntimeTraceEventPayloadPanels({
  event,
  toolCalls,
  llmProjection,
  contextMemoryProjection,
}: {
  event: RuntimeTraceEventViewModel;
  toolCalls: RuntimeTraceToolCall[] | null;
  llmProjection?: LlmExchangeProjection;
  contextMemoryProjection?: ContextMemoryProjection | null;
}) {
  if (event.kind === "llm") {
    return llmProjection ? <LlmExchangePanels event={event} projection={llmProjection} toolCalls={toolCalls} /> : <DarkDataPanel title="LLM presentation unavailable" value={event.payload ?? null} defaultOpen={false} />;
  }
  const contextMemory = contextMemoryProjection ?? projectContextMemory(event);
  return (
    <>
      {contextMemory ? <ContextMemoryPanels projection={contextMemory} /> : null}
      {event.kind === "memory" && hasTraceContent(event.payload?.memoryDelta) ? (
        <HumanMeaningPanel title="Memory change" value={event.payload!.memoryDelta} />
      ) : null}

      {/*
        Prompt first. On an LLM event `input` is the *other half* of the request — the
        16 KB `tools` JSON Schema plus a few scalars — which the OpenAI-compatible
        protocol sends as a top-level field, NOT inside the system prompt. Rendering it
        above the messages buried the one thing a reader came for.
      */}
      {toolCalls ? <FunctionCallPanel toolCalls={toolCalls} /> : null}

      {event.payload?.prompt?.length ? (
        <PromptByRole prompt={event.payload.prompt} />
      ) : null}

      {hasTraceContent(event.payload?.input) ? (
        <DarkDataPanel
          title={inputPanelTitle(event.kind)}
          value={event.payload!.input}
          defaultOpen={false}
        />
      ) : null}

      {hasTraceContent(event.payload?.retrieval) && !contextMemory ? (
        <DarkDataPanel title="Retrieval set" value={event.payload!.retrieval} defaultOpen={false} />
      ) : null}

      {hasTraceContent(event.payload?.output) ? (
        <DarkDataPanel
          title={event.kind === "runner" ? "Runner result" : "Output"}
          value={event.payload!.output}
          defaultOpen={false}
        />
      ) : null}

      {event.payload?.stdout ? (
        <DarkDataPanel title="stdout" value={event.payload.stdout} defaultOpen={false} />
      ) : null}
      {event.payload?.stderr ? (
        <DarkDataPanel title="stderr" value={event.payload.stderr} defaultOpen />
      ) : null}

      {hasTraceContent(event.payload?.stateDelta) ? (
        <HumanMeaningPanel title="State delta" value={event.payload!.stateDelta} />
      ) : null}
    </>
  );
}

export function FunctionCallPanel({ toolCalls }: { toolCalls: RuntimeTraceToolCall[] }) {
  return (
    <section aria-label="Function calls" className="space-y-1.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-700">
        Function call{toolCalls.length === 1 ? "" : "s"}
      </h4>
      {toolCalls.map((toolCall) => (
        <DarkDataPanel
          key={toolCall.id}
          title={toolCall.name}
          badge={toolCall.argumentsParseError ? "unparseable arguments" : undefined}
          value={toolCall.arguments}
          defaultOpen
          icon={Wrench}
        />
      ))}
    </section>
  );
}

export function PromptByRole({ prompt }: { prompt: RuntimeTracePromptPart[] }) {
  return (
    <section aria-label="Prompt by role" className="space-y-1.5">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-stone-500">
        Prompt by role
      </h4>
      {prompt.map((part, index) => (
        <DarkDataPanel
          key={`${part.role}:${index}`}
          title={humanizeTraceLabel(part.role)}
          value={part.content}
          badge={
            part.estimatedTokens === null || part.estimatedTokens === undefined
              ? undefined
              : `≈ ${formatTraceTokens(part.estimatedTokens)}`
          }
          defaultOpen={part.role.toLowerCase() === "user"}
          icon={part.role.toLowerCase() === "user" ? UserRound : Bot}
        />
      ))}
    </section>
  );
}

export function TraceCaptureNotice({ event }: { event: RuntimeTraceEventViewModel }) {
  const state = event.payloadState;
  if (!state || state === "captured") return null;

  const copy = {
    summary_only: "Summary only — full detail was not captured. Analysis may still be possible.",
    pruned: "Payload pruned — the metric skeleton remains, but this detail is not replayable.",
    unavailable: "Payload unavailable — capture failed or the provider did not return this field.",
  }[state];

  return (
    <div
      role="note"
      className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-950"
    >
      <HardDrive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{copy ?? `Payload state: ${humanizeTraceLabel(state)}`}</span>
    </div>
  );
}

export function HumanMeaningPanel({ title, value }: { title: string; value: unknown }) {
  const meaning = humanMeaning(value);
  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-emerald-800">
        {title}
      </h4>
      {meaning ? (
        <p className="mt-1 text-[11px] leading-4 text-emerald-950">{meaning}</p>
      ) : null}
      <DarkDataPanel title="Identifiers and evidence" value={value} defaultOpen={false} />
    </section>
  );
}

function humanMeaning(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = [
    record.summary,
    record.meaning,
    record.description,
    record.reason,
    record.outcome,
  ].find((item) => typeof item === "string" && item.trim().length > 0);
  return typeof candidate === "string" ? candidate : null;
}
