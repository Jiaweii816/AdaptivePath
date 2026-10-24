import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";

import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";

import { classifierOutputSchema } from "./classifier-output.schema";
import { buildClassifierMessages } from "./classifier-prompt";
import type {
  ClassifierContext,
  TurnClassifier,
} from "./turn-classifier.types";

export const DEFAULT_TURN_CLASSIFIER_TIMEOUT_MS = 8_000;
const CLASSIFIER_TASK = "chat.turn_classifier";
const CLASSIFIER_SOURCE = "coach_agent:turn_classifier";

export type TurnClassifierErrorCode =
  | "timeout"
  | "provider"
  | "empty_response"
  | "invalid_json"
  | "schema_rejected";

export class TurnClassifierError extends Error {
  readonly code: TurnClassifierErrorCode;

  constructor(code: TurnClassifierErrorCode, cause?: unknown) {
    super(`Turn classifier failed: ${code}`, { cause });
    this.name = "TurnClassifierError";
    this.code = code;
  }
}

type TraceWriter = typeof appendLlmCallTrace;
type AddLlmMs = typeof addTraceLlmMs;

export type OpenAiTurnClassifierOptions = {
  client: OpenAI;
  model: string;
  timeoutMs?: number;
  traceWriter?: TraceWriter;
  addLlmMs?: AddLlmMs;
  now?: () => number;
};

export function createOpenAiTurnClassifier(
  options: OpenAiTurnClassifierOptions,
): TurnClassifier {
  const dependencies = resolveDependencies(options);
  return {
    classify: (context) => classifyTurn(context, dependencies),
  };
}

type Dependencies = Required<
  Pick<OpenAiTurnClassifierOptions, "client" | "model" | "timeoutMs">
> & {
  traceWriter: TraceWriter;
  addLlmMs: AddLlmMs;
  now: () => number;
};

function resolveDependencies(options: OpenAiTurnClassifierOptions): Dependencies {
  return {
    client: options.client,
    model: options.model,
    timeoutMs: options.timeoutMs ?? DEFAULT_TURN_CLASSIFIER_TIMEOUT_MS,
    traceWriter: options.traceWriter ?? appendLlmCallTrace,
    addLlmMs: options.addLlmMs ?? addTraceLlmMs,
    now: options.now ?? Date.now,
  };
}

async function classifyTurn(
  context: ClassifierContext,
  dependencies: Dependencies,
) {
  const messages = buildClassifierMessages(context);
  const step = startTraceStep(context.traceContext, { spanKind: "llm" });
  const startedAt = dependencies.now();
  const attempt = await requestAndParse(messages, dependencies);
  const latencyMs = recordLatency(context, dependencies, startedAt);
  await writeTraceBestEffort(dependencies, context, messages, {
    step,
    latencyMs,
    ...attempt,
  });
  if (attempt.error) throw attempt.error;
  return attempt.output;
}

type ClassificationAttemptBase = {
  completion?: ChatCompletion;
  rawOutput?: string;
  parsedOutput?: unknown;
};
type ClassificationAttempt = ClassificationAttemptBase &
  (
    | {
        output: ReturnType<typeof classifierOutputSchema.parse>;
        error?: undefined;
      }
    | { output?: undefined; error: TurnClassifierError }
  );

async function requestAndParse(
  messages: ReturnType<typeof buildClassifierMessages>,
  dependencies: Dependencies,
): Promise<ClassificationAttempt> {
  let completion: ChatCompletion | undefined;
  let rawOutput: string | undefined;
  let parsedOutput: unknown;

  try {
    completion = (await dependencies.client.chat.completions.create(
      requestBody(dependencies.model, messages),
      { maxRetries: 0, timeout: dependencies.timeoutMs },
    )) as ChatCompletion;
    rawOutput = completion.choices[0]?.message.content ?? undefined;
    if (!rawOutput?.trim()) throw new TurnClassifierError("empty_response");
    parsedOutput = parseJson(rawOutput);
    const parsed = classifierOutputSchema.safeParse(parsedOutput);
    if (!parsed.success) {
      throw new TurnClassifierError("schema_rejected", parsed.error);
    }
    return { completion, rawOutput, parsedOutput: parsed.data, output: parsed.data };
  } catch (error) {
    return {
      completion,
      rawOutput,
      parsedOutput,
      error: normalizeClassifierError(error),
    };
  }
}

function requestBody(
  model: string,
  messages: ReturnType<typeof buildClassifierMessages>,
) {
  return {
    model,
    messages,
    ...deepSeekV4ThinkingParams(model, "disabled"),
    temperature: 0,
    response_format: { type: "json_object" as const },
  };
}

function parseJson(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput);
  } catch (error) {
    throw new TurnClassifierError("invalid_json", error);
  }
}

function normalizeClassifierError(error: unknown): TurnClassifierError {
  if (error instanceof TurnClassifierError) return error;
  return new TurnClassifierError(isTimeoutError(error) ? "timeout" : "provider", error);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  return (
    code === "ETIMEDOUT" ||
    /timeout|timed out/iu.test(`${error.name} ${error.message}`)
  );
}

function recordLatency(
  context: ClassifierContext,
  dependencies: Dependencies,
  startedAt: number,
) {
  const latencyMs = Math.max(0, dependencies.now() - startedAt);
  dependencies.addLlmMs(context.traceContext, latencyMs);
  return latencyMs;
}

async function writeTraceBestEffort(
  dependencies: Dependencies,
  context: ClassifierContext,
  messages: ReturnType<typeof buildClassifierMessages>,
  result: {
    step: ReturnType<typeof startTraceStep>;
    completion?: ChatCompletion;
    latencyMs: number;
    rawOutput?: string;
    parsedOutput?: unknown;
    error?: TurnClassifierError;
  },
) {
  try {
    await dependencies.traceWriter({
      traceContext: context.traceContext,
      step: result.step,
      task: CLASSIFIER_TASK,
      source: CLASSIFIER_SOURCE,
      model: dependencies.model,
      responseModel: result.completion?.model ?? null,
      latencyMs: result.latencyMs,
      status: result.error ? "error" : "ok",
      finishReason: result.completion?.choices[0]?.finish_reason ?? null,
      usage: result.completion?.usage ?? null,
      usageMissingReason:
        result.error && !result.completion ? "error_response" : undefined,
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
    // Observability is best-effort and must not alter classifier semantics.
  }
}
