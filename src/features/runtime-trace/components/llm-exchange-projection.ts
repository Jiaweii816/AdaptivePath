import type { RuntimeTraceEventViewModel, RuntimeTracePromptPart } from "./runtime-trace-types";

export const MEMORY_TOOL_NAMES = new Set(["past_mistake_recall", "past_problem_recall"]);
const ELISION = /\[TRUNCATED:\s*\d+\s*PROMPT MESSAGES\]/u;
const CHAT_MARKERS = [
  "[PERSONALIZATION MATERIAL — subordinate context only]", "[COACH MEMORY BRIEF — personalization only]", "[TEACHING-STYLE SIGNALS — style only]",
  "[TEACHING STRATEGY — personalization only]", "[DOMAIN REFERENCE — supplementary knowledge; never active-problem identity]", "[OUTPUT PREFERENCES — personalization only]",
];
const REVIEW_MARKER = "[COACH MEMORY BRIEF — teaching personalization only; never current-code evidence]";

export type SystemMemoryProjection =
  | { state: "present"; sections: Array<{ title: string; text: string }>; nonMemoryText: string }
  | { state: "absent"; sections: []; nonMemoryText: string }
  | { state: "unavailable" | "indeterminate"; sections: []; nonMemoryText: "" };

export type PromptDiff =
  | { state: "initial"; added: RuntimeTracePromptPart[] }
  | { state: "same"; previousIteration: number | null; counts: { system: number; history: number; tool: number }; added: RuntimeTracePromptPart[] }
  | { state: "added"; previousIteration: number | null; counts: { system: number; history: number; tool: number }; added: RuntimeTracePromptPart[] }
  | { state: "changed"; previousIteration: number | null; before: RuntimeTracePromptPart[]; after: RuntimeTracePromptPart[] }
  | { state: "indeterminate"; added: RuntimeTracePromptPart[] };

export type LlmExchangeProjection = {
  eventId: string;
  policy: Record<string, unknown> | null;
  tooling: Record<string, unknown>;
  toolSchema: unknown;
  prompt: RuntimeTracePromptPart[] | null;
  memory: SystemMemoryProjection;
  nonMemorySystem: { changed: boolean; text: string; previousIteration: number | null };
  strategy: StrategyProjection;
  diff: PromptDiff;
  output: unknown;
  memoryToolResults: Array<{ name: string; content: unknown; isNew: boolean; previousIteration: number | null }>;
};

export type StrategyProjection = {
  state: "initial" | "unchanged" | "changed";
  previousIteration: number | null;
  changedFields: Array<{ label: string; before: unknown; after: unknown }>;
  toolSchemaChanged: boolean;
};

export function projectTurnLlmExchanges(events: readonly RuntimeTraceEventViewModel[]) {
  const projections = new Map<string, LlmExchangeProjection>();
  const llms = events.filter((event) => event.kind === "llm").sort((a, b) => (a.agentIteration ?? 0) - (b.agentIteration ?? 0) || (a.seq ?? 0) - (b.seq ?? 0));
  let previous: LlmExchangeProjection | null = null;
  for (const event of llms) {
    const prompt: RuntimeTracePromptPart[] | null = Array.isArray(event.payload?.prompt) ? event.payload!.prompt! : null;
    const input = record(event.payload?.input);
    const systems = prompt?.filter((part) => part.role === "system") ?? [];
    const memory = projectSystemMemory(systems, prompt === null);
    const priorPrompt = previous?.prompt ?? null;
    const diff = projectPromptDiff(prompt, priorPrompt, previous?.eventId === undefined ? null : previousIteration(previous, llms));
    const previousTools = previous ? new Set(previous.memoryToolResults.map((item) => toolSignature(item.name, item.content))) : new Set<string>();
    const memoryToolResults = (prompt ?? []).flatMap((part) => {
      const tool = readToolResult(part);
      if (!tool || !MEMORY_TOOL_NAMES.has(tool.name)) return [];
      const signature = toolSignature(tool.name, tool.content);
      return [{ ...tool, isNew: !previousTools.has(signature), previousIteration: previous ? previousIteration(previous, llms) : null }];
    });
    const projection: LlmExchangeProjection = {
      eventId: event.eventId ?? event.id,
      policy: record(input?.policy),
      tooling: {
        toolMode: input?.toolMode ?? null,
        toolChoice: input?.toolChoice ?? null,
        requiredActions: input?.requiredActions ?? [],
        availableTools: input?.availableTools ?? [],
      },
      toolSchema: input && "tools" in input ? input.tools : undefined,
      prompt,
      memory,
      nonMemorySystem: {
        changed: previous ? previous.memory.nonMemoryText !== memory.nonMemoryText : false,
        text: memory.nonMemoryText,
        previousIteration: previous ? previousIteration(previous, llms) : null,
      },
      strategy: projectStrategy(input, previous, llms),
      diff,
      output: outputOf(event),
      memoryToolResults,
    };
    projections.set(projection.eventId, projection);
    previous = projection;
  }
  return projections;
}

