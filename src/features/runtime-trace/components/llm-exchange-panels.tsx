"use client";

import { AlertTriangle, Bot, MessageSquareText, Wrench } from "lucide-react";
import { DarkDataPanel, TraceDisclosure } from "./runtime-trace-primitives";
import type { RuntimeTraceEventViewModel, RuntimeTracePromptPart } from "./runtime-trace-types";
import type { RuntimeTraceToolCall } from "./runtime-trace-view-model";
import type { LlmExchangeProjection } from "./llm-exchange-projection";
import { isMemoryToolResult } from "./llm-exchange-projection";

export function LlmExchangePanels({ event, projection, toolCalls }: { event: RuntimeTraceEventViewModel; projection: LlmExchangeProjection; toolCalls: RuntimeTraceToolCall[] | null }) {
  return <div className="space-y-3">
    <PromptCachePanel event={event} />
    <StrategyAndTools event={event} projection={projection} />
    <MessageDelta projection={projection} />
    <OutputPanel projection={projection} toolCalls={toolCalls} />
    <TraceDisclosure defaultOpen={false} persistenceKey={`llm-provider:${projection.eventId}`} summaryClassName="rounded border border-stone-200 bg-white px-2 py-1.5 text-[11px] text-stone-600" summary={<span>Provider details</span>}>
      <div className="mt-1"><DarkDataPanel title="Provider metadata" value={event.payload?.metadata ?? event.metadata ?? {}} defaultOpen={false} /></div>
    </TraceDisclosure>
  </div>;
}

function PromptCachePanel({ event }: { event: RuntimeTraceEventViewModel }) {
  const input = event.providerInputTokens;
  const cached = event.providerCachedTokens;
  if (input === null || input === undefined || cached === null || cached === undefined) {
    return <p className="text-[11px] text-stone-500">Prompt cache · breakdown unavailable</p>;
  }
  const percent = input > 0 ? Math.round((cached / input) * 100) : 0;
  const format = new Intl.NumberFormat("en-US");
  return <p className="text-[11px] text-stone-600"><span className="font-medium text-stone-800">Prompt cache</span>{" · "}{format.format(cached)} / {format.format(input)} input tokens ({percent}%)</p>;
}

function StrategyAndTools({ event, projection }: { event: RuntimeTraceEventViewModel; projection: LlmExchangeProjection }) {
  if (isSemanticTurnAssembler(event)) {
    return <section className="border-l-2 border-slate-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-700">Semantic turn assembly</h4><p className="mt-1 text-[11px] text-stone-600">This preprocessing call classifies the learner request. Tool schemas do not apply here; inspect the subsequent <span className="font-mono">chat.tool_loop.turn</span> step for the Coach&apos;s loaded tools.</p></section>;
  }
  if (projection.strategy.state === "unchanged") return <p className="text-[11px] text-stone-500">Strategy and tools unchanged from #{projection.strategy.previousIteration}.</p>;
  if (projection.strategy.state === "changed") return <section className="border-l-2 border-blue-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-blue-800">Strategy and tools changed</h4><div className="mt-1 space-y-1">{projection.strategy.changedFields.map((change) => <p key={change.label} className="text-[11px] text-stone-700"><span className="font-mono text-blue-700">{change.label}</span>{": "}{formatValue(change.before)} <span className="text-blue-500">→</span> {formatValue(change.after)}</p>)}</div>{projection.strategy.toolSchemaChanged ? <div className="mt-2"><DarkDataPanel title="Full tool schema" value={projection.toolSchema === undefined ? "Full tool schema was not captured for this provider." : projection.toolSchema} defaultOpen={false} icon={Wrench} /></div> : null}</section>;
  const policy = projection.policy ?? {};
  return <section className="border-l-2 border-blue-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-blue-800">Turn strategy and tools</h4><dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2"><KeyValue label="intent" value={policy.intent} /><KeyValue label="primary goal" value={policy.primaryGoal} /><KeyValue label="tool mode" value={projection.tooling.toolMode} /><KeyValue label="available tools" value={toolNames(projection.tooling.availableTools)} /><KeyValue label="tool choice" value={projection.tooling.toolChoice} /><KeyValue label="required actions" value={countLabel(projection.tooling.requiredActions)} /></dl><div className="mt-2"><TraceDisclosure defaultOpen={false} persistenceKey={`llm-policy:${projection.eventId}`} summaryClassName="rounded border border-stone-200 bg-white px-2 py-1.5 text-[11px] text-stone-600" summary={<span>View full policy</span>}><div className="mt-1"><DarkDataPanel title="Policy details" value={{ policy, tooling: projection.tooling }} defaultOpen={false} /></div></TraceDisclosure></div><div className="mt-2"><DarkDataPanel title="Full tool schema" value={projection.toolSchema === undefined ? "Full tool schema was not captured for this provider." : projection.toolSchema} defaultOpen={false} icon={Wrench} /></div></section>;
}

function isSemanticTurnAssembler(event: RuntimeTraceEventViewModel) {
  const task = taskFrom(event.payload?.metadata) ?? taskFrom(event.metadata);
  return task === "chat.turn_model_assembler_v3";
}

function taskFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const task = (value as Record<string, unknown>).task;
  return typeof task === "string" ? task : undefined;
}

