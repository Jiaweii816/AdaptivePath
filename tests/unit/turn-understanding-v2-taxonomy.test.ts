import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BasisSource,
  Deliverable,
  ResponseTarget,
  TurnRequest,
  TurnUnderstandingV2,
} from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import { validateTurnUnderstandingV2Invariants } from "@/server/agents/coach-agent/turn-understanding-v2/validate-invariants";

function respond(
  overrides: Partial<Extract<TurnRequest, { kind: "respond" }>> = {},
): Extract<TurnRequest, { kind: "respond" }> {
  return {
    id: "req0",
    kind: "respond",
    deliverable: "solve",
    target: "current",
    basis: ["current_evidence"],
    delivery: { depth: "hint", form: "prose" },
    sourceClauseIds: ["c0"],
    dependsOn: [],
    evidence: [],
    ...overrides,
  };
}

function understanding(requests: TurnRequest[]): TurnUnderstandingV2 {
  return {
    schemaVersion: "v2",
    clauses: [{ id: "c0", text: "给我提示", start: 0, end: 4 }],
    coverage: {
      queryScript: "han",
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
    discourse: { repeatSignals: [], continuationSignals: [], referentSignals: [] },
    route: { kind: "fast_path", escalationReasons: [] },
  };
}

describe("TurnUnderstandingV2 taxonomy", () => {
  it("publishes the five orthogonal categories without old task/subject labels", () => {
    expectTypeOf<Deliverable>().toEqualTypeOf<
      "solve" | "fix" | "understand" | "improve" | "recommend" | "recall" | "chat"
    >();
    expectTypeOf<ResponseTarget>().toEqualTypeOf<"current" | "concept" | "api">();
    expectTypeOf<BasisSource>().toEqualTypeOf<
      | "current_evidence"
      | "past_problems"
      | "past_mistakes"
      | "learner_profile"
      | "concept_kb"
      | "api_kb"
      | "practice_catalog"
    >();
    expect(Object.keys(respond())).not.toEqual(
      expect.arrayContaining(["task", "subject", "presentation", "binding"]),
    );
  });

  it("keeps execute and persist as authorized Effect siblings", () => {
    const requests: TurnRequest[] = [
      {
        id: "req0",
        kind: "execute",
        target: "current",
        authorization: "explicit_grant",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
      {
        id: "req1",
        kind: "persist",
        collection: "mistake_book",
        content: "请收录进错题本，要点：哈希表去重",
        authorization: "ledger_granted",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
    ];
    expect(validateTurnUnderstandingV2Invariants(understanding(requests))).toEqual([]);
  });
});

describe("TurnUnderstandingV2 invariants", () => {
  it("allows additive non-current basis while requiring valid counts and persist content", () => {
    const invalid = understanding([
      respond({ basis: ["past_problems"], delivery: { depth: "normal", form: "prose", count: 0 } }),
      {
        id: "req1",
        kind: "persist",
        collection: "preference",
        content: "",
        authorization: "ledger_granted",
        sourceClauseIds: ["c0"],
        dependsOn: [],
        evidence: [],
      },
    ]);
    expect(validateTurnUnderstandingV2Invariants(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "invalid_delivery_count",
        "empty_persist_content",
      ]),
    );
    expect(validateTurnUnderstandingV2Invariants(invalid).map(({ code }) => code)).not.toContain(
      "missing_current_evidence_basis",
    );
  });

  it("still rejects duplicate ids and forged effect authority", () => {
    const invalid = understanding([
      respond({ id: "req0" }),
      {
        id: "req0",
        kind: "execute",
        target: "current",
        authorization: "model_grant",
        sourceClauseIds: ["c0"],
        dependsOn: ["req0"],
        evidence: [],
      } as unknown as TurnRequest,
    ]);
    expect(validateTurnUnderstandingV2Invariants(invalid).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "duplicate_request_id",
        "self_dependency",
        "invalid_execute_authorization",
      ]),
    );
  });
});
