import { describe, expect, it, vi } from "vitest";

import { createMockSemanticTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/mock-semantic-turn-classifier";
import { SemanticClassifierError } from "@/server/agents/coach-agent/turn-classifier/openai-semantic-turn-classifier";
import {
  resolveSemanticTurnUnderstanding,
  type SemanticResolverTrace,
} from "@/server/agents/coach-agent/turn-classifier/resolve-semantic-turn-understanding";
import type { SemanticClassifierOutput } from "@/server/agents/coach-agent/turn-classifier/semantic-classifier-output.schema";
import type {
  SemanticRouteInput,
  SemanticTurnClassifier,
} from "@/server/agents/coach-agent/turn-classifier/semantic-turn-classifier.types";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

const classified: SemanticClassifierOutput = {
  schemaVersion: "turn_semantic_proposal_v2",
  requests: [{
    id: "req0",
    kind: "respond",
    deliverable: "understand",
    target: "concept",
    basis: ["current_evidence", "concept_kb"],
    delivery: { depth: "normal", form: "prose" },
    sourceClauseIds: ["c0"],
    dependsOn: [],
  }],
  certainty: { status: "confident", confidence: 0.95, alternatives: [] },
};

function slowRun(): SemanticRouteInput {
  return {
    ...compileTurnUnderstandingV2("run it", {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    }),
    route: {
      kind: "semantic_slow_path",
      reason: "target_scope_uncertain",
      uncertainEffects: ["execute"],
    },
  };
}

const context = {
  message: "run it",
  projection: "",
  workspace: {
    language: "Python" as const,
    hasCurrentCode: true,
    hasAssistantCandidate: false,
    selectedTestCount: 1,
  },
};

const facts = {
  workspaceLanguage: "Python",
  hasCurrentCode: true,
  hasAssistantCandidate: false,
  executionGrants: [{ target: "current" as const, sourceClauseIds: ["c0"] }],
  persistGrants: [],
};

describe("semantic slow-path resolver", () => {
  it("does not construct, load, or call a classifier on fast_path", async () => {
    const factory = vi.fn();
    const loadContext = vi.fn();
    const result = await resolveSemanticTurnUnderstanding({
      deterministic: compileTurnUnderstandingV2("Explain binary search"),
      classifierFactory: factory,
      loadClassifierContext: loadContext,
      backendFacts: facts,
    });
    expect(result.provenance).toBe("deterministic_nonsemantic");
    expect(result.classifierActuallyCalled).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("also bypasses classifier construction for deterministic clarify", async () => {
    const factory = vi.fn();
    const loadContext = vi.fn();
    const deterministic: SemanticRouteInput = {
      ...compileTurnUnderstandingV2("run something", {
        workspace: { hasCurrentCode: false, hasAssistantCandidate: false },
      }),
      route: {
        kind: "clarify",
        escalationReasons: [],
        clarificationReason: "backend_target_missing",
      },
    };
    const result = await resolveSemanticTurnUnderstanding({
      deterministic,
      classifierFactory: factory,
      loadClassifierContext: loadContext,
      backendFacts: facts,
    });
    expect(result.classifierActuallyCalled).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("accepts a schema-valid and backend-valid slow-path proposal", async () => {
    const classifier = createMockSemanticTurnClassifier({ "run it": classified });
    const result = await resolveSemanticTurnUnderstanding({
      deterministic: slowRun(),
      classifierFactory: () => classifier,
      loadClassifierContext: () => context,
      backendFacts: facts,
    });
    expect(result).toMatchObject({
      provenance: "llm_validated",
      classifierActuallyCalled: true,
      effectsBlocked: false,
    });
    expect(result.understanding.requests[0]).toMatchObject({
      kind: "respond",
      deliverable: "understand",
    });
  });

  it("makes provider failure observable and blocks uncertain effects", async () => {
    const traces: SemanticResolverTrace[] = [];
    const classifier: SemanticTurnClassifier = {
      async classify() {
        throw new Error("provider unavailable");
      },
    };
    const result = await resolveSemanticTurnUnderstanding({
      deterministic: slowRun(),
      classifierFactory: () => classifier,
      loadClassifierContext: () => context,
      backendFacts: facts,
      guardTraceWriter: async (trace) => { traces.push(trace); },
    });
    expect(result).toMatchObject({
      provenance: "semantic_fallback",
      classifierActuallyCalled: true,
      effectsBlocked: true,
      fallbackReason: "classifier_provider_error",
    });
    expect(result.understanding.requests).toEqual([]);
    expect(result.understanding.route.kind).toBe("clarify");
    expect(traces).toEqual([
      expect.objectContaining({
        status: "degraded",
        effectsBlocked: true,
        fallbackReason: "classifier_provider_error",
      }),
    ]);
  });

  it("rejects invalid mock output through the authoritative schema", async () => {
    const classifier = {
      classify: vi.fn(async () => ({ schemaVersion: "wrong" })),
    } as unknown as SemanticTurnClassifier;
    const result = await resolveSemanticTurnUnderstanding({
      deterministic: slowRun(),
      classifierFactory: () => classifier,
      loadClassifierContext: () => context,
      backendFacts: facts,
    });
    expect(result.fallbackReason).toBe("classifier_output_schema_rejected");
    expect(result.effectsBlocked).toBe(true);
  });

  it("keeps safe deterministic responses answerable on response-only failure", async () => {
    const deterministic: SemanticRouteInput = {
      ...compileTurnUnderstandingV2("Explain the invariant"),
      route: { kind: "semantic_slow_path", reason: "modifier_scope_uncertain" },
    };
    const result = await resolveSemanticTurnUnderstanding({
      deterministic,
      classifierFactory: () => ({
        async classify() { throw new Error("offline"); },
      }),
      loadClassifierContext: () => ({
        ...context,
        message: "Explain the invariant",
      }),
      backendFacts: facts,
    });
    expect(result.effectsBlocked).toBe(false);
    expect(result.understanding.requests.every(({ kind }) => kind === "respond")).toBe(true);
    expect(result.understanding.route.kind).toBe("fast_path");
  });

  it.each([
    ["timeout", "classifier_timeout"],
    ["invalid_json", "classifier_invalid_json"],
  ] as const)("maps %s to an observable fail-closed fallback", async (code, reason) => {
    const traces: SemanticResolverTrace[] = [];
    const result = await resolveSemanticTurnUnderstanding({
      deterministic: slowRun(),
      classifierFactory: () => ({
        async classify() { throw new SemanticClassifierError(code); },
      }),
      loadClassifierContext: () => context,
      backendFacts: facts,
      guardTraceWriter: async (trace) => { traces.push(trace); },
    });
    expect(result).toMatchObject({
      fallbackReason: reason,
      effectsBlocked: true,
      classifierActuallyCalled: true,
    });
    expect(traces[0]).toMatchObject({ fallbackReason: reason, status: "degraded" });
  });
});
