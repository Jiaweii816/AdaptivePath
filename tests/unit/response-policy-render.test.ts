import { describe, expect, it } from "vitest";

import {
  INTENT_INSTRUCTIONS,
  PURE_DURABLE_INSTRUCTION,
  REQUIRED_ACTION_INSTRUCTION,
} from "@/server/agents/coach-agent/chat-policy-prompt";
import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import { renderResponsePlanInstructions } from "@/server/agents/coach-agent/response-policy/render-instructions";
import { buildResponsePlan } from "@/server/agents/coach-agent/response-policy/response-plan";
import type {
  Operation,
  TurnModifiers,
  TurnUnderstanding,
} from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";

const emptyInput = { messages: [], memory: {} } as unknown as CoachChatInput;
const directModifiers = {
  codeDisclosure: { level: "guided", source: "default" },
  affect: "none",
  deliveryMode: "direct",
  requestedArtifact: "explanation",
} satisfies TurnModifiers;

function operation(
  id: string,
  family: Operation["family"],
  target: Operation["target"],
  dependsOn: string[] = [],
  topic?: Operation["topic"],
): Operation {
  return {
    id,
    family,
    target,
    ...(topic ? { topic } : {}),
    sourceClauseId: "c0",
    dependsOn,
    evidence: [],
    resolution: "explicit",
  };
}

function understanding(
  operations: Operation[],
  modifiers: TurnModifiers = directModifiers,
): TurnUnderstanding {
  return {
    route: "fast_path",
    clauses: [{ id: "c0", text: "fixture" }],
    operations,
    modifiers,
    discourseMarkers: [],
    negationSignals: [],
    learnerStateSignals: [],
    unsupportedScope: {},
    ambiguity: { blocksSideEffect: false, unresolvedOperationIds: [] },
  };
}

function render(
  operations: Operation[],
  modifiers: TurnModifiers = directModifiers,
  input: CoachChatInput = emptyInput,
  pureDurable = false,
): string[] {
  const plan = buildResponsePlan(understanding(operations, modifiers), input, {
    pureDurable,
  });
  return renderResponsePlanInstructions(plan, input);
}

function tags(lines: string[]): string[] {
  return lines.flatMap((line) => line.match(/^\[[^\]]+\]/)?.[0] ?? []);
}

describe("response policy instruction renderer", () => {
  it("renders a single operation backbone without a compound block", () => {
    const lines = render([
      operation("op-debug", "diagnose", "current_user_code"),
    ]);
    expect(lines).toEqual(INTENT_INSTRUCTIONS.execute_failed_ask);
    expect(lines.join("\n")).not.toContain("[COMPOUND OBJECTIVES]");
  });
});

describe("response policy modifier-only rendering", () => {
  it("suppresses the generic follow-up for modifier-only turns", () => {
    const answer = [operation("op-answer", "answer", "active_problem")];
    const cases: Array<[TurnModifiers, string[]]> = [
      [{ ...directModifiers, deliveryMode: "hint" }, ["[HINT]"]],
      [{ ...directModifiers, affect: "anxious_stuck" }, ["[STUCK]"]],
      [{
        ...directModifiers,
        codeDisclosure: { level: "full_code", source: "explicit_allow" },
        requestedArtifact: "full_implementation",
      }, ["[FULL CODE]"]],
    ];

    for (const [modifiers, expectedTags] of cases) {
      const lines = render(answer, modifiers);
      expect(tags(lines)).toEqual(expectedTags);
      expect(lines.join("\n")).not.toContain("[FOLLOW-UP]");
    }
  });

  it("keeps answer backbones when an actual topic accompanies a hint", () => {
    const lines = render(
      [operation("op-concept", "answer", "concept", [], "concept")],
      { ...directModifiers, deliveryMode: "hint" },
    );
    expect(tags(lines)).toEqual(["[CONCEPT]", "[HINT]"]);
  });
});

