import { describe, expect, it } from "vitest";

import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
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
    grantedExecutionTargets: ["current_user_code", "assistant_candidate"],
    grantedDurableTools: [],
    ...overrides,
  };
}

function validate(
  classified: ClassifierOutput,
  backendFacts: BackendFacts = facts(),
  message = "Run my code and explain why",
) {
  return validateClassifiedUnderstanding(
    classified,
    backendFacts,
    parseTurnUnderstanding(message),
  );
}

describe("authoritative classified-understanding validator", () => {
  it("marks a valid execute explicit so the P3 compiler opens the runner", () => {
    const result = validate(
      output([
        operation("execute", "current_user_code"),
        operation("diagnose", "current_user_code"),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations[0]).toMatchObject({
      id: "op0",
      family: "execute",
      target: "current_user_code",
      resolution: "explicit",
    });
    expect(deriveToolEligibility(result.understanding)).toContain(
      "run_current_code",
    );
    expect(
      result.understanding.operations.every(
        ({ evidence }) =>
          evidence.length > 0 &&
          evidence.every((item) => item.span.length > 0),
      ),
    ).toBe(true);
  });
});

describe("classifier target existence and execution authority", () => {
  it.each([
    ["missing_current_code", facts({ hasCurrentCode: false }), "current_user_code"],
    ["missing_assistant_candidate", facts(), "assistant_candidate"],
  ] as const)("rejects %s", (reason, backendFacts, target) => {
    expect(validate(output([operation("execute", target)]), backendFacts)).toEqual({
      ok: false,
      reason,
    });
  });

  it.each([undefined, "C++"] as const)(
    "rejects execute when workspace language is %s",
    (workspaceLanguage) => {
      expect(
        validate(
          output([operation("execute", "current_user_code")]),
          facts({ workspaceLanguage }),
        ),
      ).toEqual({ ok: false, reason: "unsupported_execution_language" });
    },
  );

  it.each([
    ["diagnose", "current_user_code"],
    ["diagnose", "assistant_candidate"],
    ["optimize", "current_user_code"],
    ["optimize", "assistant_candidate"],
  ] as const)("rejects non-Python code-scoped %s", (family, target) => {
    expect(
      validate(
        output([operation(family, target)]),
        facts({ workspaceLanguage: "C++", hasAssistantCandidate: true }),
      ),
    ).toEqual({ ok: false, reason: "unsupported_execution_language" });
  });

  it("allows a non-Python approach-only operation", () => {
    expect(
      validate(
        output([operation("optimize", "current_approach")]),
        facts({ workspaceLanguage: "C++" }),
      ).ok,
    ).toBe(true);
  });
});

describe("classifier family, target, and topic taxonomy", () => {
  it.each(["current_user_code", "assistant_candidate"] as const)(
    "rejects a denied %s execution without blocking the other target",
    (target) => {
      const backendFacts = facts({
        hasAssistantCandidate: true,
        deniedExecutionTargets: [target],
      });
      expect(validate(output([operation("execute", target)]), backendFacts)).toEqual({
        ok: false,
        reason: "execute_denied_by_user",
      });
      const other =
        target === "current_user_code" ? "assistant_candidate" : "current_user_code";
      expect(validate(output([operation("execute", other)]), backendFacts).ok).toBe(
        true,
      );
    },
  );

  it.each([
    ["answer", "past_problem"],
    ["lookup_api", "concept"],
    ["diagnose", "practice_problem"],
    ["execute", "active_problem"],
    ["optimize", "mistake_book"],
    ["recall", "learner_profile"],
    ["profile_meta", "past_mistake"],
    ["recommend", "api_object"],
    ["persist", "current_user_code"],
  ] as const)("rejects invalid family-target pair %s:%s", (family, target) => {
    expect(validate(output([operation(family, target)]))).toEqual({
      ok: false,
      reason: "invalid_family_target",
    });
  });
});

describe("classifier topic validation", () => {
  it.each([
    operation("answer", "concept", { topic: "concept" }),
    operation("lookup_api", "api_object", { topic: "api" }),
    operation("diagnose", "current_user_code"),
    operation("execute", "current_user_code"),
    operation("optimize", "current_approach"),
    operation("recall", "past_problem"),
    operation("profile_meta", "learner_profile"),
    operation("recommend", "practice_problem"),
  ])("accepts a valid family-target-topic assignment", (classifiedOperation) => {
    expect(validate(output([classifiedOperation])).ok).toBe(true);
  });

  it.each([
    operation("diagnose", "current_user_code", { topic: "concept" }),
    operation("answer", "concept", { topic: "api" }),
    operation("lookup_api", "api_object", { topic: "general" }),
  ])("rejects an invalid topic assignment", (classifiedOperation) => {
    expect(validate(output([classifiedOperation]))).toEqual({
      ok: false,
      reason: "invalid_operation_topic",
    });
  });
});

describe("classifier durable authority", () => {
  it.each([
    ["preference", "note_memory"],
    ["knowledge_handbook", "save_knowledge_note"],
    ["mistake_book", "save_mistake_book_entry"],
  ] as const)("accepts an exactly granted persist target %s", (target, tool) => {
    const result = validate(
      output([operation("persist", target)]),
      facts({ grantedDurableTools: [tool] }),
      "Please save this",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations[0]?.resolution).toBe("explicit");
    expect(deriveToolEligibility(result.understanding)).toEqual([]);
  });

  it("rejects ungranted, mismatched, and omitted granted persistence", () => {
    expect(validate(output([operation("persist", "preference")]))).toEqual({
      ok: false,
      reason: "persist_not_authorized_by_ledger",
    });
    expect(
      validate(
        output([operation("persist", "preference")]),
        facts({ grantedDurableTools: ["save_knowledge_note"] }),
      ),
    ).toEqual({ ok: false, reason: "persist_not_authorized_by_ledger" });
    expect(
      validate(output([]), facts({ grantedDurableTools: ["note_memory"] })),
    ).toEqual({ ok: false, reason: "granted_persist_missing_from_output" });
  });
});

describe("empty classified operation set", () => {
  it("allows an empty operation set when no durable grant exists", () => {
    const deterministic = parseTurnUnderstanding("Write this in Java");
    const result = validateClassifiedUnderstanding(
      output([]),
      facts(),
      deterministic,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations).toEqual([]);
    expect(result.understanding.ambiguity).toEqual({
      blocksSideEffect: false,
      unresolvedOperationIds: [],
    });
    expect(result.understanding.route).toBe(deterministic.route);
    expect(result.understanding.unsupportedScope).toEqual(
      deterministic.unsupportedScope,
    );
    expect(result.understanding.legacyPrimaryIntent).toBe(
      deterministic.legacyPrimaryIntent,
    );
  });
});
