import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/get-turn-classifier";
import {
  createOpenAiTurnClassifier,
  TurnClassifierError,
} from "@/server/agents/coach-agent/turn-classifier/openai-turn-classifier";

const ENV_KEYS = [
  "COACH_PROVIDER",
  "LLM_CHAT_API_KEY",
  "LLM_CHAT_MODEL",
  "TURN_CLASSIFIER_ENABLED",
] as const;
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) restoreEnv(key, ORIGINAL_ENV[key]);
  vi.stubEnv("NODE_ENV", "test");
});

function validOutput() {
  return {
    operations: [
      {
        family: "recall",
        target: "past_mistake",
        dependsOn: [],
      },
    ],
    modifiers: {
      deliveryMode: "direct",
      codeDisclosure: "guided",
      affect: "none",
    },
  };
}

function completion(content: string | null) {
  return {
    id: "completion-1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-flash-response",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content, refusal: null },
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };
}

function classifierHarness(
  result: unknown,
  error?: unknown,
  traceError?: unknown,
) {
  const create = vi.fn(async () => {
    if (error) throw error;
    return result;
  });
  const traceWriter = vi.fn(async () => {
    if (traceError) throw traceError;
  });
  let now = 1_000;
  const addLlmMs = vi.fn();
  const classifier = createOpenAiTurnClassifier({
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    model: "deepseek-v4-flash-custom",
    timeoutMs: 4_321,
    traceWriter,
    now: () => {
      now += 25;
      return now;
    },
    addLlmMs,
  });
  return { classifier, create, traceWriter, addLlmMs };
}

const context = {
  message: "Have I made this mistake before?",
  projection: "user: I had an off-by-one bug",
  workspace: {
    language: "Python" as const,
    codeState: "formed" as const,
    currentCodeLength: 80,
    selectedTestCount: 2,
    hasAssistantCandidate: false,
  },
};

describe("OpenAI-compatible turn classifier success", () => {
  it("uses the injected v4 model, constrained JSON request, and one call", async () => {
    const harness = classifierHarness(
      completion(JSON.stringify(validOutput())),
    );

    await expect(harness.classifier.classify(context)).resolves.toEqual(
      validOutput(),
    );

    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash-custom",
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      { maxRetries: 0, timeout: 4_321 },
    );
    expect(harness.traceWriter).toHaveBeenCalledTimes(1);
    expect(harness.traceWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "chat.turn_classifier",
        source: "coach_agent:turn_classifier",
        model: "deepseek-v4-flash-custom",
        responseModel: "deepseek-v4-flash-response",
        status: "ok",
        rawOutput: JSON.stringify(validOutput()),
        parsedOutput: validOutput(),
      }),
    );
    expect(harness.addLlmMs).toHaveBeenCalledTimes(1);
  });
});

describe("OpenAI-compatible turn classifier failures", () => {
  it.each([
    ["empty_response", completion(null), undefined],
    ["invalid_json", completion("not-json"), undefined],
    [
      "schema_rejected",
      completion(JSON.stringify({ ...validOutput(), operations: "wrong" })),
      undefined,
    ],
    ["provider", undefined, new Error("provider unavailable")],
    ["timeout", undefined, new Error("Request timed out")],
  ] as const)(
    "traces and throws one recognizable %s failure",
    async (code, result, error) => {
      const harness = classifierHarness(result, error);

      await expect(harness.classifier.classify(context)).rejects.toMatchObject({
        name: "TurnClassifierError",
        code,
      } satisfies Partial<TurnClassifierError>);

      expect(harness.create).toHaveBeenCalledTimes(1);
      expect(harness.traceWriter).toHaveBeenCalledTimes(1);
      expect(harness.traceWriter).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "chat.turn_classifier",
          status: "error",
          error: expect.objectContaining({ code }),
        }),
      );
      expect(harness.addLlmMs).toHaveBeenCalledTimes(1);
    },
  );
});

describe("turn classifier trace isolation", () => {
  it("does not turn a successful classification into a trace failure", async () => {
    const harness = classifierHarness(
      completion(JSON.stringify(validOutput())),
      undefined,
      new Error("trace unavailable"),
    );

    await expect(harness.classifier.classify(context)).resolves.toEqual(
      validOutput(),
    );
    expect(harness.traceWriter).toHaveBeenCalledTimes(1);
    expect(harness.addLlmMs).toHaveBeenCalledTimes(1);
  });

  it("preserves the original classifier error when its trace fails", async () => {
    const harness = classifierHarness(
      undefined,
      new Error("provider unavailable"),
      new Error("trace unavailable"),
    );

    await expect(harness.classifier.classify(context)).rejects.toMatchObject({
      code: "provider",
    });
    expect(harness.traceWriter).toHaveBeenCalledTimes(1);
    expect(harness.addLlmMs).toHaveBeenCalledTimes(1);
  });
});

describe("turn classifier injection guards", () => {
  it("stays disabled in tests", () => {
    process.env.LLM_CHAT_API_KEY = "test-key";
    process.env.TURN_CLASSIFIER_ENABLED = "1";

    expect(getTurnClassifier()).toBeUndefined();
  });

  it.each([
    ["mock coach", { COACH_PROVIDER: "mock", LLM_CHAT_API_KEY: "key" }],
    ["explicit disable", { TURN_CLASSIFIER_ENABLED: "0", LLM_CHAT_API_KEY: "key" }],
    ["missing key", { TURN_CLASSIFIER_ENABLED: "1", LLM_CHAT_API_KEY: "" }],
  ])("stays disabled for %s", (_label, environment) => {
    vi.stubEnv("NODE_ENV", "development");
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, environment);

    expect(getTurnClassifier()).toBeUndefined();
  });

  it("builds the real provider only when explicitly allowed and configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.LLM_CHAT_API_KEY = "test-key";
    process.env.LLM_CHAT_MODEL = "deepseek-v4-flash-env";
    process.env.TURN_CLASSIFIER_ENABLED = "1";
    delete process.env.COACH_PROVIDER;

    expect(getTurnClassifier()).toBeDefined();
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
