import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrappedChatTurn } from "@/server/agents/coach-agent/chat-turn-bootstrap";
import { loadChatTurnContext } from "@/server/agents/coach-agent/chat-turn-context";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { getTurnUnderstandingMode } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-mode";
import { buildWorkspaceCodeRevision } from "@/server/agents/coach-agent/workspace-revision";
import { buildSemanticBackendFacts } from "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding-v2";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

const seams = vi.hoisted(() => ({
  captureLegacyTrace: vi.fn(async () => undefined),
  captureV2Trace: vi.fn(async () => undefined),
  classifierFactory: vi.fn(),
  classifierPreload: vi.fn(),
  semanticFactory: vi.fn(() => undefined),
  ensureSessionPlan: vi.fn(async () => undefined),
  loadCurrentHintLevel: vi.fn(async () => 0),
  loadLatestReviewProjection: vi.fn(async () => ({
    alignment: "no_review" as const,
  })),
  loadStoredRecentMessages: vi.fn(async () => []),
  memory: vi.fn(async () => ({
    brief: {
      profileId: "profile-1",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full" as const,
    },
  })),
  resolveAuthoritativeRunContext: vi.fn(async () => undefined),
  resolveWorkingRunContext: vi.fn(async () => ({ alignment: "none" as const })),
  resolveLegacy: vi.fn(),
}));

vi.mock("@/server/memory", () => ({
  buildCoachMemoryContext: seams.memory,
}));

vi.mock("@/server/memory/working/build-session-plan", () => ({
  ensureSessionPlan: seams.ensureSessionPlan,
}));

vi.mock("@/server/agents/coach-agent/authoritative-run-context", () => ({
  resolveAuthoritativeRunContext: seams.resolveAuthoritativeRunContext,
  resolveWorkingRunContext: seams.resolveWorkingRunContext,
}));

vi.mock("@/server/agents/coach-agent/chat-context-loader", () => ({
  loadCurrentHintLevel: seams.loadCurrentHintLevel,
  loadLatestReviewProjection: seams.loadLatestReviewProjection,
  loadStoredRecentMessages: seams.loadStoredRecentMessages,
}));

vi.mock("@/server/agents/coach-agent/review-pipeline", () => ({
  buildCoachUserContext: () => ({
    displayName: "PatternCoachDev",
    strongPatterns: [],
    weakPatterns: [],
    outputPreferences: [],
  }),
  inferResponseLanguage: ({ userQuestion }: { userQuestion: string }) =>
    /[\u3400-\u9fff]/u.test(userQuestion) ? "zh" : "en",
}));

vi.mock(
  "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding",
  () => ({ resolveChatTurnUnderstanding: seams.resolveLegacy }),
);

vi.mock(
  "@/server/agents/coach-agent/turn-classifier/get-semantic-turn-classifier",
  () => ({ getSemanticTurnClassifier: seams.semanticFactory }),
);

vi.mock("@/server/agents/coach-agent/turn-understanding/shadow-trace", () => ({
  captureShadowTurnUnderstandingBestEffort: seams.captureLegacyTrace,
}));

vi.mock("@/server/agents/coach-agent/turn-understanding-v2/trace-v2", () => ({
  captureTurnUnderstandingV2TraceBestEffort: seams.captureV2Trace,
}));

const ORIGINAL_MODE = process.env.TURN_UNDERSTANDING_MODE;
const ORIGINAL_PILOT = process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;

beforeEach(() => {
  vi.clearAllMocks();
  seams.resolveLegacy.mockImplementation(async (_turn, args) => {
    seams.classifierFactory();
    seams.classifierPreload();
    return {
      understanding: args.deterministic,
      provenance: "llm_validated",
      classifierActuallyCalled: true,
      preload: undefined,
    };
  });
});

