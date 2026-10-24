import { describe, expect, it } from "vitest";

import type {
  SemanticClassifierOutput,
  SemanticRequestProposal,
} from "@/server/agents/coach-agent/turn-classifier/semantic-classifier-output.schema";
import type { SemanticRouteInput } from "@/server/agents/coach-agent/turn-classifier/semantic-turn-classifier.types";
import {
  validateSemanticTurnProposal,
  type SemanticClassifierBackendFacts,
} from "@/server/agents/coach-agent/turn-classifier/validate-semantic-turn-proposal";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

function slow(message = "Run it, then diagnose it and save this preference") {
  return {
    ...compileTurnUnderstandingV2(message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    }),
    route: { kind: "semantic_slow_path", reason: "semantic_uncertainty" },
  } as SemanticRouteInput;
}

const facts: SemanticClassifierBackendFacts = {
  workspaceLanguage: "Python",
  hasCurrentCode: true,
  hasAssistantCandidate: false,
  executionGrants: [{ target: "current", sourceClauseIds: ["c0"] }],
  persistGrants: [{
    target: "preference",
    sourceClauseIds: ["c0"],
    content: "Run it, then diagnose it and save this preference",
  }],
};

function proposal(): SemanticClassifierOutput {
  return {
    schemaVersion: "turn_semantic_proposal_v2",
    requests: [
      {
        id: "req0",
        kind: "execute",
        target: "current",
        sourceClauseIds: ["c0"],
        dependsOn: [],
      },
      {
        id: "req1",
        kind: "respond",
        deliverable: "fix",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "normal", form: "patch" },
        sourceClauseIds: ["c0"],
        dependsOn: ["req0"],
      },
      {
        id: "req2",
        kind: "persist",
        collection: "preference",
        content: "Run it, then diagnose it and save this preference",
        sourceClauseIds: ["c0"],
        dependsOn: [],
      },
    ],
    certainty: { status: "confident", confidence: 0.94, alternatives: [] },
  };
}