function MessageDelta({ projection }: { projection: LlmExchangeProjection }) {
  const diff = projection.diff;
  if (diff.state === "initial") {
    const { history, current, additions } = splitInitialPrompt(diff.added);
    return <section className="border-l-2 border-violet-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-800">Prompt delta</h4><p className="mt-1 text-[11px] text-stone-600">First LLM exchange in this turn.</p><ChatHistoryContext parts={history} /><CurrentUserMessage message={current} /><LoopAdditions parts={additions} /></section>;
  }
  if (diff.state === "same") return <section className="border-l-2 border-violet-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-800">Prompt delta</h4><p className="mt-1 text-[11px] text-stone-500">Chat history unchanged · see #{diff.previousIteration}. No loop additions.</p></section>;
  if (diff.state === "added") return <section className="border-l-2 border-violet-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-800">Prompt delta</h4><p className="mt-1 text-[11px] text-stone-500">Chat history unchanged · see #{diff.previousIteration}.</p><LoopAdditions parts={diff.added} /></section>;
  return <section className="border-l-2 border-violet-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-violet-800">Prompt delta</h4>{diff.state === "indeterminate" ? <><p className="mt-1 flex gap-1 text-[11px] text-amber-800"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Prompt was truncated; unable to diff reliably.</p><DarkDataPanel title="Captured prompt" value={diff.added} defaultOpen={false} /></> : <><p className="mt-1 text-[11px] text-amber-800">Prompt prefix changed; showing a faithful before/after diff.</p><DarkDataPanel title="− Previous prompt" value={diff.before} defaultOpen={false} /><DarkDataPanel title="+ Current prompt" value={diff.after} defaultOpen={false} /></>}</section>;
}

function OutputPanel({ projection, toolCalls }: { projection: LlmExchangeProjection; toolCalls: RuntimeTraceToolCall[] | null }) {
  return <section className="border-l-2 border-fuchsia-400 pl-2.5"><h4 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-fuchsia-800">Output</h4>{toolCalls?.length ? <div className="mt-1 space-y-1">{toolCalls.map((call) => <DarkDataPanel key={call.id} title={`Function call · ${call.name}`} badge={call.argumentsParseError ? "unparseable arguments" : undefined} value={call.arguments} defaultOpen icon={Wrench} />)}</div> : <DarkDataPanel title="Model output · reply" value={projection.output} defaultOpen icon={Bot} />}</section>;
}

function splitInitialPrompt(parts: RuntimeTracePromptPart[]) { const messages = parts.filter((part) => part.role !== "system"); const currentIndex = lastRoleIndex(messages, "user"); return currentIndex < 0 ? { history: messages, current: null, additions: [] } : { history: messages.slice(0, currentIndex), current: messages[currentIndex] ?? null, additions: messages.slice(currentIndex + 1) }; }
function ChatHistoryContext({ parts }: { parts: RuntimeTracePromptPart[] }) { if (!parts.length) return null; const exchanges = parts.filter((part) => part.role === "user").length; return <div className="mt-1.5"><DarkDataPanel title={`Chat history context · ${exchanges} earlier exchange${exchanges === 1 ? "" : "s"}`} value={parts.map((part) => ({ role: part.role, content: part.content }))} defaultOpen={false} icon={MessageSquareText} /></div>; }
function CurrentUserMessage({ message }: { message: RuntimeTracePromptPart | null }) { return message ? <div className="mt-1.5"><DarkDataPanel title="Current user message" value={message.content} defaultOpen icon={MessageSquareText} /></div> : null; }
function LoopAdditions({ parts }: { parts: RuntimeTracePromptPart[] }) { return parts.length ? <section className="mt-2 space-y-1"><h5 className="text-[10px] font-medium text-violet-800">This loop’s additions</h5><PromptParts parts={parts} /></section> : null; }
function PromptParts({ parts }: { parts: RuntimeTracePromptPart[] }) { return <div className="space-y-1">{parts.map((part, index) => <DarkDataPanel key={`${part.role}:${index}`} title={isMemoryToolResult(part) ? "Memory tool result" : part.role === "tool" ? "Tool result" : part.role === "assistant" ? "Assistant tool call" : "Prompt message"} value={part.content} defaultOpen={isMemoryToolResult(part)} icon={part.role === "tool" ? Wrench : MessageSquareText} />)}</div>; }
function KeyValue({ label, value }: { label: string; value: unknown }) { return <div className="min-w-0 border-b border-blue-100 py-1"><dt className="font-mono text-[9px] text-stone-500">{label}</dt><dd className="break-words text-[11px] text-stone-800">{typeof value === "string" ? value : value == null ? "—" : JSON.stringify(value)}</dd></div>; }
function countLabel(value: unknown) { return Array.isArray(value) ? `${value.length} item${value.length === 1 ? "" : "s"}` : value ?? "—"; }
function toolNames(value: unknown) { return Array.isArray(value) ? value.join(", ") || "No tools" : countLabel(value); }
function formatValue(value: unknown) { return typeof value === "string" ? value : value == null ? "—" : JSON.stringify(value); }
function lastRoleIndex(parts: RuntimeTracePromptPart[], role: string) { for (let index = parts.length - 1; index >= 0; index -= 1) if (parts[index]?.role === role) return index; return -1; }