afterEach(() => {
  if (ORIGINAL_MODE === undefined) {
    delete process.env.TURN_UNDERSTANDING_MODE;
  } else {
    process.env.TURN_UNDERSTANDING_MODE = ORIGINAL_MODE;
  }
  if (ORIGINAL_PILOT === undefined) {
    delete process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;
  } else {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = ORIGINAL_PILOT;
  }
});

describe("learning-experience recall Pilot context boundary", () => {
  it("skips automatic assembly but keeps explicit history retrieval available", async () => {
    delete process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;

    const context = await loadChatTurnContext(
      binarySearchTurn("我以前是不是也犯过这种二分边界错误？"),
    );

    expect(seams.memory).toHaveBeenCalledTimes(0);
    expect(seams.ensureSessionPlan).toHaveBeenCalledTimes(0);
    expect(context.baseMemory).toMatchObject({
      profileId: "pilot_disabled_automatic_assembly",
      retrievalStatus: "disabled",
      teachableMemories: [],
    });
    expect(context.chatTurnPlan.toolCapabilities).toContain(
      "recall_learning_experience",
    );
  });

  it("restores only Chat automatic assembly when explicitly disabled", async () => {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "0";

    await loadChatTurnContext(binarySearchTurn("为什么我这段二分代码会 TLE？"));

    expect(seams.memory).toHaveBeenCalledTimes(1);
    expect(seams.ensureSessionPlan).toHaveBeenCalledTimes(1);
  });

  it("does not inject learning-experience recall into a general follow-up", async () => {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "1";

    const context = await loadChatTurnContext(
      turn("你可以结合我过去的学习经历，给我进一步指导吗？", undefined),
    );

    expect(context.intentMatch.intent).toBe("general_followup");
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "recall_learning_experience",
    );
    expect(seams.memory).not.toHaveBeenCalled();
  });
});

describe("live Turn Understanding V2 mode boundary", () => {
  it("defaults to v2_consume and keeps the legacy classifier pipeline cold", async () => {
    delete process.env.TURN_UNDERSTANDING_MODE;

    const context = await loadChatTurnContext(
      turn("Can you explain that again?"),
    );

    expect(getTurnUnderstandingMode()).toBe("v2_consume");
    expect(context.turnUnderstandingMode).toBe("v2_consume");
    expect(context.consumeTurnUnderstandingV2).toBe(true);
    expect(seams.resolveLegacy).not.toHaveBeenCalled();
    expect(seams.classifierFactory).not.toHaveBeenCalled();
    expect(seams.classifierPreload).not.toHaveBeenCalled();
    expect(seams.semanticFactory).not.toHaveBeenCalled();
    expect(seams.captureLegacyTrace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        classifierActuallyCalled: false,
        provenance: "deterministic_fallback",
      }),
    );
    expect(seams.captureV2Trace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        classifierActuallyCalled: false,
        provenance: "semantic_fallback",
      }),
    );
  });

  it("keeps v2_shadow explicit and classifier-free", async () => {
    process.env.TURN_UNDERSTANDING_MODE = "v2_shadow";

    const context = await loadChatTurnContext(turn("Explain this boundary."));

    expect(context.turnUnderstandingMode).toBe("v2_shadow");
    expect(context.consumeTurnUnderstandingV2).toBe(false);
    expect(seams.resolveLegacy).not.toHaveBeenCalled();
    expect(seams.classifierFactory).not.toHaveBeenCalled();
    expect(seams.classifierPreload).not.toHaveBeenCalled();
    expect(seams.semanticFactory).not.toHaveBeenCalled();
  });

  it("keeps the explicit legacy rollback deterministic and traces that no classifier ran", async () => {
    process.env.TURN_UNDERSTANDING_MODE = "legacy";

    const context = await loadChatTurnContext(
      turn("Can you explain that again?"),
    );

    expect(context.turnUnderstandingMode).toBe("legacy");
    expect(context.consumeTurnUnderstandingV2).toBe(false);
    expect(seams.resolveLegacy).not.toHaveBeenCalled();
    expect(seams.classifierFactory).not.toHaveBeenCalled();
    expect(seams.classifierPreload).not.toHaveBeenCalled();
    expect(seams.semanticFactory).not.toHaveBeenCalled();
    expect(seams.captureLegacyTrace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ classifierActuallyCalled: false }),
    );
  });
});

