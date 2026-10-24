import { describe, expect, it, vi } from "vitest";

import type { ClassifierOutput } from "@/server/agents/coach-agent/turn-classifier/classifier-output.schema";
import {
  TurnClassifierError,
  type TurnClassifierErrorCode,
} from "@/server/agents/coach-agent/turn-classifier/openai-turn-classifier";
import {
  resolveTurnUnderstanding,
  type ResolverGuardTrace,
} from "@/server/agents/coach-agent/turn-classifier/resolve-turn-understanding";
import type { TurnClassifier } from "@/server/agents/coach-agent/turn-classifier/turn-classifier.types";
import type { BackendFacts } from "@/server/agents/coach-agent/turn-classifier/validate-classified-understanding";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";

const MODIFIERS = {
  deliveryMode: "direct",
  codeDisclosure: "guided",
  affect: "none",
} as const;
const FACTS: BackendFacts = {
  workspaceLanguage: "Python",
  hasCurrentCode: true,
  hasAssistantCandidate: false,
  deniedExecutionTargets: [],
  grantedExecutionTargets: [],
  grantedDurableTools: [],
};
function output(
  operations: ClassifierOutput["operations"] = [
    { ...operation("answer", "contextual_referent"), topic: "general" },
  ],
): ClassifierOutput {
  return { operations, modifiers: MODIFIERS };
}

function operation(
  family: ClassifierOutput["operations"][number]["family"],
  target: ClassifierOutput["operations"][number]["target"],
) {
  return { family, target, dependsOn: [] };
}

function harness(classified: unknown = output()) {
  const classify = vi.fn(async () => classified) as unknown as TurnClassifier["classify"];
  const classifierFactory = vi.fn<() => TurnClassifier | undefined>(() => ({
    classify,
  }));
  const loadClassifierContext = vi.fn(async () => ({
    message: "Can you explain that again?",
    projection: "assistant: prior explanation",
    workspace: {
      language: "Python" as const,
      codeState: "formed" as const,
      currentCodeLength: 80,
      selectedTestCount: 2,
      hasAssistantCandidate: false,
    },
  }));
  const loadBackendFacts = vi.fn(async () => FACTS);
  const traces: ResolverGuardTrace[] = [];
  const guardTraceWriter = vi.fn(async (trace: ResolverGuardTrace) => {
    traces.push(trace);
  });
  return {
    classify,
    classifierFactory,
    loadClassifierContext,
    loadBackendFacts,
    guardTraceWriter,
    traces,
  };
}

function llmUnderstanding() {
  const deterministic = parseTurnUnderstanding("Can you explain that again?");
  expect(deterministic.route).toBe("llm");
  return deterministic;
}

function resolveWith(
  testHarness: ReturnType<typeof harness>,
  overrides: Partial<Parameters<typeof resolveTurnUnderstanding>[0]> = {},
) {
  return resolveTurnUnderstanding({
    deterministic: llmUnderstanding(),
    facts: FACTS,
    classifierFactory: testHarness.classifierFactory,
    loadClassifierContext: testHarness.loadClassifierContext,
    guardTraceWriter: testHarness.guardTraceWriter,
    ...overrides,
  });
}

describe("resolve turn understanding lazy routing", () => {
  it("does no classifier work for the deterministic fast path", async () => {
    const testHarness = harness();
    const deterministic = parseTurnUnderstanding("Run the current code");
    expect(deterministic.route).toBe("fast_path");

    await expect(
      resolveWith(testHarness, { deterministic, loadBackendFacts: testHarness.loadBackendFacts }),
    ).resolves.toEqual({
      understanding: deterministic,
      provenance: "deterministic_fast",
      classifierActuallyCalled: false,
    });
    expect(testHarness.classifierFactory).not.toHaveBeenCalled();
    expect(testHarness.loadClassifierContext).not.toHaveBeenCalled();
    expect(testHarness.loadBackendFacts).not.toHaveBeenCalled();
    expect(testHarness.classify).not.toHaveBeenCalled();
    expect(testHarness.guardTraceWriter).not.toHaveBeenCalled();
  });

  it("treats an unconfigured slow path as a normal deterministic result", async () => {
    const testHarness = harness();
    testHarness.classifierFactory.mockReturnValueOnce(undefined);
    const deterministic = llmUnderstanding();

    await expect(
      resolveWith(testHarness, { deterministic, loadBackendFacts: testHarness.loadBackendFacts }),
    ).resolves.toEqual({
      understanding: deterministic,
      provenance: "deterministic_unconfigured",
      classifierActuallyCalled: false,
    });
    expect(testHarness.classifierFactory).toHaveBeenCalledTimes(1);
    expect(testHarness.loadClassifierContext).not.toHaveBeenCalled();
    expect(testHarness.loadBackendFacts).not.toHaveBeenCalled();
    expect(testHarness.classify).not.toHaveBeenCalled();
    expect(testHarness.guardTraceWriter).not.toHaveBeenCalled();
  });
});