export function projectSystemMemory(systems: readonly RuntimeTracePromptPart[], promptUnavailable = false): SystemMemoryProjection {
  if (promptUnavailable) return { state: "unavailable", sections: [], nonMemoryText: "" };
  if (systems.some((part) => typeof part.content !== "string" || ELISION.test(String(part.content)))) return { state: "indeterminate", sections: [], nonMemoryText: "" };
  const text = systems.map((part) => part.content as string).join("\n");
  const chat = sliceChatSections(text);
  if (chat.length) return { state: "present", sections: chat, nonMemoryText: removeSections(text, chat) };
  const reviewIndex = text.indexOf(REVIEW_MARKER);
  if (reviewIndex >= 0) {
    const block = text.slice(reviewIndex);
    const sections = splitReviewSections(block);
    return sections.length
      ? { state: "present", sections, nonMemoryText: text.slice(0, reviewIndex).trim() }
      : { state: "indeterminate", sections: [], nonMemoryText: "" };
  }
  return { state: "absent", sections: [], nonMemoryText: text };
}

export function isMemoryToolResult(part: RuntimeTracePromptPart) {
  const result = readToolResult(part);
  return Boolean(result && MEMORY_TOOL_NAMES.has(result.name));
}

function sliceChatSections(text: string) {
  const found = CHAT_MARKERS.map((marker) => ({ marker, index: text.indexOf(marker) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index);
  return found.map((current, index) => {
    const end = found[index + 1]?.index ?? text.length;
    return { title: current.marker.slice(1), text: text.slice(current.index, end).trim() };
  });
}

function splitReviewSections(block: string) {
  const headings = ["Selected learner cues (max 2):", "Output preferences:", "Teaching-style signals", "Teaching strategy:", "Retrieved domain reference:"];
  const hits = headings.map((heading) => ({ heading, index: block.indexOf(heading) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index);
  if (!hits.length) return [{ title: "Coach memory brief", text: block }];
  return hits.map((hit, index) => ({ title: hit.heading.replace(/:$/u, ""), text: block.slice(hit.index, hits[index + 1]?.index ?? block.length).trim() }));
}

function removeSections(text: string, sections: Array<{ text: string }>) { return sections.reduce((value, section) => value.replace(section.text, ""), text).trim(); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function outputOf(event: RuntimeTraceEventViewModel) { const output = record(event.payload?.output); return output?.parsedResponse ?? output?.visibleResponse ?? output?.error ?? event.payload?.output ?? null; }
function partKey(part: RuntimeTracePromptPart) { return `${part.role}:${JSON.stringify(part.content)}`; }
function toolSignature(name: string, content: unknown) { return `${name}:${JSON.stringify(content)}`; }
function readToolResult(part: RuntimeTracePromptPart) { if (part.role !== "tool") return null; const value = record(part.content); const name = value?.name; return typeof name === "string" ? { name, content: value?.content ?? part.content } : null; }
function previousIteration(previous: LlmExchangeProjection, llms: readonly RuntimeTraceEventViewModel[]) { return llms.find((event) => (event.eventId ?? event.id) === previous.eventId)?.agentIteration ?? null; }

function projectStrategy(
  input: Record<string, unknown> | null,
  previous: LlmExchangeProjection | null,
  llms: readonly RuntimeTraceEventViewModel[],
): StrategyProjection {
  if (!previous) return { state: "initial", previousIteration: null, changedFields: [], toolSchemaChanged: false };
  const prior = strategyValues(previous);
  const current = strategyValuesFromInput(input);
  const labels: Record<string, string> = {
    intent: "intent", primaryGoal: "primaryGoal", responseShape: "responseShape",
    codeDisclosure: "codeDisclosure", styleMode: "styleMode", toolMode: "toolMode",
    toolChoice: "toolChoice", requiredActions: "requiredActions", availableTools: "availableTools",
  };
  const changedFields = Object.keys(labels).flatMap((key) =>
    stableValue(prior[key]) === stableValue(current[key])
      ? []
      : [{ label: labels[key]!, before: prior[key], after: current[key] }],
  );
  const toolSchemaChanged = stableValue(previous.toolSchema) !== stableValue(input?.tools);
  return {
    state: changedFields.length || toolSchemaChanged ? "changed" : "unchanged",
    previousIteration: previousIteration(previous, llms),
    changedFields,
    toolSchemaChanged,
  };
}

function strategyValues(previous: LlmExchangeProjection): Record<string, unknown> {
  return {
    ...(previous.policy ?? {}),
    ...previous.tooling,
  };
}

function strategyValuesFromInput(input: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...(record(input?.policy) ?? {}),
    toolMode: input?.toolMode ?? null,
    toolChoice: input?.toolChoice ?? null,
    requiredActions: input?.requiredActions ?? [],
    availableTools: input?.availableTools ?? [],
  };
}

function stableValue(value: unknown) {
  try { return JSON.stringify(value) ?? "null"; } catch { return "[unserializable]"; }
}

function projectPromptDiff(current: RuntimeTracePromptPart[] | null, prior: RuntimeTracePromptPart[] | null, previousIteration: number | null): PromptDiff {
  if (!current) return { state: "indeterminate", added: [] };
  if (current.some((part) => part.role === "trace_capture" || ELISION.test(String(part.content))) || prior?.some((part) => part.role === "trace_capture" || ELISION.test(String(part.content)))) return { state: "indeterminate", added: current };
  if (!prior) return { state: "initial", added: current };
  let shared = 0; while (shared < current.length && shared < prior.length && partKey(current[shared]!) === partKey(prior[shared]!)) shared += 1;
  const counts = { system: prior.filter((part) => part.role === "system").length, history: prior.filter((part) => part.role === "user" || part.role === "assistant").length, tool: prior.filter((part) => part.role === "tool").length };
  if (shared === prior.length) return { state: current.length === prior.length ? "same" : "added", previousIteration, counts, added: current.slice(shared) };
  return { state: "changed", previousIteration, before: prior, after: current };
}