describe("live deterministic request and capability projection", () => {
  it.each([
    {
      message: "这个题目我没有什么思路，请你给我一点暗示",
      expectedTools: ["get_algorithm_hint"],
    },
    {
      message: "Can you explain that again?",
      expectedTools: [],
    },
    {
      message: "Show me the full code again",
      expectedTools: [],
    },
    {
      message: "Don't run it; just explain why this boundary works.",
      expectedTools: [],
    },
    {
      message: "Run it again...",
      expectedTools: ["run_current_code"],
    },
  ])(
    "keeps $message capability-scoped without history leakage",
    async ({ message, expectedTools }) => {
      delete process.env.TURN_UNDERSTANDING_MODE;
      const classify = vi.fn();

      const context = await loadChatTurnContext(
        turn(message, undefined, { semanticTurnClassifier: { classify } }),
      );

      expect(context.turnUnderstandingV2.route.kind).toBe(
        context.turnUnderstandingV2.coverage.resolution === "unknown"
          ? "model_assembled"
          : "fast_path",
      );
      expect(context.chatTurnPlan.toolCapabilities).toEqual(expectedTools);
      expect(context.chatTurnPlan.toolCapabilities).not.toContain(
        "past_problem_recall",
      );
      expect(context.chatTurnPlan.toolCapabilities).not.toContain(
        "past_mistake_recall",
      );
      expect(seams.resolveLegacy).not.toHaveBeenCalled();
      expect(seams.semanticFactory).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("does not authorize a runner for a negated execution request", async () => {
    delete process.env.TURN_UNDERSTANDING_MODE;

    const context = await loadChatTurnContext(
      turn("Don't run it; just explain why this boundary works."),
    );

    expect(context.turnUnderstandingV2.effectDenials).toEqual(
      expect.arrayContaining([expect.objectContaining({ effect: "execute" })]),
    );
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "run_current_code",
    );
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "verify_proposed_repair",
    );
    expect(seams.semanticFactory).not.toHaveBeenCalled();
  });

  it("clarifies a missing live execution target without opening a runner", async () => {
    delete process.env.TURN_UNDERSTANDING_MODE;
    const classify = vi.fn();

    const context = await loadChatTurnContext(
      turn("Run it", "", { semanticTurnClassifier: { classify } }),
    );

    expect(context.turnUnderstandingV2.route).toEqual({
      kind: "clarify",
      escalationReasons: [],
      clarificationReason: "backend_target_missing",
    });
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "run_current_code",
    );
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "verify_proposed_repair",
    );
    expect(seams.semanticFactory).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it("selects the guarded semantic slow path when both execution targets exist", () => {
    const understanding = compileTurnUnderstandingV2("Run it", {
      workspace: {
        hasCurrentCode: true,
        hasAssistantCandidate: true,
      },
    });

    expect(understanding.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["effect_ambiguity"],
    });
    expect(understanding.requests).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "execute" })]),
    );
  });

  it("uses the standard same-revision projection to guard a live ambiguous execute", async () => {
    const code = [
      "class Solution:",
      "    def solve(self):",
      "        return 1",
    ].join("\n");
    const revision = buildWorkspaceCodeRevision({
      problemId: "two-sum-id",
      language: "Python",
      code,
    });
    seams.loadStoredRecentMessages.mockResolvedValueOnce([
      {
        id: "assistant-candidate",
        sequence: 1,
        role: "assistant",
        contentMarkdown:
          "```python\nclass Solution:\n    def solve(self):\n        return 2\n```",
        metadataJson: JSON.stringify({
          workspace: { currentCodeHash: revision?.codeHash },
        }),
        reviewAttemptId: null,
        reviewAttempt: null,
      },
    ] as never);

    const context = await loadChatTurnContext(turn("Run it", code));

    expect(seams.loadStoredRecentMessages).toHaveBeenCalledTimes(1);
    expect(seams.resolveLegacy).not.toHaveBeenCalled();
    expect(context.turnUnderstandingV2.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["effect_ambiguity"],
    });
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "run_current_code",
    );
    expect(context.chatTurnPlan.toolCapabilities).not.toContain(
      "verify_proposed_repair",
    );
    expect(seams.captureV2Trace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        compiledRoute: expect.objectContaining({ kind: "model_assembled" }),
        provenance: "semantic_fallback",
        classifierActuallyCalled: false,
        fallbackReason: "assembler_unconfigured",
      }),
    );
  });

  it("calls the injected assembler once and opens only its validated execution target", async () => {
    const code = [
      "class Solution:",
      "    def solve(self):",
      "        return 1",
    ].join("\n");
    const revision = buildWorkspaceCodeRevision({
      problemId: "two-sum-id",
      language: "Python",
      code,
    });
    seams.loadStoredRecentMessages.mockResolvedValueOnce([
      {
        id: "assistant-candidate",
        sequence: 1,
        role: "assistant",
        contentMarkdown:
          "Candidate:\n```python\nclass Solution:\n    def solve(self):\n        return 2\n```",
        metadataJson: JSON.stringify({
          workspace: { currentCodeHash: revision?.codeHash },
        }),
        reviewAttemptId: null,
        reviewAttempt: null,
      },
    ] as never);
    const complete = vi.fn(async () => JSON.stringify({
        requests: [
          {
            id: "req0",
            kind: "execute",
            target: "candidate",
            sourceClauseIds: ["c0"],
            dependsOn: [],
          },
        ],
        certainty: {
          status: "confident",
          confidence: 0.96,
        },
        denials: [],
      }));

    const context = await loadChatTurnContext(
      turn("Run it", code, { modelAssembler: { complete } }),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.not.stringContaining("return 2"));
    expect(context.turnUnderstandingV2.route).toEqual({
      kind: "fast_path",
      escalationReasons: [],
    });
    expect(context.chatTurnPlan.toolCapabilities).toEqual([
      "verify_proposed_repair",
    ]);
    expect(context.intentMatch.rationale).toContain("Turn Understanding V2");
    expect(seams.captureV2Trace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        compiledRoute: expect.objectContaining({ kind: "model_assembled" }),
        understanding: expect.objectContaining({
          route: { kind: "fast_path", escalationReasons: [] },
        }),
        classifierActuallyCalled: true,
        provenance: "llm_validated",
      }),
    );
    expect(seams.loadStoredRecentMessages).toHaveBeenCalledTimes(1);
    expect(seams.memory).toHaveBeenCalledTimes(1);
  });

  it("keeps deterministic capabilities closed when the assembler provider fails", async () => {
    await primeAssistantCandidate();
    const complete = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    const context = await loadChatTurnContext(
      turn("Run it", undefined, { modelAssembler: { complete } }),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(context.turnUnderstandingV2.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["effect_ambiguity"],
    });
    expect(context.chatTurnPlan.toolCapabilities).toEqual([]);
    expect(seams.captureV2Trace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        provenance: "semantic_fallback",
        classifierActuallyCalled: true,
        fallbackReason: "assembler_provider_error",
      }),
    );
  });

  it("keeps deterministic capabilities closed when assembler output is invalid", async () => {
    await primeAssistantCandidate();
    const complete = vi.fn(async () => "not json");

    const context = await loadChatTurnContext(
      turn("Run it", undefined, {
        modelAssembler: { complete },
      }),
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(context.turnUnderstandingV2.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["effect_ambiguity"],
    });
    expect(context.chatTurnPlan.toolCapabilities).toEqual([]);
    expect(seams.captureV2Trace).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        provenance: "semantic_fallback",
        classifierActuallyCalled: true,
        fallbackReason: "assembler_invalid_json",
      }),
    );
  });
});