describe("response policy composed modifier rendering", () => {
  it("combines diagnose, hint, and stuck instructions in stable order", () => {
    const lines = render(
      [operation("op-debug", "diagnose", "current_user_code")],
      {
        ...directModifiers,
        deliveryMode: "hint",
        affect: "anxious_stuck",
      },
    );
    expect(tags(lines)).toEqual(["[DEBUG]", "[HINT]", "[STUCK]"]);
  });

  it("gives full code precedence over a contradictory hint modifier", () => {
    const lines = render(
      [operation("op-answer", "answer", "active_problem")],
      {
        ...directModifiers,
        deliveryMode: "hint",
        codeDisclosure: { level: "full_code", source: "explicit_correction" },
        requestedArtifact: "full_implementation",
      },
    );
    expect(tags(lines)).toEqual(["[FULL CODE]"]);
    expect(lines.join("\n")).not.toContain("[HINT]");
  });

  it("does not emit full-code authority for an explicit guided denial", () => {
    const lines = render(
      [operation("op-answer", "answer", "active_problem")],
      {
        ...directModifiers,
        codeDisclosure: { level: "guided", source: "explicit_deny" },
      },
    );
    expect(lines.join("\n")).not.toContain("[FULL CODE]");
  });
});

describe("response policy compound rendering", () => {
  it("renders ordered compound objectives with dependency metadata", () => {
    const lines = render([
      operation("op-run", "execute", "current_user_code"),
      operation("op-debug", "diagnose", "current_user_code", ["op-run"]),
      operation("op-explain", "answer", "concept", ["op-debug"], "concept"),
    ]);
    const compoundIndex = lines.findIndex((line) =>
      line.startsWith("[COMPOUND OBJECTIVES]"),
    );
    expect(lines.join("\n")).toContain("[COMPOUND OBJECTIVES]");
    expect(lines.slice(-3)).toEqual([
      "  1. operationId=op-run; family=execute; target=current_user_code; dependsOn=none",
      "  2. operationId=op-debug; family=diagnose; target=current_user_code; dependsOn=op-run",
      "  3. operationId=op-explain; family=answer; target=concept; dependsOn=op-debug",
    ]);
    expect(compoundIndex).toBeLessThan(lines.length - 3);
  });
});

describe("response policy durable rendering", () => {
  it("returns only the exact pure durable instruction", () => {
    const pending = {
      ...emptyInput,
      requiredActions: [{ toolName: "note_memory", status: "pending" }],
    } as CoachChatInput;
    expect(render([
      operation("op-persist", "persist", "preference"),
    ], directModifiers, pending, true)).toEqual([PURE_DURABLE_INSTRUCTION]);
  });

  it("preserves mistake-book and required-action durable boundaries", () => {
    const pending = {
      ...emptyInput,
      requiredActions: [{ toolName: "save_mistake_book_entry", status: "pending" }],
    } as CoachChatInput;
    expect(render([
      operation("op-persist", "persist", "mistake_book"),
    ], directModifiers, pending)).toEqual([
      ...INTENT_INSTRUCTIONS.mistake_book_save_request,
      REQUIRED_ACTION_INSTRUCTION,
    ]);
  });

  it("does not grant durable authority to ambiguous preference or handbook persistence", () => {
    for (const target of ["preference", "knowledge_handbook"] as const) {
      expect(render([operation("op-persist", "persist", target)])).toEqual([]);
    }
  });

  it("uses only the generic required-action boundary for pending preferences", () => {
    const pending = {
      ...emptyInput,
      requiredActions: [{ toolName: "note_memory", status: "pending" }],
    } as CoachChatInput;
    const lines = render([
      operation("op-persist", "persist", "preference"),
    ], directModifiers, pending);
    expect(lines).toEqual([REQUIRED_ACTION_INSTRUCTION]);
    expect(lines.join("\n")).not.toContain("problem-specific guide");
  });
});
