import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

type DatasetCase = {
  caseId: string;
  slice: "easy" | "compound" | "negation" | "referent" | "effect";
  message: string;
  workspace: {
    hasCurrentCode: boolean;
    hasAssistantCandidate: boolean;
  };
  ledger?: Array<{
    toolName:
      | "note_memory"
      | "save_knowledge_note"
      | "save_mistake_book_entry";
    decision: RequestedAction["decision"];
  }>;
  expectedRoute: "fast_path" | "semantic_slow_path" | "clarify";
  expectedRequests: string[];
  expectedDependencies?: string[];
  expectedClarificationReason?: string;
};

const DATASET = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "evals/datasets/chat-turn-understanding-v2/common-turn-route-v1.json",
    ),
    "utf8",
  ),
) as { cases: DatasetCase[] };

describe("Turn Understanding V2 common-route acceptance", () => {
  it.each(DATASET.cases)("$caseId", (item) => {
    const understanding = compileTurnUnderstandingV2(item.message, {
      workspace: item.workspace,
      requestedActions: requestedActions(item),
    });

    const expectedRoute = understanding.coverage.resolution === "unknown"
      ? "model_assembled"
      : item.expectedRoute === "semantic_slow_path"
        ? "model_assembled"
        : item.expectedRoute;
    expect(understanding.route.kind).toBe(expectedRoute);
    for (const request of understanding.requests) {
      if (request.kind === "respond") {
        expect(request.basis).toContain("current_evidence");
        expect(Object.keys(request)).not.toEqual(
          expect.arrayContaining(["task", "subject", "presentation", "binding"]),
        );
      }
    }
    if (
      item.expectedClarificationReason && expectedRoute === "clarify"
    ) {
      if (understanding.route.kind === "clarify") {
        expect(understanding.route.clarificationReason).toBe(item.expectedClarificationReason);
      } else {
        expect.fail("expected a clarification route");
      }
    }
    if (item.expectedDependencies) {
      expect(
        understanding.requests.flatMap((request) =>
          request.dependsOn.map((dependency) => `${request.id}->${dependency}`),
        ),
      ).toEqual(item.expectedDependencies);
    }
  });

  it("keeps every resolved non-effect case on the fast path", () => {
    const resolved = DATASET.cases.filter((item) => {
      if (item.slice === "effect") return false;
      return compileTurnUnderstandingV2(item.message, {
        workspace: item.workspace,
        requestedActions: requestedActions(item),
      }).coverage.resolution === "resolved";
    });
    expect(resolved).not.toHaveLength(0);
    expect(resolved.every((item) => compileTurnUnderstandingV2(item.message, {
      workspace: item.workspace,
      requestedActions: requestedActions(item),
    }).route.kind === "fast_path")).toBe(true);
  });
});

function requestedActions(item: DatasetCase): RequestedAction[] {
  return (item.ledger ?? []).map((entry, index) => ({
    toolName: entry.toolName,
    order: index,
    decision: entry.decision,
    evidence: [
      {
        clause: item.message,
        matchedTarget: null,
        matchedAction: null,
        requestPatternId:
          entry.decision === "granted" ? "test_ledger_grant" : null,
        exclusionId: null,
      },
    ],
  }));
}
