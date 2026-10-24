import { describe, expect, it } from "vitest";

import { applyGradedAuthorization } from "@/server/agents/coach-agent/turn-understanding-v2/assembler/graded-authorization";
import { createRequiredActionLedgerFromTopology } from "@/server/agents/coach-agent/chat-tool-loop";
import { resolveModelPersistConfirmation } from "@/server/agents/coach-agent/model-persist-confirmation";
import { resolveChatTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding-v2";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import type { TurnRequest } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";

const facts = {
  hasCurrentCode: true,
  hasAssistantCandidate: false,
  executionGrants: [],
  persistGrants: [],
  deniedExecutionTargets: [],
  deniedPersistCollections: [],
};

const base = { sourceClauseIds: ["c0"], dependsOn: [] };

describe("applyGradedAuthorization", () => {
  it("adopts tier 0 read capability in full", () => {
    const result = applyGradedAuthorization({
      requests: [{
        ...base,
        kind: "respond",
        id: "m0",
        deliverable: "recall",
        target: "current",
        basis: ["current_evidence", "past_mistakes"],
        delivery: { depth: "normal", form: "prose" },
      }],
      denials: [],
      certainty: { status: "confident", confidence: 0.9 },
    }, facts);

    expect(result.requests[0]).toMatchObject({
      basis: expect.arrayContaining(["past_mistakes"]),
    });
  });

  it("exposes an ungranted execute without making it required", () => {
    const result = applyGradedAuthorization({
      requests: [{ ...base, kind: "execute", id: "m0", target: "current" }],
      denials: [],
      certainty: { status: "confident", confidence: 0.9 },
    }, facts);

    expect(result.requests[0]).toMatchObject({
      kind: "execute",
      authorization: "model_proposed",
    });
    const requests = result.requests.map((request) => ({
      ...request,
      evidence: [],
    })) as TurnRequest[];
    expect(createRequiredActionLedgerFromTopology(requests, []).actions).toEqual([]);
  });

  it("routes an ungranted persist to pending confirmation", () => {
    const result = applyGradedAuthorization({
      requests: [{
        ...base,
        kind: "persist",
        id: "m0",
        collection: "mistake_book",
        content: "x",
      }],
      denials: [],
      certainty: { status: "confident", confidence: 0.95 },
    }, facts);

    expect(result.requests).toEqual([]);
    expect(result.pendingPersists).toEqual(["save_mistake_book_entry"]);
  });

  it("carries a model-proposed persist through the Task 13 resolver", async () => {
    const deterministic = {
      ...compileTurnUnderstandingV2("Keep this debugging note", {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      }),
      route: { kind: "model_assembled", escalationReasons: ["low_coverage"] },
    } as const;
    const resolution = await resolveChatTurnUnderstandingV2({
      input: { message: "Keep this debugging note", code: "print(1)", language: "Python" },
      deps: {
        modelAssembler: {
          complete: async () => JSON.stringify({
            requests: [{
              ...base,
              id: "m0",
              kind: "persist",
              collection: "mistake_book",
              content: "Keep this debugging note",
            }],
            denials: [],
            certainty: { status: "confident", confidence: 0.9 },
          }),
        },
      },
    } as never, {
      deterministic,
      requestedActions: [],
      historyProjection: { messages: [], decisions: [] },
    });

    expect(resolution.pendingPersists).toEqual(["save_mistake_book_entry"]);
    expect(resolution.understanding.requests).toEqual([]);
    expect(resolveModelPersistConfirmation("确认", [{
      role: "assistant",
      metadataJson: JSON.stringify({
        pendingModelPersists: resolution.pendingPersists,
      }),
    }]).resolution).toMatchObject({
      disposition: "confirmed",
      promotedTools: ["save_mistake_book_entry"],
    });
  });

  it("lets a denial veto a model proposal", () => {
    const result = applyGradedAuthorization({
      requests: [{ ...base, kind: "execute", id: "m0", target: "current" }],
      denials: [{ category: "effect", value: "execute" }],
      certainty: { status: "confident", confidence: 0.95 },
    }, facts);

    expect(result.requests).toEqual([]);
  });

  it("lets a deterministic category denial veto model read expansion", () => {
    const result = applyGradedAuthorization({
      requests: [{
        ...base,
        kind: "respond",
        id: "m0",
        deliverable: "recall",
        target: "current",
        basis: ["current_evidence", "past_mistakes"],
        delivery: { depth: "normal", form: "prose" },
      }],
      denials: [],
      certainty: { status: "confident", confidence: 0.95 },
    }, {
      ...facts,
      categoryDenials: [{
        category: "basis",
        value: "past_mistakes",
        sourceClauseIds: ["c0"],
        evidence: [],
      }],
    });

    expect(result.requests).toEqual([]);
  });

  it("drops an execute whose workspace target does not exist", () => {
    const result = applyGradedAuthorization({
      requests: [{ ...base, kind: "execute", id: "m0", target: "candidate" }],
      denials: [],
      certainty: { status: "confident", confidence: 0.95 },
    }, facts);

    expect(result.requests).toEqual([]);
  });

  it("keeps a valid ungranted execute optional through the resolver", async () => {
    const deterministic = {
      ...compileTurnUnderstandingV2("Inspect this carefully", {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      }),
      route: { kind: "model_assembled", escalationReasons: ["low_coverage"] },
    } as const;
    const resolution = await resolveChatTurnUnderstandingV2({
      input: { message: "Inspect this carefully", code: "print(1)", language: "Python" },
      deps: { modelAssembler: { complete: async () => JSON.stringify({
        requests: [{ ...base, id: "m0", kind: "execute", target: "current" }],
        denials: [], certainty: { status: "confident", confidence: 0.9 },
      }) } },
    } as never, {
      deterministic, requestedActions: [], historyProjection: { messages: [], decisions: [] },
    });

    expect(resolution.understanding.requests).toMatchObject([
      { kind: "execute", authorization: "model_proposed" },
    ]);
    expect(createRequiredActionLedgerFromTopology(
      resolution.understanding.requests, [],
    ).actions).toEqual([]);
  });

  it("treats the newest empty pending metadata as a tombstone", () => {
    const confirmation = resolveModelPersistConfirmation("确认", [
      {
        role: "assistant",
        metadataJson: JSON.stringify({ pendingModelPersists: [] }),
      },
      {
        role: "assistant",
        metadataJson: JSON.stringify({
          pendingModelPersists: ["save_mistake_book_entry"],
        }),
      },
    ]);

    expect(confirmation.pending).toEqual([]);
    expect(confirmation.resolution.disposition).toBe("discarded");
  });
});
