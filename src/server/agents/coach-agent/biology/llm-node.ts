/**
 * One Biology coach LLM call on the Anthropic Messages API: per-node effort, token
 * cap and timeout, schema-constrained JSON output, an llm_call trace on success and
 * failure, and explicit BiologyCoachError codes. No retries, no fallback text.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { BiologyCoachError, type BiologyCoachNode } from "@/features/adaptivepath/coach/errors";
import { addTraceLlmMs, appendLlmCallTrace, startTraceStep, type ProviderUsage, type TraceContext } from "@/server/llm/trace-context";

type LlmNode = Extract<BiologyCoachNode, "classifier" | "diagnoser" | "coach">;
type NodeSettings = Readonly<{ effort: "low" | "medium"; maxTokens: number; timeoutMs: number }>;

/** Thinking tokens count toward maxTokens, so the caps leave room for adaptive thinking. */
export const NODE_SETTINGS: Readonly<Record<LlmNode, NodeSettings>> = {
  classifier: { effort: "low", maxTokens: 2_000, timeoutMs: 8_000 },
  diagnoser: { effort: "medium", maxTokens: 8_000, timeoutMs: 20_000 },
  coach: { effort: "medium", maxTokens: 8_000, timeoutMs: 20_000 },
};
const SOURCE = "adaptivepath_biology";
const PROVIDER = "anthropic";

export type LlmNodeDeps = Readonly<{ client: Anthropic; model: string; trace: TraceContext }>;
export type LlmToolCall = Readonly<{ id: string; name: string; input: unknown }>;
export type LlmNodeResult = Readonly<{ content: readonly Anthropic.ContentBlock[]; text: string | null; toolCalls: readonly LlmToolCall[] }>;
export type LlmNodeRequest = Readonly<{
  node: LlmNode;
  task: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  /** The JSON shape the final text must match; tool-use turns are not constrained. */
  output: z.ZodType;
}>;

export function isLiveBiologyTutorEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.ADAPTIVEPATH_TUTOR_PROVIDER === "live" && Boolean(env.LLM_BIOLOGY_API_KEY?.trim());
}

function toCoachError(error: unknown, node: LlmNode): BiologyCoachError {
  if (error instanceof BiologyCoachError) return error;
  const code = error instanceof Anthropic.APIConnectionTimeoutError ? "llm_timeout" : "llm_provider";
  return new BiologyCoachError(code, node, `${node} call failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}

function readResult(message: Anthropic.Message, node: LlmNode): LlmNodeResult {
  if (message.stop_reason === "refusal") throw new BiologyCoachError("llm_refusal", node, `${node} was declined by the model's safety check`, { details: message.stop_details });
  if (message.stop_reason === "max_tokens") throw new BiologyCoachError("llm_truncated", node, `${node} hit its output token cap`, { details: { maxTokens: NODE_SETTINGS[node].maxTokens } });
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim() || null;
  const toolCalls = message.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []));
  if (!text && toolCalls.length === 0) throw new BiologyCoachError("llm_empty", node, `${node} returned an empty response`);
  return { content: message.content, text, toolCalls };
}

function toProviderUsage(usage: Anthropic.Usage): ProviderUsage {
  const cached = usage.cache_read_input_tokens ?? 0;
  const input = usage.input_tokens + cached + (usage.cache_creation_input_tokens ?? 0);
  return { prompt_tokens: input, completion_tokens: usage.output_tokens, total_tokens: input + usage.output_tokens, prompt_tokens_details: { cached_tokens: cached } };
}

type CallTraceBase = Omit<Parameters<typeof appendLlmCallTrace>[0], "latencyMs" | "status">;

/** Reads the response and writes its one llm_call trace; a refused or truncated response traces as an error. */
async function settleResponse(base: CallTraceBase, input: Readonly<{ message: Anthropic.Message; node: LlmNode; latencyMs: number }>): Promise<LlmNodeResult> {
  const { message, node, latencyMs } = input;
  let result: LlmNodeResult | null = null;
  let failure: BiologyCoachError | null = null;
  try {
    result = readResult(message, node);
  } catch (error) {
    failure = toCoachError(error, node);
  }
  await appendLlmCallTrace({ ...base, latencyMs, status: failure ? "error" : "ok", error: failure ?? undefined, responseModel: message.model,
    finishReason: message.stop_reason, usage: toProviderUsage(message.usage), rawOutput: message.content });
  if (failure) throw failure;
  return result!;
}

export async function callLlmNode(deps: LlmNodeDeps, req: LlmNodeRequest): Promise<LlmNodeResult> {
  const settings = NODE_SETTINGS[req.node];
  const startedAt = Date.now();
  const base: CallTraceBase = { traceContext: deps.trace, step: startTraceStep(deps.trace, { spanKind: "llm" }), task: req.task, source: SOURCE, provider: PROVIDER, model: deps.model,
    prompt: [{ role: "system", content: req.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
    extraEventJson: { node: req.node, effort: settings.effort, tools: req.tools?.map((t) => t.name) } };
  let message: Anthropic.Message;
  try {
    message = await deps.client.messages.create({
      model: deps.model, max_tokens: settings.maxTokens, system: req.system, messages: req.messages,
      output_config: { effort: settings.effort, format: zodOutputFormat(req.output) },
      ...(req.tools?.length ? { tools: req.tools } : {}),
    }, { timeout: settings.timeoutMs, maxRetries: 0 });
  } catch (error) {
    await appendLlmCallTrace({ ...base, latencyMs: Date.now() - startedAt, status: "error", usageMissingReason: "error_response", error });
    throw toCoachError(error, req.node);
  }
  const latencyMs = Date.now() - startedAt;
  addTraceLlmMs(deps.trace, latencyMs);
  return settleResponse(base, { message, node: req.node, latencyMs });
}

export function parseJsonOutput<T>(content: string | null, schema: z.ZodType<T>, node: BiologyCoachNode): T {
  let value: unknown;
  try {
    value = JSON.parse(content ?? "");
  } catch (error) {
    throw new BiologyCoachError("llm_invalid_json", node, `${node} did not return valid JSON`, { cause: error, details: { content } });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BiologyCoachError("llm_schema", node, `${node} output was rejected by its schema`, { details: parsed.error.flatten() });
  return parsed.data;
}
