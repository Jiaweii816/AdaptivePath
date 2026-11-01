/**
 * Bounded tool loop (spec §8), mirroring the LeetCode coach's runBoundedToolLoop:
 * policy-required tools first, then up to MAX_OPTIONAL_TOOL_ROUNDS of model-chosen
 * tools, then one tool-free finalize call. Budget exhaustion is reported, not hidden.
 */
import { z } from "zod";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { TeachingPlan, ToolName } from "@/features/adaptivepath/coach/teaching-policy";
import { draftState } from "@/features/adaptivepath/coach/draft";
import type { TutorMessage } from "@/server/adaptivepath/activity-store";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import { COACH_SYSTEM_PROMPT } from "./coach-prompt";
import { callLlmNode, NODE_TIMEOUT_MS, parseJsonOutput, type LlmNodeDeps, type LlmToolCall } from "./llm-node";
import { BIOLOGY_TOOL_REGISTRY, visibleTools, type ToolContext } from "./tool-registry";

export const MAX_OPTIONAL_TOOL_ROUNDS = 2;
const TASK = "adaptivepath.biology.coach_reply";
const FINALIZE_NOTE = "No more tools. Reply now with the final JSON object only.";

export type ToolUse = Readonly<{ name: ToolName; origin: "policy" | "model" }>;
export type LoopResult = Readonly<{ raw: unknown; tools: readonly ToolUse[]; retrievedChunkIds: ReadonlySet<string>; stopReason: "tool_budget" | null }>;
type LoopInput = Readonly<{ context: string; history: readonly TutorMessage[]; message: string; plan: TeachingPlan; toolCtx: ToolContext }>;
type LoopState = { messages: ChatCompletionMessageParam[]; tools: ToolUse[]; chunkIds: Set<string>; counts: Map<ToolName, number> };
type Observation = { ok: true; content: unknown } | { ok: false; error: string };

function initialMessages(input: LoopInput): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    { role: "user", content: input.context },
    ...input.history.map((m): ChatCompletionMessageParam => ({ role: m.role === "student" ? "user" : "assistant", content: m.content })),
    { role: "user", content: input.message },
  ];
}

function toOpenAiTools(names: readonly ToolName[]): ChatCompletionTool[] {
  return names.map((name) => {
    const spec = BIOLOGY_TOOL_REGISTRY[name];
    return { type: "function", function: { name, description: spec.description, parameters: z.toJSONSchema(spec.inputSchema) as Record<string, unknown> } };
  });
}

function parseArgs(raw: unknown): Observation {
  if (typeof raw !== "string") return { ok: true, content: raw };
  try {
    return { ok: true, content: JSON.parse(raw || "{}") };
  } catch {
    return { ok: false, error: "tool arguments are not valid JSON" };
  }
}

async function execute(state: LoopState, ctx: ToolContext, call: Readonly<{ name: string; args: unknown; origin: ToolUse["origin"]; allowed: readonly ToolName[] }>): Promise<Observation> {
  const name = call.name as ToolName;
  if (!call.allowed.includes(name)) return { ok: false, error: `tool ${call.name} is not available this turn` };
  const spec = BIOLOGY_TOOL_REGISTRY[name];
  if ((state.counts.get(name) ?? 0) >= spec.maxCallsPerTurn) return { ok: false, error: `call limit reached for ${name}` };
  const args = parseArgs(call.args);
  if (!args.ok) return args;
  const parsed = spec.inputSchema.safeParse(args.content);
  if (!parsed.success) return { ok: false, error: `invalid arguments for ${name}: ${parsed.error.message}` };
  const result = await spec.run(parsed.data, ctx);
  state.counts.set(name, (state.counts.get(name) ?? 0) + 1);
  result.chunkIds.forEach((id) => state.chunkIds.add(id));
  state.tools.push({ name, origin: call.origin });
  return { ok: true, content: result.content };
}

async function traceTool(ctx: ToolContext, call: Readonly<{ name: string; origin: string }>, observation: Observation) {
  await appendTraceEventBestEffort(ctx.trace, {
    stage: "biology_tool", kind: "tool", title: `Biology tool ${call.name}`, status: observation.ok ? "succeeded" : "failed",
    details: { metadata: { name: call.name, origin: call.origin, error: observation.ok ? null : observation.error } },
  });
}

function pushCalls(state: LoopState, calls: readonly LlmToolCall[], observations: readonly Observation[]) {
  state.messages.push({ role: "assistant", content: null, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
  calls.forEach((c, i) => {
    const o = observations[i];
    state.messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(o.ok ? o.content : { error: o.error }) });
  });
}

async function runRequired(state: LoopState, input: LoopInput) {
  if (input.plan.requiredCalls.length === 0) return;
  const all = Object.keys(BIOLOGY_TOOL_REGISTRY) as ToolName[];
  const calls = input.plan.requiredCalls.map((c, i) => ({ id: `policy-${i}`, name: c.name, arguments: JSON.stringify(c.args) }));
  const observations: Observation[] = [];
  for (const call of calls) {
    const observation = await execute(state, input.toolCtx, { name: call.name, args: call.arguments, origin: "policy", allowed: all });
    await traceTool(input.toolCtx, { name: call.name, origin: "policy" }, observation);
    if (!observation.ok) throw new Error(`Policy-required tool ${call.name} failed: ${observation.error}`);
    observations.push(observation);
  }
  pushCalls(state, calls, observations);
}

async function runModelCalls(state: LoopState, input: LoopInput, round: Readonly<{ calls: readonly LlmToolCall[]; allowed: readonly ToolName[] }>) {
  const { calls, allowed } = round;
  const observations: Observation[] = [];
  for (const call of calls) {
    const observation = await execute(state, input.toolCtx, { name: call.name, args: call.arguments, origin: "model", allowed });
    await traceTool(input.toolCtx, { name: call.name, origin: "model" }, observation);
    observations.push(observation);
  }
  pushCalls(state, calls, observations);
}

export async function runBiologyToolLoop(deps: LlmNodeDeps, input: LoopInput): Promise<LoopResult> {
  const state: LoopState = { messages: initialMessages(input), tools: [], chunkIds: new Set(), counts: new Map() };
  await runRequired(state, input);
  const visible = visibleTools(input.toolCtx.phase, draftState(input.toolCtx.draft));
  const optional = input.plan.optionalTools.filter((name) => visible.includes(name));
  const done = (raw: unknown, stopReason: LoopResult["stopReason"]): LoopResult => ({ raw, tools: state.tools, retrievedChunkIds: state.chunkIds, stopReason });
  for (let round = 0; round < MAX_OPTIONAL_TOOL_ROUNDS && optional.length > 0; round += 1) {
    const result = await callLlmNode(deps, { node: "coach", task: TASK, json: true, timeoutMs: NODE_TIMEOUT_MS, messages: state.messages, tools: toOpenAiTools(optional) });
    if (result.toolCalls.length === 0) return done(parseJsonOutput(result.content, z.unknown(), "coach"), null);
    await runModelCalls(state, input, { calls: result.toolCalls, allowed: optional });
  }
  const final = await callLlmNode(deps, { node: "coach", task: TASK, json: true, timeoutMs: NODE_TIMEOUT_MS, messages: [...state.messages, { role: "system", content: FINALIZE_NOTE }] });
  return done(parseJsonOutput(final.content, z.unknown(), "coach"), optional.length > 0 ? "tool_budget" : null);
}
