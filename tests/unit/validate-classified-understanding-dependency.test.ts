import { describe, expect, it } from "vitest";

import type { ClassifierOutput } from "@/server/agents/coach-agent/turn-classifier/classifier-output.schema";
import {
  validateClassifiedUnderstanding,
  type BackendFacts,
} from "@/server/agents/coach-agent/turn-classifier/validate-classified-understanding";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";

const DIRECT_MODIFIERS = {
  deliveryMode: "direct",
  codeDisclosure: "guided",
  affect: "none",
} as const;

function output(
  operations: ClassifierOutput["operations"],
  modifiers: ClassifierOutput["modifiers"] = DIRECT_MODIFIERS,
): ClassifierOutput {
  return { operations, modifiers };
}

function operation(
  family: ClassifierOutput["operations"][number]["family"],
  target: ClassifierOutput["operations"][number]["target"],
  options: Partial<ClassifierOutput["operations"][number]> = {},
) {
  return { family, target, dependsOn: [], ...options };
}

function facts(overrides: Partial<BackendFacts> = {}): BackendFacts {
  return {
    workspaceLanguage: "Python",
    hasCurrentCode: true,
    hasAssistantCandidate: false,
    deniedExecutionTargets: [],
    grantedExecutionTargets: ["current_user_code"],
    grantedDurableTools: [],
    ...overrides,
  };
}

function validate(classified: ClassifierOutput, message: string) {
  return validateClassifiedUnderstanding(
    classified,
    facts(),
    parseTurnUnderstanding(message),
  );
}

function purePersistUnderstanding() {
  const seed = parseTurnUnderstanding("Remember: only give me hints");
  return {
    ...seed,
    operations: seed.operations.map((item) => ({
      ...item,
      family: "persist" as const,
      target: "preference" as const,
    })),
  };
}

describe("classifier dependency validation", () => {
  it.each([
    ["dangling_dependency", ["op9"]],
    ["self_dependency", ["op1"]],
    ["duplicate_dependency", ["op0", "op0"]],
  ] as const)("rejects %s", (reason, dependsOn) => {
    const result = validate(
      output([
        operation("execute", "current_user_code"),
        operation("diagnose", "current_user_code", {
          dependsOn: [...dependsOn],
        }),
      ]),
      "Run my code and explain why",
    );
    expect(result).toEqual({ ok: false, reason });
  });

  it("rejects a forward dependency and a dependency without then", () => {
    const forward = validate(
      output([
        operation("execute", "current_user_code", { dependsOn: ["op1"] }),
        operation("diagnose", "current_user_code"),
      ]),
      "Run my code and explain why",
    );
    expect(forward).toEqual({ ok: false, reason: "forward_dependency" });

    const unordered = validate(
      output([
        operation("execute", "current_user_code"),
        operation("diagnose", "current_user_code", { dependsOn: ["op0"] }),
      ]),
      "Run my code and explain why",
    );
    expect(unordered).toEqual({
      ok: false,
      reason: "dependency_without_then_clause",
    });
  });
});

describe("valid classifier dependencies", () => {
  it("accepts a backward dependency on a deterministic then clause", () => {
    const result = validate(
      output([
        operation("execute", "current_user_code"),
        operation("diagnose", "current_user_code", { dependsOn: ["op0"] }),
      ]),
      "Run my code, then explain why",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations[1]).toMatchObject({
      sourceClauseId: "c1",
      dependsOn: ["op0"],
    });
  });
});

describe("canonical classifier projection", () => {
  it("rejects duplicate family-target operations", () => {
    const result = validate(
      output([
        operation("answer", "concept", { topic: "concept" }),
        operation("answer", "concept", { topic: "concept" }),
      ]),
      "Explain this concept",
    );
    expect(result).toEqual({ ok: false, reason: "duplicate_operation" });
  });
});