describe("semantic turn proposal validator", () => {
  it("materializes multiple canonical requests only after backend grants", () => {
    const result = validateSemanticTurnProposal(proposal(), facts, slow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.requests).toHaveLength(3);
    expect(result.understanding.requests[0]).toMatchObject({
      kind: "execute",
      authorization: "explicit_grant",
    });
    expect(result.understanding.requests[2]).toMatchObject({
      kind: "persist",
      authorization: "ledger_granted",
    });
  });

  it("rejects execute without overlapping positive authorization evidence", () => {
    const result = validateSemanticTurnProposal(proposal(), {
      ...facts,
      executionGrants: [],
    }, slow());
    expect(result).toEqual({
      ok: false,
      reason: "execute_not_explicitly_authorized",
    });
  });

  it("rejects an unresolvable backend execution target", () => {
    const forged = proposal();
    forged.requests[0] = {
      ...forged.requests[0],
      kind: "execute",
      target: "candidate",
    };
    const result = validateSemanticTurnProposal(forged, facts, slow());
    expect(result).toEqual({ ok: false, reason: "missing_assistant_candidate" });
  });

  it("rejects persist without the requested-action ledger grant", () => {
    const result = validateSemanticTurnProposal(proposal(), {
      ...facts,
      persistGrants: [],
    }, slow());
    expect(result).toEqual({
      ok: false,
      reason: "persist_not_authorized_by_ledger",
    });
  });

  it("preserves explicit denials and the deterministic disclosure ceiling", () => {
    const denied: SemanticRouteInput = {
      ...slow(),
      effectDenials: [{
        effect: "execute",
        sourceClauseIds: ["c0"],
        evidence: [],
      }],
    };
    expect(validateSemanticTurnProposal(proposal(), facts, denied)).toEqual({
      ok: false,
      reason: "execute_denied_by_user",
    });

    const fullCode = proposal();
    fullCode.requests = [{
      id: "req0",
      kind: "respond",
      deliverable: "solve",
      target: "current",
      basis: ["current_evidence"],
      delivery: { depth: "full", form: "patch" },
      sourceClauseIds: ["c0"],
      dependsOn: [],
    }];
    expect(validateSemanticTurnProposal(fullCode, facts, slow())).toEqual({
      ok: false,
      reason: "disclosure_ceiling_exceeded",
    });
  });

  it("rejects invalid dependency graphs and model ambiguity", () => {
    const forward = proposal();
    forward.requests[0] = { ...forward.requests[0], dependsOn: ["req1"] };
    expect(validateSemanticTurnProposal(forward, facts, slow())).toEqual({
      ok: false,
      reason: "forward_dependency",
    });
    expect(validateSemanticTurnProposal({
      ...proposal(),
      certainty: {
        status: "ambiguous",
        ambiguityReason: "request_structure_unclear",
        alternatives: [{ kind: "respond", summary: "Could be explanation only" }],
      },
    }, facts, slow())).toEqual({ ok: false, reason: "classifier_abstained" });
  });

  it("allows distinct fix and understand outcomes for the same target", () => {
    const distinct = proposal();
    distinct.requests = [
      {
        id: "req0",
        kind: "respond",
        deliverable: "fix",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "normal", form: "patch" },
        sourceClauseIds: ["c0"],
        dependsOn: [],
      },
      {
        id: "req1",
        kind: "respond",
        deliverable: "understand",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "normal", form: "prose" },
        sourceClauseIds: ["c0"],
        dependsOn: ["req0"],
      },
    ];
    const result = validateSemanticTurnProposal(distinct, facts, slow());
    expect(result.ok).toBe(true);
  });

  it("requires current evidence while allowing an additive basis", () => {
    const missing = proposal();
    const missingRequest: Extract<
      SemanticRequestProposal,
      { kind: "respond" }
    > = {
      id: "req0",
      kind: "respond",
      deliverable: "understand",
      target: "concept",
      basis: ["current_evidence", "concept_kb"],
      delivery: { depth: "normal", form: "prose" },
      sourceClauseIds: ["c0"],
      dependsOn: [],
    };
    missing.requests = [missingRequest];
    expect(validateSemanticTurnProposal(missing, facts, slow())).toMatchObject({
      ok: true,
    });

    missing.requests = [{
      ...missingRequest,
      basis: ["current_evidence", "current_evidence"],
    }];
    expect(validateSemanticTurnProposal(missing, facts, slow())).toEqual({
      ok: false,
      reason: "duplicate_basis",
    });
  });

  it("requires recommend and recall to name their supporting basis", () => {
    const invalid = proposal();
    const recommendRequest: Extract<
      SemanticRequestProposal,
      { kind: "respond" }
    > = {
      id: "req0",
      kind: "respond",
      deliverable: "recommend",
      target: "current",
      basis: ["current_evidence"],
      delivery: { depth: "normal", form: "prose" },
      sourceClauseIds: ["c0"],
      dependsOn: [],
    };
    invalid.requests = [recommendRequest];
    expect(validateSemanticTurnProposal(invalid, facts, slow())).toEqual({
      ok: false,
      reason: "invalid_respond_axes",
    });
    invalid.requests = [{
      ...recommendRequest,
      deliverable: "recall",
    }];
    expect(validateSemanticTurnProposal(invalid, facts, slow())).toEqual({
      ok: false,
      reason: "invalid_respond_axes",
    });
  });

  it("materializes only verbatim ledger-owned persist content", () => {
    const rewritten = proposal();
    const persistRequest = rewritten.requests[2];
    if (persistRequest.kind !== "persist") {
      throw new Error("fixture must contain a persist request");
    }
    rewritten.requests[2] = {
      ...persistRequest,
      content: "Answer in English from now on",
    };
    expect(validateSemanticTurnProposal(rewritten, facts, slow())).toEqual({
      ok: false,
      reason: "persist_content_not_verbatim",
    });

    const unavailableFacts: SemanticClassifierBackendFacts = {
      ...facts,
      persistGrants: [{ target: "preference", sourceClauseIds: ["c0"] }],
    };
    expect(validateSemanticTurnProposal(proposal(), unavailableFacts, slow()))
      .toEqual({ ok: false, reason: "persist_content_unavailable" });
  });
});
