import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

type TrajectoryCase = {
  caseId: string;
  category: string;
  userMessage: string;
  code?: string;
  expectedTools: ChatToolName[];
  forbiddenTools: ChatToolName[];
  orderedSubsequence: ChatToolName[];
};

const DATASET = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "evals/datasets/chat-trajectory/trajectory-v2.json",
    ),
    "utf8",
  ),
) as { cases: TrajectoryCase[] };

describe("deterministic Turn Compiler trajectory gate", () => {
  it("treats vague container API wording as a past-mistake topic, not an API lookup", () => {
    const understanding = compileTurnUnderstandingV2(
      "Python 这些容器 API，我之前是不是也记混过？",
      {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      },
    );
    expect(understanding.requests).toEqual([
      expect.objectContaining({
        kind: "respond",
        deliverable: "recall",
        target: "current",
        basis: ["current_evidence", "past_mistakes"],
      }),
    ]);
    expect(deriveToolEligibilityV2(understanding)).toContain("past_mistake_recall");
  });

  it("meets every required capability without opening a forbidden capability", () => {
    let requiredMatched = 0;
    let requiredTotal = 0;
    let forbiddenOpened = 0;
    const forbiddenOffenders: string[] = [];

    for (const item of DATASET.cases) {
      const understanding = compile(item);
      const capabilities = deriveToolEligibilityV2(understanding);
      requiredMatched += item.expectedTools.filter((tool) =>
        capabilities.includes(tool),
      ).length;
      requiredTotal += item.expectedTools.length;
      const opened = item.forbiddenTools.filter((tool) => capabilities.includes(tool));
      forbiddenOpened += opened.length;
      forbiddenOffenders.push(...opened.map((tool) => `${item.caseId}:${tool}`));
    }

    expect(requiredTotal).toBe(46);
    expect(requiredMatched).toBe(requiredTotal);
    expect(requiredMatched).toBeGreaterThanOrEqual(39);
    expect(forbiddenOpened, forbiddenOffenders.join(", ")).toBe(0);
  });

  it("preserves all seven compound tool-request orders", () => {
    const compound = DATASET.cases.filter(
      ({ category }) => category === "multi_step_tool_chain",
    );
    expect(compound).toHaveLength(7);

    for (const item of compound) {
      const understanding = compile(item);
      expect(expectedToolsInProductionOrder(understanding, item.orderedSubsequence)).toEqual(
        item.orderedSubsequence,
      );
    }
  });

  it("derives expected tools from the production projection only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "tests/unit/turn-understanding-v2-trajectory-gate.test.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/const\s+\w*(?:TOOL|Tool)\w*_?MAP\s*[:=]/u);
  });
});

function compile(item: TrajectoryCase) {
  return compileTurnUnderstandingV2(item.userMessage, {
    workspace: {
      hasCurrentCode: Boolean(item.code?.trim()),
      hasAssistantCandidate: false,
    },
    requestedActions: resolveRequestedActions(item.userMessage),
  });
}

function expectedToolsInProductionOrder(
  understanding: Parameters<typeof deriveToolEligibilityV2>[0],
  expected: readonly ChatToolName[],
): ChatToolName[] {
  return deriveToolEligibilityV2(understanding).filter((tool) =>
    expected.includes(tool),
  );
}
