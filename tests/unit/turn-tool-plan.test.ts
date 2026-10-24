import { describe, expect, it } from "vitest";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { createRequiredActionLedger } from "@/server/tools/chat-tools/required-action-ledger";
import {
  deriveTurnToolPlan,
  selectToolLoopChoice,
  type ToolPlanningMetadata,
} from "@/server/tools/chat-tools/turn-tool-plan";

const toolMetadata = {
  lookup_api_reference: { costUnits: 1 },
  past_problem_recall: { costUnits: 1 },
  past_mistake_recall: { costUnits: 1 },
  run_current_code: { costUnits: 3 },
  verify_proposed_repair: { costUnits: 3 },
  note_memory: { costUnits: 2 },
  save_knowledge_note: { costUnits: 2 },
  save_mistake_book_entry: { costUnits: 2 },
} as const satisfies Partial<Record<ChatToolName, ToolPlanningMetadata>>;

describe("turn tool plan", () => {
  it("keeps model-plannable durable tools visible without a lexical grant", () => {
    const modelPlannableMetadata = {
      lookup_api_reference: { costUnits: 1 },
      save_knowledge_note: { costUnits: 2 },
    } as const satisfies Partial<
      Record<ChatToolName, ToolPlanningMetadata>
    >;
    const plan = deriveTurnToolPlan({
      mode: "tool_loop",
      ledger: createRequiredActionLedger([]),
      limits: { cost: 8, executions: 8, requests: 8 },
      usage: { cost: 0, executions: 0, requests: 0 },
      toolMetadata: modelPlannableMetadata,
      allowedToolNames: new Set(
        Object.keys(modelPlannableMetadata) as ChatToolName[],
      ),
      batchOpportunityUsed: false,
    });

    expect(plan.availableToolNames).toEqual(
      new Set(["lookup_api_reference", "save_knowledge_note"]),
    );
    expect(plan.manifest.map((tool) => tool.function.name)).toContain(
      "save_knowledge_note",
    );
  });

  it("admits required actions in user order and marks overflow unfulfilled", () => {
    const ledger = createRequiredActionLedger([
      seed("save_mistake_book_entry", 1),
      seed("save_knowledge_note", 2),
      seed("note_memory", 3),
    ]);

    const plan = deriveTurnToolPlan({
      mode: "tool_loop",
      ledger,
      limits: { cost: 4, executions: 2, requests: 4 },
      usage: { cost: 0, executions: 0, requests: 0 },
      toolMetadata,
      allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
      batchOpportunityUsed: false,
    });

    expect(plan.requiredActions).toEqual([
      expect.objectContaining({
        toolName: "save_mistake_book_entry",
        status: "pending",
        admitted: true,
      }),
      expect.objectContaining({
        toolName: "save_knowledge_note",
        status: "pending",
        admitted: true,
      }),
      expect.objectContaining({
        toolName: "note_memory",
        status: "unfulfilled",
        admitted: false,
        terminalReason: "capacity_cost",
      }),
    ]);
    expect(plan.reserved).toEqual({ cost: 4, executions: 2, requests: 4 });
  });

  it("keeps required tools available while blocking discretionary calls that consume reserve", () => {
    const ledger = createRequiredActionLedger([
      seed("save_mistake_book_entry", 1),
      seed("save_knowledge_note", 2),
    ]);
    const plan = deriveTurnToolPlan({
      mode: "tool_loop",
      ledger,
      limits: { cost: 8, executions: 8, requests: 8 },
      usage: { cost: 3, executions: 1, requests: 1 },
      toolMetadata,
      allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
      batchOpportunityUsed: true,
    });

    expect(plan.reserved).toEqual({ cost: 4, executions: 2, requests: 4 });
    expect(plan.availableToolNames.has("save_mistake_book_entry")).toBe(true);
    expect(plan.availableToolNames.has("save_knowledge_note")).toBe(true);
    expect(plan.availableToolNames.has("lookup_api_reference")).toBe(true);
    expect(plan.availableToolNames.has("verify_proposed_repair")).toBe(false);
    expect(plan.availableToolNames.has("note_memory")).toBe(false);
  });

  it("releases one reserved request after the first invalid argument attempt", async () => {
    const { recordInvalidArguments } =
      await import("@/server/tools/chat-tools/required-action-ledger");
    const firstFailure = recordInvalidArguments(
      createRequiredActionLedger([seed("save_knowledge_note", 1)]),
      "save_knowledge_note",
    );
    const plan = deriveTurnToolPlan({
      mode: "tool_loop",
      ledger: firstFailure.ledger,
      limits: { cost: 8, executions: 8, requests: 8 },
      usage: { cost: 0, executions: 0, requests: 1 },
      toolMetadata,
      allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
      batchOpportunityUsed: true,
    });

    expect(plan.reserved.requests).toBe(1);
  });

  it("uses batch auto first and forced recovery only after the batch opportunity", () => {
    const ledger = createRequiredActionLedger([
      seed("save_mistake_book_entry", 1),
      seed("save_knowledge_note", 2),
    ]);
    const available = new Set<ChatToolName>([
      "save_mistake_book_entry",
      "save_knowledge_note",
    ]);

    expect(
      selectToolLoopChoice({
        requiredActions: ledger.actions.map((action) => ({
          ...action,
          admitted: true,
        })),
        availableToolNames: available,
        batchOpportunityUsed: false,
      }),
    ).toBe("auto");
    expect(
      selectToolLoopChoice({
        requiredActions: ledger.actions.map((action) => ({
          ...action,
          admitted: true,
        })),
        availableToolNames: available,
        batchOpportunityUsed: true,
      }),
    ).toBe("save_mistake_book_entry");
  });

  it("does not bypass an unavailable hard prerequisite to start durable writes", () => {
    const ledger = createRequiredActionLedger([seed("save_knowledge_note", 1)]);

    expect(
      selectToolLoopChoice({
        requiredActions: ledger.actions.map((action) => ({
          ...action,
          admitted: true,
        })),
        availableToolNames: new Set(["save_knowledge_note"]),
        batchOpportunityUsed: false,
        prerequisiteToolName: "lookup_api_reference",
      }),
    ).toBeUndefined();
  });

  it.each([
    {
      label: "execution",
      limits: { cost: 8, executions: 1, requests: 8 },
      reason: "capacity_execution",
    },
    {
      label: "request",
      limits: { cost: 8, executions: 8, requests: 2 },
      reason: "capacity_request",
    },
  ] as const)(
    "reports $label admission overflow instead of silently dropping an obligation",
    ({ limits, reason }) => {
      const plan = deriveTurnToolPlan({
        mode: "tool_loop",
        ledger: createRequiredActionLedger([
          seed("save_mistake_book_entry", 1),
          seed("save_knowledge_note", 2),
        ]),
        limits,
        usage: { cost: 0, executions: 0, requests: 0 },
        toolMetadata,
        allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
        batchOpportunityUsed: false,
      });

      expect(plan.requiredActions[0]).toMatchObject({
        status: "pending",
        admitted: true,
      });
      expect(plan.requiredActions[1]).toMatchObject({
        status: "unfulfilled",
        terminalReason: reason,
      });
    },
  );

  it("preserves reserve under a fixed-seed sequence of discretionary calls", () => {
    let seedValue = 0x5eed1234;
    let usage = { cost: 0, executions: 0, requests: 0 };
    let ledger = createRequiredActionLedger([
      seed("save_mistake_book_entry", 1),
      seed("save_knowledge_note", 2),
    ]);
    const discretionary = [
      "lookup_api_reference",
      "past_problem_recall",
      "past_mistake_recall",
      "run_current_code",
      "verify_proposed_repair",
    ] as const;

    for (let index = 0; index < 24; index += 1) {
      seedValue = (Math.imul(seedValue, 1664525) + 1013904223) >>> 0;
      const candidate = discretionary[seedValue % discretionary.length];
      const plan = deriveTurnToolPlan({
        mode: "tool_loop",
        ledger,
        limits: { cost: 8, executions: 8, requests: 8 },
        usage,
        toolMetadata,
        allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
        batchOpportunityUsed: true,
      });
      ledger = { actions: plan.requiredActions };

      if (!plan.availableToolNames.has(candidate)) {
        continue;
      }
      const cost = toolMetadata[candidate].costUnits;
      usage = {
        cost: usage.cost + cost,
        executions: usage.executions + 1,
        requests: usage.requests + 1,
      };

      expect(usage.cost + plan.reserved.cost).toBeLessThanOrEqual(8);
      expect(usage.executions + plan.reserved.executions).toBeLessThanOrEqual(
        8,
      );
      expect(usage.requests + plan.reserved.requests).toBeLessThanOrEqual(8);
    }
  });

  it("returns no tools in no-tools modes", () => {
    const plan = deriveTurnToolPlan({
      mode: "finalize_without_tools",
      ledger: createRequiredActionLedger([]),
      limits: { cost: 8, executions: 8, requests: 8 },
      usage: { cost: 0, executions: 0, requests: 0 },
      toolMetadata,
      allowedToolNames: new Set(Object.keys(toolMetadata) as ChatToolName[]),
      batchOpportunityUsed: true,
    });

    expect([...plan.availableToolNames]).toEqual([]);
    expect(plan.toolChoice).toBeUndefined();
  });
});

function seed(
  toolName: "note_memory" | "save_knowledge_note" | "save_mistake_book_entry",
  order: number,
) {
  return { toolName, order, evidence: [] } as const;
}