describe("semantic backend authority facts", () => {
  it("grants both existing candidates for an explicit target-ambiguous Run it", () => {
    const deterministic = compileTurnUnderstandingV2("Run it", {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: true },
    });

    const facts = buildSemanticBackendFacts({
      message: "Run it",
      deterministic,
      requestedActions: [],
      language: "Python",
      hasCurrentCode: true,
      hasAssistantCandidate: true,
    });

    expect(facts.executionGrants).toEqual([
      { target: "current", sourceClauseIds: ["c0"] },
      { target: "candidate", sourceClauseIds: ["c0"] },
    ]);
  });

  it("never turns a denial or hypothetical algorithm statement into execution authority", () => {
    for (const message of [
      "Don't run it; explain the invariant.",
      "If I run binary search, why must the predicate be monotonic?",
    ]) {
      const deterministic = compileTurnUnderstandingV2(message, {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: true },
      });
      const facts = buildSemanticBackendFacts({
        message,
        deterministic,
        requestedActions: [],
        language: "Python",
        hasCurrentCode: true,
        hasAssistantCandidate: true,
      });

      expect(facts.executionGrants).toEqual([]);
    }
  });

  it("derives persistence authority only from a granted ledger subject and clause", () => {
    const message = "解释这个。然后以后解释短一点。";
    const requestedActions = resolveRequestedActions(message);
    const deterministic = compileTurnUnderstandingV2(message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      requestedActions,
    });

    const facts = buildSemanticBackendFacts({
      message,
      deterministic,
      requestedActions,
      language: "Python",
      hasCurrentCode: true,
      hasAssistantCandidate: false,
    });

    expect(requestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "note_memory",
          decision: "granted",
        }),
      ]),
    );
    expect(facts.persistGrants).toEqual([
      {
        target: "preference",
        sourceClauseIds: ["c1"],
        content: "以后解释短一点",
      },
    ]);
    expect(facts.persistGrants).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "knowledge_handbook" }),
      ]),
    );
  });
});

