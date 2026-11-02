/**
 * Bounded tool loop (spec §8), mirroring the LeetCode coach's runBoundedToolLoop:
 * policy-required tools first, then up to MAX_OPTIONAL_TOOL_ROUNDS of model-chosen
 * tools, then one tool-free finalize call. Budget exhaustion is reported, not hidden.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TeachingPlan, ToolName } from "@/features/adaptivepath/coach/teaching-policy";
import { draftState } from "@/features/adaptivepath/coach/draft";
import { coachReplySchema } from "@/features/adaptivepath/coach/reply-contract";
import type { TutorMessage } from "@/server/adaptivepath/activity-store";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import { COACH_SYSTEM_PROMPT } from "./coach-prompt";
import { callLlmNode, parseJsonOutput, type LlmNodeDeps, type LlmNodeRequest, type LlmNodeResult, type LlmToolCall } from "./llm-node";
import { BIOLOGY_TOOL_REGISTRY, visibleTools, type ToolContext } from "./tool-registry";

export const MAX_OPTIONAL_TOOL_ROUNDS = 2;
const TASK = "adaptivepath.biology.coach_reply";
const FINALIZE_NOTE = "No more tools. Reply now with the final JSON object only.";

export type ToolUse = Readonly<{ name: ToolName; origin: "policy" | "model" }>;
export type LoopResult = Readonly<{ raw: unknown; tools: readonly ToolUse[]; retrievedChunkIds: ReadonlySet<string>; stopReason: "tool_budget" | null }>;
type LoopInput = Readonly<{ context: string; history: readonly TutorMessage[]; message: string; plan: TeachingPlan; toolCtx: ToolContext }>;
type LoopState = { messages: Anthropic.MessageParam[]; tools: ToolUse[]; chunkIds: Set<string>; counts: Map<ToolName, number> };
type Observation = { ok: true; content: unknown } | { ok: false; error: string };
type ToolTurn = Readonly<{ assistant: Anthropic.ContentBlockParam[]; calls: readonly LlmToolCall[]; observations: readonly Observation[] }>;

function initialMessages(input: LoopInput): Anthropic.MessageParam[] {
  return [
    { role: "user", content: input.context },
    ...input.history.map((m): Anthropic.MessageParam => ({ role: m.role === "student" ? "user" : "assistant", content: m.content })),
    { role: "user", content: input.message },
  ];
}

function toAnthropicTools(names: readonly ToolName[]): Anthropic.Tool[] {
  return names.map((name) => {
    const spec = BIOLOGY_TOOL_REGISTRY[name];
    const schema = Object.fromEntries(Object.entries(z.toJSONSchema(spec.inputSchema)).filter(([key]) => key !== "$schema"));
    return { name, description: spec.description, input_schema: { ...schema, type: "object" } };
  });
}

async function execute(state: LoopState, ctx: ToolContext, call: Readonly<{ name: string; args: unknown; origin: ToolUse["origin"]; allowed: readonly ToolName[] }>): Promise<Observation> {
  const name = call.name as ToolName;
  if (!call.allowed.includes(name)) return { ok: false, error: `tool ${call.name} is not available this turn` };
  const spec = BIOLOGY_TOOL_REGISTRY[name];
  if ((state.counts.get(name) ?? 0) >= spec.maxCallsPerTurn) return { ok: false, error: `call limit reached for ${name}` };
  const parsed = spec.inputSchema.safeParse(call.args);
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

/** The assistant turn goes back unchanged (thinking blocks included), then one user turn of tool results. */
function pushCalls(state: LoopState, turn: ToolTurn) {
  state.messages.push({ role: "assistant", content: turn.assistant });
  state.messages.push({
    role: "user",
    content: turn.calls.map((c, i): Anthropic.ToolResultBlockParam => {
      const o = turn.observations[i];
      return o.ok
        ? { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(o.content) }
        : { type: "tool_result", tool_use_id: c.id, content: o.error, is_error: true };
    }),
  });
}

async function runRequired(state: LoopState, input: LoopInput) {
  if (input.plan.requiredCalls.length === 0) return;
  const all = Object.keys(BIOLOGY_TOOL_REGISTRY) as ToolName[];
  const calls: LlmToolCall[] = input.plan.requiredCalls.map((c, i) => ({ id: `policy_${i}`, name: c.name, input: c.args }));
  const observations: Observation[] = [];
  for (const call of calls) {
    const observation = await execute(state, input.toolCtx, { name: call.name, args: call.input, origin: "policy", allowed: all });
    await traceTool(input.toolCtx, { name: call.name, origin: "policy" }, observation);
    if (!observation.ok) throw new Error(`Policy-required tool ${call.name} failed: ${observation.error}`);
    observations.push(observation);
  }
  const assistant = calls.map((c): Anthropic.ToolUseBlockParam => ({ type: "tool_use", id: c.id, name: c.name, input: c.input }));
  pushCalls(state, { assistant, calls, observations });
}

async function runModelCalls(state: LoopState, input: LoopInput, round: Readonly<{ result: LlmNodeResult; allowed: readonly ToolName[] }>) {
  const { result, allowed } = round;
  const observations: Observation[] = [];
  for (const call of result.toolCalls) {
    const observation = await execute(state, input.toolCtx, { name: call.name, args: call.input, origin: "model", allowed });
    await traceTool(input.toolCtx, { name: call.name, origin: "model" }, observation);
    observations.push(observation);
  }
  pushCalls(state, { assistant: [...result.content] as Anthropic.ContentBlockParam[], calls: result.toolCalls, observations });
}

function coachCall(messages: Anthropic.MessageParam[], tools?: Anthropic.Tool[]): LlmNodeRequest {
  return { node: "coach", task: TASK, system: COACH_SYSTEM_PROMPT, output: coachReplySchema, messages, tools };
}

export async function runBiologyToolLoop(deps: LlmNodeDeps, input: LoopInput): Promise<LoopResult> {
  const state: LoopState = { messages: initialMessages(input), tools: [], chunkIds: new Set(), counts: new Map() };
  await runRequired(state, input);
  const visible = visibleTools(input.toolCtx.phase, draftState(input.toolCtx.draft));
  const optional = input.plan.optionalTools.filter((name) => visible.includes(name));
  const done = (raw: unknown, stopReason: LoopResult["stopReason"]): LoopResult => ({ raw, tools: state.tools, retrievedChunkIds: state.chunkIds, stopReason });
  for (let round = 0; round < MAX_OPTIONAL_TOOL_ROUNDS && optional.length > 0; round += 1) {
    const result = await callLlmNode(deps, coachCall([...state.messages], toAnthropicTools(optional)));
    if (result.toolCalls.length === 0) return done(parseJsonOutput(result.text, z.unknown(), "coach"), null);
    await runModelCalls(state, input, { result, allowed: optional });
  }
  const final = await callLlmNode(deps, coachCall([...state.messages, { role: "user", content: FINALIZE_NOTE }]));
  return done(parseJsonOutput(final.text, z.unknown(), "coach"), optional.length > 0 ? "tool_budget" : null);
}
