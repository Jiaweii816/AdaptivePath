import { describe, expect, it } from "vitest";

import { buildContextPlanV2 } from "@/server/agents/coach-agent/turn-understanding-v2/context-plan-v2";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveMemoryIntentV2 } from "@/server/agents/coach-agent/turn-understanding-v2/memory-intent-v2";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";
import type {
  RespondTurnRequest,
  TurnRequest,
  TurnUnderstandingV2,
} from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";

function respond(
  id: string,
  overrides: Partial<RespondTurnRequest> = {},
): RespondTurnRequest {
  return {
    id,
    kind: "respond",
    deliverable: "understand",
    target: "current",
    basis: ["current_evidence"],
    delivery: { depth: "normal", form: "prose" },
    sourceClauseIds: ["c0"],
    dependsOn: [],
    evidence: [],
    ...overrides,
  };
}

function understanding(
  requests: readonly TurnRequest[],
  overrides: Partial<TurnUnderstandingV2> = {},
): TurnUnderstandingV2 {
  return {
    schemaVersion: "v2",
    clauses: [{ id: "c0", text: "fixture", start: 0, end: 7 }],
    coverage: {
      queryScript: "latin",
      contentUnitCount: 1,
      coveredUnitCount: 1,
      ratio: 1,
      resolution: "trivial",
    },
    requests,
    disclosure: { ceiling: "guided", source: "default" },
    categoryDenials: [],
    effectDenials: [],
    languageScope: { supportedLanguage: "python" },
    affect: "none",
    discourse: {
      repeatSignals: [],
      continuationSignals: [],
      referentSignals: [],
    },
    route: { kind: "fast_path", escalationReasons: [] },
    ...overrides,
  };
}

describe("V2 context projection", () => {
  it("keeps truth and ambient personalization present, then adds Basis material", () => {
    expect(buildContextPlanV2(understanding([]))).toMatchObject({
      workspace: true,
      runEvidence: true,
      learnerSignals: true,
    });

    expect(
      buildContextPlanV2(
        understanding([
          respond("r0", {
            target: "current",
            basis: ["current_evidence", "past_problems", "api_kb"],
          }),
        ]),
      ),
    ).toMatchObject({
      workspace: true,
      currentCode: true,
      runEvidence: true,
      learnerSignals: true,
      episodes: true,
      handbook: true,
    });
  });
});

