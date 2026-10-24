import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiSemanticTurnClassifier,
  SemanticClassifierError,
} from "@/server/agents/coach-agent/turn-classifier/openai-semantic-turn-classifier";
import type { SemanticRouteInput } from "@/server/agents/coach-agent/turn-classifier/semantic-turn-classifier.types";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

function completion(content: string): ChatCompletion {
  return {
    id: "semantic-completion",
    object: "chat.completion",
    created: 1,
    model: "injected-model-response",
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content, refusal: null },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  };
}

function context() {
  const compiled = compileTurnUnderstandingV2("Explain it");
  return {
    message: "Explain it",
    projection: "assistant: prior explanation",
    workspace: {
      language: "Python" as const,
      hasCurrentCode: true,
      hasAssistantCandidate: false,
      selectedTestCount: 0,
    },
    deterministic: {
      ...compiled,
      route: { kind: "semantic_slow_path", reason: "referent_uncertain" },
    } as SemanticRouteInput,
  };
}

describe("OpenAI-compatible semantic turn classifier", () => {
  it("uses the injected client and model and emits an LLM trace", async () => {
    const create = vi.fn(async () => completion(JSON.stringify({
      schemaVersion: "turn_semantic_proposal_v2",
      requests: [{
        id: "req0",
        kind: "respond",
        deliverable: "understand",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "normal", form: "prose" },
        sourceClauseIds: ["c0"],
        dependsOn: [],
      }],
      certainty: { status: "confident", confidence: 0.9, alternatives: [] },
    })));
    const traceWriter = vi.fn(async () => true);
    const classifier = createOpenAiSemanticTurnClassifier({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "injected-model",
      traceWriter: traceWriter as never,
      addLlmMs: vi.fn(),
      now: () => 100,
    });
    const result = await classifier.classify(context());
    expect(result.requests[0]).toMatchObject({
      kind: "respond",
      deliverable: "understand",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "injected-model", temperature: 0 }),
      expect.objectContaining({ maxRetries: 0 }),
    );
    expect(traceWriter).toHaveBeenCalledWith(expect.objectContaining({
      task: "chat.turn_semantic_classifier_v2",
      model: "injected-model",
      status: "ok",
    }));
  });

  it("turns invalid JSON into a typed, traced failure", async () => {
    const traceWriter = vi.fn(async () => true);
    const classifier = createOpenAiSemanticTurnClassifier({
      client: {
        chat: { completions: { create: vi.fn(async () => completion("not json")) } },
      } as unknown as OpenAI,
      model: "injected-model",
      traceWriter: traceWriter as never,
      addLlmMs: vi.fn(),
    });
    await expect(classifier.classify(context())).rejects.toMatchObject({
      name: "SemanticClassifierError",
      code: "invalid_json",
    } satisfies Partial<SemanticClassifierError>);
    expect(traceWriter).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
});
