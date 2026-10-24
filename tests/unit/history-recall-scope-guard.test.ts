import { describe, expect, it } from "vitest";

import {
  deriveHistoryRecallScope,
  guardHistoryRecallScopeClaims,
} from "@/server/agents/coach-agent/history-recall-scope-guard";
import type { ChatReplyResult } from "@/server/agents/coach-agent/chat-reply-contracts";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import type { Operation } from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";

const MODEL_REPLY = "Keep the model synthesis.";

function operation(
  family: Operation["family"],
  target: Operation["target"],
): Operation {
  return {
    id: `op-${family}-${target}`,
    family,
    target,
    sourceClauseId: "c0",
    dependsOn: [],
    evidence: [],
    resolution: "explicit",
  };
}

function recallTrace(items: Array<{ title: string; summary: string }>) {
  return [{
    toolCallId: "recall-call",
    name: "past_mistake_recall" as const,
    result: {
      items: items.map((item) => ({
        kind: "past_mistake" as const,
        ...item,
        mechanisms: [],
        evidenceBasis: "durable_negative_claim" as const,
        executionAuthority: "unknown" as const,
        resolutionStatus: "unknown" as const,
        relationToCurrent: "cross_problem_history" as const,
      })),
    },
    disposition: "executed" as const,
  }] satisfies ChatReplyResult["toolTrace"];
}

function guard(
  recallScope: ReturnType<typeof deriveHistoryRecallScope>,
  toolTrace: ChatReplyResult["toolTrace"],
) {
  return guardHistoryRecallScopeClaims({
    reply: MODEL_REPLY,
    responseLanguage: "en",
    recallScope,
    toolTrace,
  });
}

describe("history recall scope derivation", () => {
  it("derives recall_only and none from parsed operations, not a label", () => {
    expect(
      deriveHistoryRecallScope(
        parseTurnUnderstanding("What past mistakes have I made?"),
      ),
    ).toBe("recall_only");
    expect(
      deriveHistoryRecallScope(parseTurnUnderstanding("Explain this invariant")),
    ).toBe("none");
  });

  it("classifies answer+recall and diagnose+recall as compound", () => {
    const recall = operation("recall", "past_mistake");
    expect(
      deriveHistoryRecallScope({
        operations: [operation("answer", "concept"), recall],
      }),
    ).toBe("compound");
    expect(
      deriveHistoryRecallScope({
        operations: [operation("diagnose", "current_user_code"), recall],
      }),
    ).toBe("compound");
  });
});

describe("history recall deterministic projection", () => {
  it("replaces an empty recall-only result with the scoped empty reply", () => {
    const result = guard("recall_only", recallTrace([]));
    expect(result).toMatchObject({ replaced: true, itemCount: 0 });
    expect(result.reply).toContain("no matching historical evidence");
  });

  it("renders positive recall-only items from the trusted tool result", () => {
    const result = guard("recall_only", recallTrace([{
      title: "Sliding-window boundary",
      summary: "The left boundary previously moved backward.",
    }]));
    expect(result).toMatchObject({ replaced: true, itemCount: 1 });
    expect(result.reply).toContain("Sliding-window boundary");
    expect(result.reply).toContain("left boundary previously moved backward");
  });

  it("keeps a grounded Coach answer with a transferable prevention cue", () => {
    const result = guardHistoryRecallScopeClaims({
      reply:
        "Last time you forgot to mark visited during graph DFS. This time, check when a node enters visited before expanding its neighbors.",
      responseLanguage: "en",
      recallScope: "recall_only",
      toolTrace: recallTrace([{
        title: "Graph DFS assisted repair",
        summary:
          "The learner forgot to mark visited, then repaired the traversal after Coach guidance.",
      }]),
    });

    expect(result).toMatchObject({ replaced: false, itemCount: 1 });
    expect(result.reply).toContain("check when a node enters visited");
  });

  it("still replaces an overreaching history claim", () => {
    const result = guardHistoryRecallScopeClaims({
      reply:
        "You always fail graph DFS. This time check visited before expanding neighbors.",
      responseLanguage: "en",
      recallScope: "recall_only",
      toolTrace: recallTrace([{
        title: "Graph DFS assisted repair",
        summary: "The learner once forgot to mark visited.",
      }]),
    });

    expect(result).toMatchObject({ replaced: true, itemCount: 1 });
    expect(result.reply).not.toContain("always fail");
  });
});

describe("history recall compound and trace safety", () => {
  it.each(["none", "compound"] as const)(
    "keeps the model reply for %s scope",
    (scope) => {
      expect(guard(scope, recallTrace([]))).toEqual({
        reply: MODEL_REPLY,
        replaced: false,
        itemCount: 0,
      });
    },
  );

  it("keeps both answer+recall and diagnose+recall model synthesis", () => {
    const recall = operation("recall", "past_problem");
    for (const primary of [
      operation("answer", "concept"),
      operation("diagnose", "current_user_code"),
    ]) {
      const scope = deriveHistoryRecallScope({ operations: [primary, recall] });
      expect(guard(scope, recallTrace([])).reply).toBe(MODEL_REPLY);
    }
  });

  it("keeps the model reply when a recall-only trace contains another tool", () => {
    const trace = [
      ...recallTrace([]),
      {
        toolCallId: "lookup-call",
        name: "lookup_api_reference" as const,
        result: {},
        disposition: "executed" as const,
      },
    ];
    expect(guard("recall_only", trace).reply).toBe(MODEL_REPLY);
  });

  it("keeps the model reply for missing or invalid recall traces", () => {
    expect(guard("recall_only", []).reply).toBe(MODEL_REPLY);
    expect(guard("recall_only", [{
      toolCallId: "invalid-call",
      name: "past_mistake_recall",
      result: { items: "invalid" },
      disposition: "executed",
    }])).toEqual({ reply: MODEL_REPLY, replaced: false, itemCount: 0 });
  });
});