describe("V2 tool eligibility", () => {
  describe("execution capability ownership", () => {
    it("does not let a fix deliverable open execution on its own", () => {
      const compiled = compileTurnUnderstandingV2("我的代码哪里错了？", {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: true },
      });

      expect(deriveToolEligibilityV2(compiled)).not.toContain(
        "verify_proposed_repair",
      );
    });

    it("opens candidate execution when Effect asks for it", () => {
      const compiled = compileTurnUnderstandingV2("跑一下你刚才给的代码", {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: true },
      });

      expect(deriveToolEligibilityV2(compiled)).toContain(
        "verify_proposed_repair",
      );
    });
  });

  it.each([
    ["为什么我的代码还会报错？", "fix"],
    ["帮我优化这份实现", "improve"],
    ["请给我完整实现", "solve"],
  ] as const)(
    "does not let a %s response (%s) expose candidate execution",
    (message, deliverable) => {
      const compiled = compileTurnUnderstandingV2(message, {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      });

      expect(compiled.requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "respond", deliverable }),
        ]),
      );
      expect(deriveToolEligibilityV2(compiled)).not.toContain(
        "verify_proposed_repair",
      );
    },
  );

  it("does not expose candidate execution for hint-only or explanatory turns", () => {
    for (const message of ["只给我一点提示", "解释一下为什么要用双指针"]) {
      const compiled = compileTurnUnderstandingV2(message, {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      });
      expect(deriveToolEligibilityV2(compiled)).not.toContain(
        "verify_proposed_repair",
      );
    }
  });

  it("treats a plain Chinese 提示 request as a hint, including compound turns", () => {
    const compiled = compileTurnUnderstandingV2(
      "我有点慌，你能先给我一些提示吗？我以前错过相似的题目吗？",
      { workspace: { hasCurrentCode: true, hasAssistantCandidate: false } },
    );

    expect(compiled.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "respond",
          deliverable: "solve",
          delivery: expect.objectContaining({ depth: "hint" }),
        }),
      ]),
    );
    expect(deriveToolEligibilityV2(compiled)).toContain("get_algorithm_hint");
  });

  it("allows an explicitly requested candidate to be constructed this turn", () => {
    const compiled = compileTurnUnderstandingV2("验证一下你的改法", {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    });

    expect(compiled.route).toEqual({
      kind: "fast_path",
      escalationReasons: [],
    });
    expect(compiled.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "execute",
          target: "candidate",
          authorization: "explicit_grant",
        }),
      ]),
    );
    expect(deriveToolEligibilityV2(compiled)).toContain("verify_proposed_repair");
  });

  it.each([
    [
      "请把刚才这个 connect[cur] 的 KeyError 错误收进错题本，并加一个自测问题。",
      "save_mistake_book_entry",
    ],
    [
      "请把这个 deque 用法收进 knowledge book，方便以后复习。",
      "save_knowledge_note",
    ],
  ] as const)("carries a natural save request through to %s", (message, tool) => {
    const compiled = compileTurnUnderstandingV2(message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    });

    expect(compiled.route).toEqual({
      kind: "model_assembled",
      escalationReasons: ["low_coverage"],
    });
    expect(deriveToolEligibilityV2(compiled)).toContain(tool);
  });

  it("is a direct union of Basis, Deliverable, Target, Delivery, and Effect", () => {
    const value = understanding([
      respond("r0", {
        deliverable: "solve",
        target: "api",
        basis: ["current_evidence", "past_problems", "past_mistakes"],
        delivery: { depth: "hint", form: "prose" },
      }),
      respond("r1", {
        deliverable: "recommend",
        basis: ["current_evidence", "practice_catalog"],
      }),
      {
        id: "e0",
        kind: "execute",
        target: "current",
        authorization: "explicit_grant",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
      {
        id: "p0",
        kind: "persist",
        collection: "knowledge_handbook",
        content: "记住这个模板",
        authorization: "ledger_granted",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
    ]);

    expect(deriveToolEligibilityV2(value)).toEqual([
      "past_problem_recall",
      "past_mistake_recall",
      "lookup_api_reference",
      "get_algorithm_hint",
      "find_practice_problem",
      "search_interview_variant_candidates",
      "run_current_code",
      "save_knowledge_note",
    ]);
  });

  it("opens every authorized persistence collection through its own tool", () => {
    expect(
      deriveToolEligibilityV2(
        understanding([
          {
            id: "p0",
            kind: "persist",
            collection: "preference",
            content: "以后简短一点",
            authorization: "ledger_granted",
            sourceClauseIds: ["c0"],
            dependsOn: [],
            evidence: [],
          },
          {
            id: "p1",
            kind: "persist",
            collection: "mistake_book",
            content: "收录这道题",
            authorization: "ledger_granted",
            sourceClauseIds: ["c0"],
            dependsOn: [],
            evidence: [],
          },
        ]),
      ),
    ).toEqual(["note_memory", "save_mistake_book_entry"]);
  });

  it("lets run_denied veto runners without suppressing read tools", () => {
    const value = understanding(
      [
        {
          id: "e0",
          kind: "execute",
          target: "candidate",
          authorization: "explicit_grant",
          sourceClauseIds: ["c0"],
          dependsOn: [],
          evidence: [],
        },
        respond("r0", {
          basis: ["current_evidence", "past_problems"],
        }),
      ],
      {
        effectDenials: [
          {
            effect: "execute",
            sourceClauseIds: ["c0"],
            evidence: [],
          },
        ],
      },
    );

    expect(deriveToolEligibilityV2(value)).toEqual(["past_problem_recall"]);
  });

  it("does not infer any execution tool for a fix response", () => {
    expect(
      deriveToolEligibilityV2(
        understanding([
          respond("r0", {
            deliverable: "fix",
            delivery: { depth: "hint", form: "patch" },
          }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("V2 memory intent", () => {
  it("reads only Basis across the complete request set", () => {
    const first = understanding([
      respond("r0", {
        deliverable: "solve",
        target: "api",
        basis: ["current_evidence", "past_problems"],
        delivery: { depth: "hint", form: "trace" },
      }),
    ]);
    const second = understanding(
      [
        respond("r0", {
          deliverable: "chat",
          target: "current",
          basis: ["current_evidence", "past_problems"],
          delivery: { depth: "full", form: "patch" },
        }),
      ],
      { affect: "anxious_stuck" },
    );

    expect(deriveMemoryIntentV2(first)).toBe("past_problem_recall_request");
    expect(deriveMemoryIntentV2(second)).toBe("past_problem_recall_request");
  });

  it("uses deterministic precedence when several directed Basis sources coexist", () => {
    expect(
      deriveMemoryIntentV2(
        understanding([
          respond("r0", {
            basis: [
              "current_evidence",
              "learner_profile",
              "past_problems",
              "past_mistakes",
            ],
          }),
        ]),
      ),
    ).toBe("past_mistake_recall_request");
  });

  it.each([
    ["learner_profile", "profile_meta_question"],
    ["practice_catalog", "practice_request"],
    ["api_kb", "api_reference_question"],
    ["concept_kb", "concept_question"],
    ["current_evidence", "general_followup"],
  ] as const)("maps Basis %s to retrieval profile %s", (basis, expected) => {
    expect(
      deriveMemoryIntentV2(
        understanding([respond("r0", { basis: ["current_evidence", basis] })]),
      ),
    ).toBe(expected);
  });
});