describe("classifier modifier and ambiguity projection", () => {
  it("keeps backend response controls while adopting classifier affect", () => {
    const deterministic = parseTurnUnderstanding(
      "Give me two hints, but do not give full code",
    );
    const result = validateClassifiedUnderstanding(
      output([operation("answer", "active_problem")], {
        deliveryMode: "direct",
        codeDisclosure: "full_code",
        affect: "anxious_stuck",
        requestedCount: 99,
      }),
      facts(),
      deterministic,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.modifiers).toEqual({
      ...deterministic.modifiers,
      affect: "anxious_stuck",
    });
  });

  it("recomputes ambiguity using canonical new operation ids", () => {
    const result = validate(
      output([operation("answer", "contextual_referent")]),
      "Explain that again",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations[0]).toMatchObject({
      id: "op0",
      resolution: "ambiguous",
    });
    expect(result.understanding.ambiguity).toEqual({
      blocksSideEffect: false,
      unresolvedOperationIds: ["op0"],
    });
  });
});

describe("classifier durable-only delivery normalization", () => {
  it("forces direct delivery for a pure preference persistence", () => {
    const result = validateClassifiedUnderstanding(
      output([operation("persist", "preference")], {
        ...DIRECT_MODIFIERS,
        deliveryMode: "hint",
      }),
      facts({ grantedDurableTools: ["note_memory"] }),
      purePersistUnderstanding(),
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "direct",
    );
  });

  it("keeps backend hint delivery for lookup-only output", () => {
    const deterministic = parseTurnUnderstanding("Give me a hint for deque syntax");
    const result = validateClassifiedUnderstanding(
      output([operation("lookup_api", "api_object", { topic: "api" })], {
        ...DIRECT_MODIFIERS,
        deliveryMode: "hint",
      }),
      facts(),
      deterministic,
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "hint",
    );
  });

  it("keeps direct when the classifier injects an answer into pure persist", () => {
    const result = validateClassifiedUnderstanding(
      output([
        operation("persist", "preference"),
        operation("answer", "concept"),
      ]),
      facts({ grantedDurableTools: ["note_memory"] }),
      purePersistUnderstanding(),
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "direct",
    );
  });
});

describe("classifier hint response authority", () => {
  it("keeps backend hint delivery for an answer operation", () => {
    const deterministic = parseTurnUnderstanding("Give me a hint");
    const result = validateClassifiedUnderstanding(
      output([operation("answer", "active_problem")]),
      facts(),
      deterministic,
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "hint",
    );
  });

  it.each(["current_approach", "concept"] as const)(
    "rejects classifier hint target %s when backend resolved active_problem",
    (target) => {
      const deterministic = parseTurnUnderstanding("Give me a hint");
      expect(
        validateClassifiedUnderstanding(
          output([operation("answer", target)]),
          facts(),
          deterministic,
        ),
      ).toEqual({ ok: false, reason: "hint_target_mismatch" });
    },
  );

  it("does not let the LLM promote direct delivery to hint", () => {
    const deterministic = parseTurnUnderstanding("Explain this concept");
    const result = validateClassifiedUnderstanding(
      output([operation("answer", "concept", { topic: "concept" })], {
        ...DIRECT_MODIFIERS,
        deliveryMode: "hint",
      }),
      facts(),
      deterministic,
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "direct",
    );
  });
});

describe("classifier active hint compound authority", () => {
  it("rejects an extra answer target even when active_problem is present", () => {
    const result = validateClassifiedUnderstanding(
      output([
        operation("answer", "active_problem"),
        operation("answer", "concept"),
      ]),
      facts(),
      parseTurnUnderstanding("Give me a hint"),
    );
    expect(result).toEqual({ ok: false, reason: "hint_target_mismatch" });
  });

  it("allows active_problem together with a different response family", () => {
    const result = validateClassifiedUnderstanding(
      output([
        operation("answer", "active_problem"),
        operation("diagnose", "current_user_code"),
      ]),
      facts(),
      parseTurnUnderstanding("Give me a hint"),
    );
    expect(result.ok && result.understanding.modifiers.deliveryMode).toBe(
      "hint",
    );
  });
});