describe("resolve turn understanding validated slow path", () => {
  it("loads context and classifies exactly once before accepting", async () => {
    const testHarness = harness();
    const result = await resolveWith(testHarness);

    expect(result.provenance).toBe("llm_validated");
    expect(result.understanding.operations[0]).toMatchObject({
      family: "answer",
      target: "contextual_referent",
    });
    expect(testHarness.classifierFactory).toHaveBeenCalledTimes(1);
    expect(testHarness.loadClassifierContext).toHaveBeenCalledTimes(1);
    expect(testHarness.classify).toHaveBeenCalledTimes(1);
    expect(testHarness.guardTraceWriter).toHaveBeenCalledTimes(1);
    expect(testHarness.traces[0]).toMatchObject({
      status: "succeeded",
      provenance: "llm_validated",
      validatorOutcome: "accepted",
    });
  });

  it("uses candidate existence loaded from revision-safe context", async () => {
    const testHarness = harness(
      output([operation("diagnose", "assistant_candidate")]),
    );
    testHarness.loadBackendFacts.mockResolvedValueOnce({
      ...FACTS,
      hasAssistantCandidate: true,
    });

    const result = await resolveWith(testHarness, {
      loadBackendFacts: testHarness.loadBackendFacts,
    });
    expect(result.provenance).toBe("llm_validated");
    expect(testHarness.loadBackendFacts).toHaveBeenCalledTimes(1);
    expect(testHarness.loadBackendFacts).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Can you explain that again?" }),
    );
  });
});

describe("resolve turn understanding validation fallback", () => {
  it("falls back when a custom provider returns raw schema-invalid output", async () => {
    const testHarness = harness({ operations: "invalid" });
    const result = await resolveWith(testHarness);

    expect(result).toMatchObject({
      understanding: llmUnderstanding(),
      provenance: "deterministic_fallback",
      fallbackReason: "classifier_output_schema_rejected",
    });
    expect(testHarness.classify).toHaveBeenCalledTimes(1);
    expect(testHarness.traces[0]).toMatchObject({
      status: "degraded",
      fallbackReason: "classifier_output_schema_rejected",
      validatorOutcome: "not_run",
    });
  });

  it("falls back with the authoritative validator reason", async () => {
    const deterministic = parseTurnUnderstanding(
      "Give me a hint, but do not give full code",
    );
    const testHarness = harness(
      output([operation("answer", "concept")]),
    );
    const result = await resolveWith(testHarness, { deterministic });
    expect(result.fallbackReason).toBe("validator_hint_target_mismatch");
    expect(testHarness.traces[0]).toMatchObject({
      status: "degraded",
      validatorOutcome: "rejected",
      validatorReason: "hint_target_mismatch",
    });
  });
});

describe("resolve turn understanding classifier failures", () => {
  it.each([
    ["timeout", "classifier_timeout"],
    ["provider", "classifier_provider_error"],
    ["empty_response", "classifier_empty_response"],
    ["invalid_json", "classifier_invalid_json"],
    ["schema_rejected", "classifier_schema_rejected"],
  ] as const)("stabilizes %s provider failure", async (code, fallbackReason) => {
    const testHarness = harness();
    testHarness.classify = vi.fn(async () => {
      throw new TurnClassifierError(code as TurnClassifierErrorCode);
    });
    testHarness.classifierFactory.mockReturnValue({
      classify: testHarness.classify,
    });

    const result = await resolveWith(testHarness);

    expect(result.fallbackReason).toBe(fallbackReason);
    expect(testHarness.classify).toHaveBeenCalledTimes(1);
    expect(testHarness.traces[0]).toMatchObject({
      status: "degraded",
      fallbackReason,
    });
  });
});

describe("resolve turn understanding unexpected failures", () => {
  it("uses a stable unknown reason for an untyped classifier throw", async () => {
    const testHarness = harness();
    testHarness.classify = vi.fn(async () => {
      throw new Error("unexpected classifier failure");
    });
    testHarness.classifierFactory.mockReturnValue({
      classify: testHarness.classify,
    });

    expect((await resolveWith(testHarness)).fallbackReason).toBe(
      "resolver_unknown_error",
    );
  });

  it("degrades a lazy backend-facts loading failure", async () => {
    const testHarness = harness();
    testHarness.loadBackendFacts.mockRejectedValueOnce(new Error("facts failed"));

    const result = await resolveWith(testHarness, {
      loadBackendFacts: testHarness.loadBackendFacts,
    });
    expect(result.fallbackReason).toBe("classifier_context_error");
    expect(testHarness.classify).not.toHaveBeenCalled();
    expect(testHarness.traces[0]?.status).toBe("degraded");
  });

  it.each([
    ["factory", "classifier_factory_error"],
    ["context", "classifier_context_error"],
  ] as const)("distinguishes a %s failure", async (phase, fallbackReason) => {
    const testHarness = harness();
    if (phase === "factory") {
      testHarness.classifierFactory.mockImplementationOnce(() => {
        throw new Error("factory failure");
      });
    } else {
      testHarness.loadClassifierContext.mockRejectedValueOnce(
        new Error("context failure"),
      );
    }

    const result = await resolveWith(testHarness);
    expect(result.fallbackReason).toBe(fallbackReason);
    expect(testHarness.classify).not.toHaveBeenCalled();
  });
});

describe("resolve turn understanding trace isolation", () => {
  it.each(["success", "fallback"] as const)(
    "keeps the %s result when guard tracing fails",
    async (scenario) => {
      const testHarness = harness(
        scenario === "success" ? output() : { operations: "invalid" },
      );
      testHarness.guardTraceWriter.mockRejectedValueOnce(
        new Error("trace unavailable"),
      );

      const result = await resolveWith(testHarness);
      expect(result.provenance).toBe(
        scenario === "success" ? "llm_validated" : "deterministic_fallback",
      );
    },
  );
});
