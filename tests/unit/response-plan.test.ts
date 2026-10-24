import { describe, expect, it } from "vitest";

import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import { buildResponsePlan } from "@/server/agents/coach-agent/response-policy/response-plan";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import type {
  Operation,
  TurnUnderstanding,
} from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";

const emptyInput = { messages: [], memory: {} } as unknown as CoachChatInput;

function understandingWith(operations: Operation[]): TurnUnderstanding {
  return {
    route: "fast_path",
    clauses: [{ id: "c0", text: "fixture" }],
    operations,
    modifiers: {
      codeDisclosure: { level: "guided", source: "default" },
      affect: "none",
      deliveryMode: "direct",
      requestedArtifact: "explanation",
    },
    discourseMarkers: [],
    negationSignals: [],
    learnerStateSignals: [],
    unsupportedScope: {},
    ambiguity: { blocksSideEffect: false, unresolvedOperationIds: [] },
  };
}

function operation(
  id: string,
  family: Operation["family"],
  target: Operation["target"],
  orderHint?: number,
): Operation {
  return {
    id,
    family,
    target,
    sourceClauseId: "c0",
    orderHint,
    dependsOn: [],
    evidence: [],
    resolution: "explicit",
  };
}

describe("response plan primary operation", () => {
  it("uses a single diagnosis operation as the backbone", () => {
    const plan = buildResponsePlan(
      parseTurnUnderstanding("为什么当前代码没过？帮我诊断"),
      emptyInput,
    );
    expect(plan.backbone).toMatchObject({
      family: "diagnose",
      target: "current_user_code",
    });
    expect(plan.compound).toBe(false);
    expect(plan.objectives).toHaveLength(1);
  });

  it("uses a safe contextual answer when operations are empty", () => {
    const plan = buildResponsePlan(understandingWith([]), emptyInput);
    expect(plan.backbone).toEqual({
      family: "answer",
      target: "contextual_referent",
    });
    expect(plan.objectives).toEqual([{
      operationId: "op0",
      family: "answer",
      target: "contextual_referent",
      dependsOn: [],
    }]);
    expect(plan.compound).toBe(false);
  });
});

describe("response plan objective ordering", () => {
  it("keeps every known P1 compound operation", () => {
    const plan = buildResponsePlan(
      parseTurnUnderstanding(
        "我以前做过哪些类似滑窗题、又常犯过什么错？再确认下 abba 当前输出。",
      ),
      emptyInput,
    );
    expect(plan.objectives.map(({ family, target }) => ({ family, target }))).toEqual([
      { family: "recall", target: "past_problem" },
      { family: "recall", target: "past_mistake" },
    ]);
    expect(plan.compound).toBe(true);
  });

  it("preserves array order instead of sorting heterogeneous order hints", () => {
    const first = operation("op-first", "execute", "current_user_code", 99);
    first.dependsOn = ["setup"];
    const second = operation("op-second", "diagnose", "current_user_code", 1);
    const plan = buildResponsePlan(understandingWith([first, second]), emptyInput);
    expect(plan.backbone.family).toBe("execute");
    expect(plan.objectives.map(({ operationId, dependsOn }) => ({
      operationId,
      dependsOn,
    }))).toEqual([
      { operationId: "op-first", dependsOn: ["setup"] },
      { operationId: "op-second", dependsOn: [] },
    ]);
  });
});

describe("response plan durable metadata", () => {
  it("accepts pure-durable only from the legacy seam", () => {
    const persist = understandingWith([
      operation("op-save", "persist", "mistake_book"),
    ]);
    const input = {
      ...emptyInput,
      requiredActions: [{ toolName: "save_mistake_book_entry", status: "pending" }],
    } as CoachChatInput;
    expect(buildResponsePlan(persist, input).pureDurable).toBe(false);
    expect(buildResponsePlan(persist, input, { pureDurable: true }).pureDurable).toBe(true);
  });

  it("reports whether any required action is pending", () => {
    const understanding = understandingWith([
      operation("op-answer", "answer", "contextual_referent"),
    ]);
    const input = {
      ...emptyInput,
      requiredActions: [
        { toolName: "note_memory", status: "completed" },
        { toolName: "save_knowledge_note", status: "pending" },
      ],
    } as CoachChatInput;
    expect(buildResponsePlan(understanding, input).hasPendingRequiredAction).toBe(true);
    expect(buildResponsePlan(understanding, {
      ...input,
      requiredActions: [{ toolName: "note_memory", status: "completed" }],
    }).hasPendingRequiredAction).toBe(false);
  });
});
