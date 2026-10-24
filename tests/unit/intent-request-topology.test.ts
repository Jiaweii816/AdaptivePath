import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveChatTurnToolPlan } from "@/server/agents/coach-agent/chat-tool-plan";
import { createRequiredActionLedgerFromTopology } from "@/server/agents/coach-agent/chat-tool-loop";
import { toolOrderFromTopology } from "@/server/agents/coach-agent/turn-understanding-v2/request-topology";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";
import type { TurnRequest } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import type { ChatToolRuntimeSnapshot } from "@/server/tools/chat-tools/chat-tool-runtime";
import { createRequiredActionLedger } from "@/server/tools/chat-tools/required-action-ledger";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

const workspace = { hasCurrentCode: true, hasAssistantCandidate: false };

describe("toolOrderFromTopology", () => {
  it("schedules the history lookup before the run it precedes", () => {
    const understanding = compileTurnUnderstandingV2(
      "先查我以前是否犯过类似错，然后运行当前代码",
      { workspace },
    );
    const order = toolOrderFromTopology(understanding.requests);
    expect(order.get("past_mistake_recall")).toBeLessThan(
      order.get("run_current_code")!,
    );
  });

  it("falls back to span order when nothing depends on anything", () => {
    const understanding = compileTurnUnderstandingV2(
      "运行当前代码，再推荐两道题",
      { workspace },
    );
    const order = toolOrderFromTopology(understanding.requests);
    expect(order.get("run_current_code")).toBeLessThan(
      order.get("find_practice_problem")!,
    );
  });

  it("uses topology order instead of legacy action offsets in the loop ledger", () => {
    const requests = dependentPersistenceRequests();
    const ledger = createRequiredActionLedgerFromTopology(requests, [
      action("note_memory", 0),
      action("save_knowledge_note", 99),
    ]);
    expect(ledger.actions.map((item) => item.toolName)).toEqual([
      "save_knowledge_note",
      "note_memory",
    ]);
  });

  it("forces the next topology tool before running code in the production plan", () => {
    const understanding = compileTurnUnderstandingV2(
      "先查我以前是否犯过类似错，然后运行当前代码",
      { workspace },
    );

    expect(productionPlan(understanding).toolChoice).toBe("past_mistake_recall");
  });

  it("leaves a recommendation source choice to the model", () => {
    const understanding = compileTurnUnderstandingV2(
      "推荐两道同类型练习题，运行当前代码",
      { workspace },
    );

    expect(understanding.requests.every(({ dependsOn }) => dependsOn.length === 0)).toBe(true);
    expect(productionPlan(understanding).toolChoice).toBe("auto");
  });

  it("projects a variant request all the way into the LLM tool manifest", () => {
    const understanding = compileTurnUnderstandingV2("找这题的面试变体", {
      workspace,
    });
    const plan = productionPlan(understanding);

    expect(deriveToolEligibilityV2(understanding)).toEqual(
      expect.arrayContaining([
        "find_practice_problem",
        "search_interview_variant_candidates",
      ]),
    );
    expect(plan.manifest.map(({ function: tool }) => tool.name)).toEqual(
      expect.arrayContaining([
        "find_practice_problem",
        "search_interview_variant_candidates",
      ]),
    );
    expect(plan.toolChoice).toBe("auto");
  });
});

function productionPlan(
  understanding: ReturnType<typeof compileTurnUnderstandingV2>,
) {
  return deriveChatTurnToolPlan({
    mode: "tool_loop",
    ledger: createRequiredActionLedger([]),
    runtimeSnapshot: unusedRuntimeSnapshot(),
    chatTurnPlan: {
      ...buildChatTurnPlan(""),
      toolCapabilities: deriveToolEligibilityV2(understanding),
    },
    batchOpportunityUsed: false,
    durableOnly: false,
    explicitlyDeniedToolNames: new Set(),
    topologyToolOrder: toolOrderFromTopology(understanding.requests),
  });
}

function unusedRuntimeSnapshot(): ChatToolRuntimeSnapshot {
  return {
    requested: 0,
    executed: 0,
    reused: 0,
    denied: 0,
    errors: 0,
    costSpent: 0,
    costBudget: 8,
    remainingCost: 8,
    requestLimit: 8,
    executionLimit: 8,
    perToolRequests: {},
    perToolExecutions: {},
  };
}

function dependentPersistenceRequests(): TurnRequest[] {
  return [
    persist("p0", "knowledge_handbook", []),
    persist("p1", "preference", ["p0"]),
  ];
}

function persist(
  id: string,
  collection: "knowledge_handbook" | "preference",
  dependsOn: readonly string[],
): TurnRequest {
  return {
    id,
    kind: "persist",
    collection,
    content: "记住这个",
    authorization: "ledger_granted",
    sourceClauseIds: ["c0"],
    dependsOn,
    evidence: [],
  };
}

function action(toolName: RequestedAction["toolName"], order: number): RequestedAction {
  return { toolName, order, decision: "granted", evidence: [] };
}
