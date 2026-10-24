import { getChatAssemblerModel } from "@/server/llm/models";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";

import type { TurnClauseV2 } from "../turn-understanding-v2.types";
import type { IntentEvidence } from "../evidence/intent-evidence.types";
import {
  modelAssemblerOutputSchema,
  type ModelAssemblerOutput,
} from "./model-assembler.types";

// DashScope's successful non-streaming Qwen requests routinely exceed 1.5 s
// before emitting a response. Six seconds keeps this semantic fallback bounded
// without turning healthy provider latency into a synthetic failure.
export const MODEL_ASSEMBLER_TIMEOUT_MS = 6_000;
export const MIN_MODEL_ASSEMBLER_CONFIDENCE = 0.7;
export const MODEL_ASSEMBLER_TASK = "chat.turn_model_assembler_v3";

type AssemblerOutcome = "timeout" | "invalid_json" | "low_confidence" | "provider_error";
type TraceWriter = typeof appendLlmCallTrace;

export type ModelAssemblerClient = Readonly<{
  complete(prompt: string): Promise<string>;
}>;

export type ModelAssemblerInput = Readonly<{
  message: string;
  clauses: readonly TurnClauseV2[];
  evidence: readonly IntentEvidence[];
  workspace: Readonly<{ hasCurrentCode: boolean; hasAssistantCandidate: boolean }>;
  projection: string;
}>;

export type ModelAssemblerDeps = Readonly<{
  client: ModelAssemblerClient;
  traceContext?: TraceContext;
  model?: string;
  traceWriter?: TraceWriter;
  now?: () => number;
}>;

export type ModelAssemblerResult =
  | { ok: true; output: ModelAssemblerOutput }
  | { ok: false; outcome: AssemblerOutcome };

export async function assembleWithModel(
  input: ModelAssemblerInput,
  deps: ModelAssemblerDeps,
): Promise<ModelAssemblerResult> {
  const now = deps.now ?? Date.now;
  const step = startTraceStep(deps.traceContext, { spanKind: "llm" });
  const startedAt = now();
  const result = await requestProposal(input, deps.client);
  const latencyMs = Math.max(0, now() - startedAt);
  addTraceLlmMs(deps.traceContext, latencyMs);
  await traceAssemblerCall(input, deps, step, latencyMs, result);
  return result;
}

async function requestProposal(
  input: ModelAssemblerInput,
  client: ModelAssemblerClient,
): Promise<ModelAssemblerResult> {
  try {
    const raw = await withTimeout(client.complete(buildModelAssemblerPrompt(input)));
    return raw === TIMEOUT ? fail("timeout") : parseProposal(raw);
  } catch {
    return fail("provider_error");
  }
}

function parseProposal(raw: string): ModelAssemblerResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("invalid_json");
  }
  const validated = modelAssemblerOutputSchema.safeParse(parsed);
  if (!validated.success) return fail("invalid_json");
  if (isLowConfidence(validated.data)) return fail("low_confidence");
  return { ok: true, output: validated.data };
}

function isLowConfidence(output: ModelAssemblerOutput): boolean {
  return output.certainty.status === "ambiguous" ||
    output.certainty.confidence < MIN_MODEL_ASSEMBLER_CONFIDENCE;
}

const TIMEOUT = Symbol("model-assembler-timeout");

async function withTimeout(promise: Promise<string>): Promise<string | typeof TIMEOUT> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT), MODEL_ASSEMBLER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function buildModelAssemblerPrompt(input: ModelAssemblerInput): string {
  return [systemPrompt(), JSON.stringify(promptInput(input))].join("\n\n");
}

function systemPrompt(): string {
  return [
    "Assemble the learner turn into independent request categories. Return one JSON object only.",
    "The learner message may be written in Chinese or English. Category values are always the English enums in the schema. Do not decide the reply language.",
    "Use only requests, denials, and certainty. Do not add context or capability fields.",
    "Every request must use only fields allowed for its kind, and sourceClauseIds must contain IDs from clauses in the input. Return an empty requests array when unsure.",
    "Your exact top-level keys are requests, denials, certainty. Never wrap the response in a contract, example, topLevel, commonRequestFields, respond, execute, or persist key.",
    "A respond request is flat: {id,sourceClauseIds,dependsOn,kind:'respond',deliverable,target,basis,delivery}. deliverable is solve|fix|understand|improve|recall|recommend|chat; target is current|concept|api; basis is an array containing only current_evidence|past_problems|past_mistakes|learner_profile|concept_kb|api_kb|practice_catalog; delivery is {depth:'hint'|'normal'|'full',form:'prose'|'pseudocode'|'patch'|'trace',count?:positive integer}.",
    "An execute request is flat: {id,sourceClauseIds,dependsOn,kind:'execute',target:'current'|'candidate'}. A persist request is flat: {id,sourceClauseIds,dependsOn,kind:'persist',collection:'preference'|'knowledge_handbook'|'mistake_book',content:string}.",
    "denials is an array of {category,value}; category is deliverable|target|basis|delivery|effect. certainty is {status:'confident'|'ambiguous',confidence:number from 0 to 1}.",
    "Valid response shape example (adapt values; do not copy this request): {\"requests\":[{\"id\":\"r0\",\"sourceClauseIds\":[\"c0\"],\"dependsOn\":[],\"kind\":\"respond\",\"deliverable\":\"understand\",\"target\":\"current\",\"basis\":[\"current_evidence\"],\"delivery\":{\"depth\":\"normal\",\"form\":\"prose\"}}],\"denials\":[],\"certainty\":{\"status\":\"confident\",\"confidence\":0.9}}",
  ].join(" ");
}

function promptInput(input: ModelAssemblerInput) {
  return {
    message: input.message,
    clauses: input.clauses.map(({ id, text }) => ({ id, text })),
    evidence: input.evidence.map(({ clauseId, category, value, start, end }) => ({
      clauseId, category, value, span: [start, end],
    })),
    workspace: input.workspace,
    projection: maskAndLimitProjection(input.projection),
  };
}

function maskAndLimitProjection(projection: string): string {
  const masked = projection
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/gu, "[code omitted]")
    .replace(/`[^`\n]*`/gu, "[inline code omitted]");
  return masked.length <= 4_000 ? masked : masked.slice(-4_000);
}

async function traceAssemblerCall(
  input: ModelAssemblerInput,
  deps: ModelAssemblerDeps,
  step: ReturnType<typeof startTraceStep>,
  latencyMs: number,
  result: ModelAssemblerResult,
): Promise<void> {
  try {
    await (deps.traceWriter ?? appendLlmCallTrace)({
      traceContext: deps.traceContext,
      step,
      task: MODEL_ASSEMBLER_TASK,
      source: "coach_agent:model_assembler",
      model: deps.model ?? getChatAssemblerModel(),
      latencyMs,
      status: result.ok ? "ok" : "error",
      usageMissingReason: "provider_omitted",
      input: promptInput(input),
      parsedOutput: result.ok ? result.output : undefined,
      extraEventJson: { assemblerOutcome: result.ok ? "accepted" : result.outcome },
    });
  } catch {
    // Observability is best-effort and cannot alter the assembler outcome.
  }
}

function fail(outcome: AssemblerOutcome): ModelAssemblerResult {
  return { ok: false, outcome };
}