async function primeAssistantCandidate() {
  const code = [
    "class Solution:",
    "    def solve(self):",
    "        return 1",
  ].join("\n");
  const revision = buildWorkspaceCodeRevision({
    problemId: "two-sum-id",
    language: "Python",
    code,
  });
  seams.loadStoredRecentMessages.mockResolvedValueOnce([
    {
      id: "assistant-candidate",
      sequence: 1,
      role: "assistant",
      contentMarkdown: "```python\nclass Solution:\n    pass\n```",
      metadataJson: JSON.stringify({
        workspace: { currentCodeHash: revision?.codeHash },
      }),
      reviewAttemptId: null,
      reviewAttempt: null,
    },
  ] as never);
}

function turn(
  message: string,
  code: string | undefined = [
    "class Solution:",
    "    def solve(self):",
    "        return 1",
  ].join("\n"),
  deps: Record<string, unknown> = {},
) {
  return {
    input: {
      message,
      language: "Python",
      code,
      selectedTestCaseIds: [],
    },
    db: {},
    deps,
    ftsStore: undefined,
    traceContext: undefined,
    user: { id: "user-dev" },
    profile: {
      id: "profile-1",
      explanationStyle: null,
      outputPreferences: "[]",
    },
    problem: {
      id: "two-sum-id",
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      methodName: "twoSum",
    },
    problemTags: ["hash_map"],
    chatSession: {
      id: "session-dev",
      clearedBeforeSequence: 0,
    },
    selectedTestCases: [],
  } as unknown as BootstrappedChatTurn;
}

function binarySearchTurn(message: string) {
  return {
    ...turn(message),
    problemTags: ["binary_search"],
  };
}
