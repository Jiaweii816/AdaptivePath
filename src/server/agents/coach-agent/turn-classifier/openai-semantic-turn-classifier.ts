import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";

import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";

import { buildSemanticClassifierMessages } from "./semantic-classifier-prompt";
import { semanticClassifierOutputSchema } from "./semantic-classifier-output.schema";
import type {
  SemanticClassifierContext,
  SemanticTurnClassifier,
} from "./semantic-turn-classifier.types";

export const DEFAULT_SEMANTIC_CLASSIFIER_TIMEOUT_MS = 8_000;

export type SemanticClassifierErrorCode =
  | "timeout"
  | "provider"
  | "empty_response"
  | "invalid_json"
  | "schema_rejected";

export class SemanticClassifierError extends Error {
  constructor(
    readonly code: SemanticClassifierErrorCode,
    cause?: unknown,
  ) {
    super(`Semantic turn classifier failed: ${code}`, { cause });
    this.name = "SemanticClassifierError";
  }
}

type TraceWriter = typeof appendLlmCallTrace;

export type OpenAiSemanticTurnClassifierOptions = Readonly<{
  client: OpenAI;
  model: string;
  timeoutMs?: number;
  traceWriter?: TraceWriter;
  addLlmMs?: typeof addTraceLlmMs;
  now?: () => number;
}>;

type Dependencies = {
  client: OpenAI;
  model: string;
  timeoutMs: number;
  traceWriter: TraceWriter;
  addLlmMs: typeof addTraceLlmMs;
  now: () => number;
};

export function createOpenAiSemanticTurnClassifier(
  options: OpenAiSemanticTurnClassifierOptions,
): SemanticTurnClassifier {
  const dependencies = resolveDependencies(options);
  return {
    classify: (context) => classifySemanticTurn(context, dependencies),
  };
}

function resolveDependencies(
  options: OpenAiSemanticTurnClassifierOptions,
): Dependencies {
  return {
    client: options.client,
    model: options.model,
    timeoutMs: options.timeoutMs ?? DEFAULT_SEMANTIC_CLASSIFIER_TIMEOUT_MS,
    traceWriter: options.traceWriter ?? appendLlmCallTrace,
    addLlmMs: options.addLlmMs ?? addTraceLlmMs,
    now: options.now ?? Date.now,
  };
}

type Attempt = {
  completion?: ChatCompletion;
  rawOutput?: string;
  parsedOutput?: unknown;
  output?: ReturnType<typeof semanticClassifierOutputSchema.parse>;
  error?: SemanticClassifierError;
};

async function classifySemanticTurn(
  context: SemanticClassifierContext,
  dependencies: Dependencies,
) {
  const messages = buildSemanticClassifierMessages(context);
  const step = startTraceStep(context.traceContext, { spanKind: "llm" });
  const startedAt = dependencies.now();
  const attempt = await requestAndParse(messages, dependencies);
  const latencyMs = Math.max(0, dependencies.now() - startedAt);
  dependencies.addLlmMs(context.traceContext, latencyMs);
  await writeTraceBestEffort(dependencies, context, messages, {
    ...attempt,
    step,
    latencyMs,
  });
  if (attempt.error) throw attempt.error;
  if (!attempt.output) throw new SemanticClassifierError("empty_response");
  return attempt.output;
}

async function requestAndParse(
  messages: ReturnType<typeof buildSemanticClassifierMessages>,
  dependencies: Dependencies,
): Promise<Attempt> {
  let completion: ChatCompletion | undefined;
  let rawOutput: string | undefined;
  let parsedOutput: unknown;
  try {
    completion = await dependencies.client.chat.completions.create(
      {
        model: dependencies.model,
        messages,
        ...deepSeekV4ThinkingParams(dependencies.model, "disabled"),
        temperature: 0,
        response_format: { type: "json_object" },
      },
      { maxRetries: 0, timeout: dependencies.timeoutMs },
    ) as ChatCompletion;
    rawOutput = completion.choices[0]?.message.content ?? undefined;
    if (!rawOutput?.trim()) throw new SemanticClassifierError("empty_response");
    parsedOutput = parseJson(rawOutput);
    const parsed = semanticClassifierOutputSchema.safeParse(parsedOutput);
    if (!parsed.success) {
      throw new SemanticClassifierError("schema_rejected", parsed.error);
    }
    return { completion, rawOutput, parsedOutput: parsed.data, output: parsed.data };
  } catch (error) {
    return { completion, rawOutput, parsedOutput, error: normalizeError(error) };
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SemanticClassifierError("invalid_json", error);
  }
}

function normalizeError(error: unknown): SemanticClassifierError {
  if (error instanceof SemanticClassifierError) return error;
  const message = error instanceof Error ? `${error.name} ${error.message}` : "";
  const code = error instanceof Error
    ? (error as Error & { code?: string }).code
    : undefined;
  return new SemanticClassifierError(
    code === "ETIMEDOUT" || /timeout|timed out/iu.test(message)
      ? "timeout"
      : "provider",
    error,
  );
}

async function writeTraceBestEffort(
  dependencies: Dependencies,
  context: SemanticClassifierContext,
  messages: ReturnType<typeof buildSemanticClassifierMessages>,
  result: Attempt & {
    step: ReturnType<typeof startTraceStep>;
    latencyMs: number;
  },
): Promise<void> {
  try {
    await dependencies.traceWriter({
      traceContext: context.traceContext,
      step: result.step,
      task: "chat.turn_semantic_classifier_v2",
      source: "coach_agent:semantic_turn_classifier",
      model: dependencies.model,
      responseModel: result.completion?.model ?? null,
      latencyMs: result.latencyMs,
      status: result.error ? "error" : "ok",
      finishReason: result.completion?.choices[0]?.finish_reason ?? null,
      usage: result.completion?.usage ?? null,
      usageMissingReason: result.error && !result.completion
        ? "error_response"
        : undefined,
      error: result.error,
      mode: "standard",
      prompt: messages.map(({ role, content }) => ({ role, content })),
      input: {
        temperature: 0,
        responseFormat: "json_object",
        maxRetries: 0,
        timeoutMs: dependencies.timeoutMs,
        workspace: context.workspace,
      },
      rawOutput: result.rawOutput,
      parsedOutput: result.parsedOutput,
    });
  } catch {
    // Runtime tracing is best-effort and cannot change classifier behavior.
  }
}
