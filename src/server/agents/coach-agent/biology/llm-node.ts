/**
 * One Biology coach LLM call: timeout, llm_call trace (success and failure),
 * and explicit BiologyCoachError codes. No retries, no fallback text.
 */
import type OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { z } from "zod";
import { BiologyCoachError, type BiologyCoachNode } from "@/features/adaptivepath/coach/errors";
import { addTraceLlmMs, appendLlmCallTrace, startTraceStep, type TraceContext } from "@/server/llm/trace-context";

export const CLASSIFIER_TIMEOUT_MS = 8_000;
export const NODE_TIMEOUT_MS = 20_000;
const TEMPERATURE = 0.3;
const SOURCE = "adaptivepath_biology";

export type LlmNodeDeps = Readonly<{ client: OpenAI; model: string; trace: TraceContext }>;
export type LlmToolCall = Readonly<{ id: string; name: string; arguments: string }>;
export type LlmNodeResult = Readonly<{ content: string | null; toolCalls: readonly LlmToolCall[] }>;
export type LlmNodeRequest = Readonly<{
  node: BiologyCoachNode;
  task: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  json?: boolean;
  timeoutMs: number;
}>;

export function isLiveBiologyTutorEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.ADAPTIVEPATH_TUTOR_PROVIDER === "live" && Boolean(env.LLM_CHAT_API_KEY?.trim());
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out/iu.test(`${error.name} ${error.message}`);
}

function toCoachError(error: unknown, node: BiologyCoachNode): BiologyCoachError {
  if (error instanceof BiologyCoachError) return error;
  const code = isTimeout(error) ? "llm_timeout" : "llm_provider";
  return new BiologyCoachError(code, node, `${node} call failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}

function readResult(completion: OpenAI.Chat.ChatCompletion, node: BiologyCoachNode): LlmNodeResult {
  const message = completion.choices[0]?.message;
  const content = message?.content?.trim() || null;
  const toolCalls = (message?.tool_calls ?? []).flatMap((c) => (c.type === "function" ? [{ id: c.id, name: c.function.name, arguments: c.function.arguments }] : []));
  if (!content && toolCalls.length === 0) throw new BiologyCoachError("llm_empty", node, `${node} returned an empty response`);
  return { content, toolCalls };
}

export async function callLlmNode(deps: LlmNodeDeps, req: LlmNodeRequest): Promise<LlmNodeResult> {
  const step = startTraceStep(deps.trace, { spanKind: "llm" });
  const startedAt = Date.now();
  const base = { traceContext: deps.trace, step, task: req.task, source: SOURCE, model: deps.model,
    prompt: req.messages.map((m) => ({ role: m.role, content: m.content })), extraEventJson: { node: req.node, tools: req.tools?.map((t) => t.type === "function" ? t.function.name : t.type) } };
  try {
    const completion = await deps.client.chat.completions.create({
      model: deps.model, temperature: TEMPERATURE, messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
    }, { timeout: req.timeoutMs, maxRetries: 0 });
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(deps.trace, latencyMs);
    const result = readResult(completion, req.node);
    await appendLlmCallTrace({ ...base, latencyMs, status: "ok", responseModel: completion.model,
      finishReason: completion.choices[0]?.finish_reason ?? null, usage: completion.usage ?? null, rawOutput: result });
    return result;
  } catch (error) {
    await appendLlmCallTrace({ ...base, latencyMs: Date.now() - startedAt, status: "error", usageMissingReason: "error_response", error });
    throw toCoachError(error, req.node);
  }
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
