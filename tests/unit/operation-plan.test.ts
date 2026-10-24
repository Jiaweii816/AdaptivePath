import { describe, expect, it } from "vitest";

import { buildContextPlan } from "@/server/agents/coach-agent/operation-plan/operation-context-plan";
import { deriveMemoryIntent } from "@/server/agents/coach-agent/operation-plan/operation-memory-intent";
import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import type { ChatTurnContextNeeds } from "@/server/agents/coach-agent/coach-agent.types";
import type {
  Operation,
  OperationFamily,
  OperationTarget,
  TurnUnderstanding,
} from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";
const DIAGNOSTIC_CONTEXT: ChatTurnContextNeeds = {
  workspace: true,
  currentCode: true,
  selectedTests: true,
  runEvidence: true,
  reviewContext: true,
  learnerSignals: true,
  handbook: false,
  episodes: false,
};
const EXECUTION_CONTEXT: ChatTurnContextNeeds = {
  ...DIAGNOSTIC_CONTEXT,
  learnerSignals: false,
};
const GUIDED_CONTEXT: ChatTurnContextNeeds = {
  workspace: true,
  currentCode: true,
  selectedTests: false,
  runEvidence: false,
  reviewContext: true,
  learnerSignals: true,
  handbook: false,
  episodes: false,
};
const NO_CONTEXT: ChatTurnContextNeeds = {
  workspace: false,
  currentCode: false,
  selectedTests: false,
  runEvidence: false,
  reviewContext: false,
  learnerSignals: false,
  handbook: false,
  episodes: false,
};
const LEARNER_ONLY_CONTEXT: ChatTurnContextNeeds = {
  ...NO_CONTEXT,
  learnerSignals: true,
};
const MISTAKE_BOOK_CONTEXT: ChatTurnContextNeeds = {
  ...NO_CONTEXT,
  workspace: true,
  currentCode: true,
};

function understandingWith(
  family: OperationFamily,
  target: OperationTarget,
): TurnUnderstanding {
  const seed = parseTurnUnderstanding("explain this");
  return {
    ...seed,
    operations: [{ ...seed.operations[0], family, target }],
  };
}

function operation(
  family: OperationFamily,
  target: OperationTarget,
  resolution: Operation["resolution"] = "explicit",
): Operation {
  return {
    id: `op-${family}-${target}`,
    family,
    target,
    sourceClauseId: "c0",
    dependsOn: [],
    evidence: [],
    resolution,
  };
}

function understandingWithOperations(
  operations: Operation[],
): TurnUnderstanding {
  return { ...parseTurnUnderstanding("explain this"), operations };
}
describe("operation context plan for active work", () => {
  it.each([
    ["为什么当前代码没过？帮我诊断", DIAGNOSTIC_CONTEXT],
    ["Run my current code", EXECUTION_CONTEXT],
    ["为什么这里要维护单调性？", GUIDED_CONTEXT],
    ["Can you optimize my current code?", GUIDED_CONTEXT],
  ])("derives active-work context for %s", (message, expected) => {
    expect(buildContextPlan(parseTurnUnderstanding(message))).toEqual(expected);
  });
  it.each([
    [
      [
        operation("answer", "concept"),
        operation("execute", "current_user_code"),
      ],
      DIAGNOSTIC_CONTEXT,
    ],
    [
      [
        operation("diagnose", "current_user_code"),
        operation("execute", "current_user_code"),
      ],
      DIAGNOSTIC_CONTEXT,
    ],
    [
      [operation("recall", "past_problem"), operation("answer", "concept")],
      GUIDED_CONTEXT,
    ],
    [
      [operation("answer", "concept"), operation("persist", "mistake_book")],
      GUIDED_CONTEXT,
    ],
    [
      [
        operation("diagnose", "current_user_code"),
        operation("persist", "mistake_book"),
      ],
      DIAGNOSTIC_CONTEXT,
    ],
    [
      [
        operation("execute", "current_user_code"),
        operation("recall", "past_problem"),
      ],
      EXECUTION_CONTEXT,
    ],
    [
      [
        operation("lookup_api", "api_object"),
        operation("recall", "past_problem"),
      ],
      { ...NO_CONTEXT, handbook: true },
    ],
  ])("ORs context fields across compound operations", (ops, expected) => {
    expect(buildContextPlan(understandingWithOperations(ops))).toEqual(
      expected,
    );
  });
});

describe("operation context plan for isolated operations", () => {
  it.each([
    ["Python 队列怎么写？", { ...NO_CONTEXT, handbook: true }],
    ["What past mistakes have I made?", NO_CONTEXT],
    ["What do you know about me?", LEARNER_ONLY_CONTEXT],
    ["Recommend another practice problem", LEARNER_ONLY_CONTEXT],
  ])("isolates context for %s", (message, expected) => {
    expect(buildContextPlan(parseTurnUnderstanding(message))).toEqual(expected);
  });
});

describe("operation context plan safety boundaries", () => {
  it.each([
    ["mistake_book", MISTAKE_BOOK_CONTEXT],
    ["preference", LEARNER_ONLY_CONTEXT],
    ["knowledge_handbook", LEARNER_ONLY_CONTEXT],
  ] as const)("scopes persist target %s", (target, expected) => {
    const understanding = understandingWith("persist", target);
    expect(buildContextPlan(understanding)).toEqual(expected);
  });

  it("keeps an empty operation set at the generic personalization boundary", () => {
    const understanding = {
      ...parseTurnUnderstanding("explain this"),
      operations: [],
    };
    expect(buildContextPlan(understanding)).toEqual(LEARNER_ONLY_CONTEXT);
  });
});

describe("operation tool eligibility side-effect boundary", () => {
  it("injects learning-experience recall for every legacy intent in Pilot mode", () => {
    const previous = process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "1";
    try {
      expect(
        deriveToolEligibility(
          parseTurnUnderstanding(
            "你可以结合我过去的学习经历，给我进一步指导吗？",
          ),
        ),
      ).toContain("recall_learning_experience");
    } finally {
      if (previous === undefined) {
        delete process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;
      } else {
        process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = previous;
      }
    }
  });

  it("opens only explicit execution with the matching target", () => {
    expect(
      deriveToolEligibility(parseTurnUnderstanding("Run my current code")),
    ).toEqual(["run_current_code"]);
    expect(
      deriveToolEligibility(
        parseTurnUnderstanding("Verify your candidate code"),
      ),
    ).toEqual(["verify_proposed_repair"]);
    expect(
      deriveToolEligibility(
        understandingWithOperations([
          operation("execute", "current_user_code", "ambiguous"),
          operation("execute", "assistant_candidate", "contextual"),
          operation("execute", "current_approach"),
        ]),
      ),
    ).toEqual([]);
  });

  it("never turns persist operations into durable capabilities", () => {
    const persistTargets = [
      "preference",
      "knowledge_handbook",
      "mistake_book",
    ] as const;
    const understanding = understandingWithOperations(
      persistTargets.map((target) => operation("persist", target)),
    );

    expect(deriveToolEligibility(understanding)).toEqual([]);
  });

  it("does not broaden read families beyond their supported targets", () => {
    const understanding = understandingWithOperations([
      operation("lookup_api", "current_user_code"),
      operation("recall", "contextual_referent"),
      operation("recommend", "active_problem"),
    ]);

    expect(deriveToolEligibility(understanding)).toEqual([]);
  });
});

describe("operation tool eligibility read mappings", () => {
  it("maps lookup, recall, and recommendation targets without a legacy union", () => {
    const understanding = understandingWithOperations([
      operation("lookup_api", "api_object"),
      operation("recall", "past_problem"),
      operation("recall", "past_mistake"),
      operation("recommend", "practice_problem"),
    ]);

    expect(deriveToolEligibility(understanding)).toEqual([
      "lookup_api_reference",
      "past_problem_recall",
      "past_mistake_recall",
      "find_practice_problem",
      "search_interview_variant_candidates",
    ]);
  });
});

describe("operation tool eligibility hint overlay", () => {
  it("does not apply the algorithm-hint overlay to a read-only operation", () => {
    const seed = understandingWithOperations([
      operation("lookup_api", "api_object"),
      operation("lookup_api", "knowledge_handbook"),
    ]);
    const understanding = {
      ...seed,
      modifiers: { ...seed.modifiers, deliveryMode: "hint" as const },
    };

    expect(deriveToolEligibility(understanding)).toEqual([
      "lookup_api_reference",
    ]);
  });

  it("does not open the algorithm-hint tool for a pure preference write", () => {
    const seed = understandingWithOperations([
      operation("persist", "preference"),
    ]);
    const understanding = {
      ...seed,
      modifiers: { ...seed.modifiers, deliveryMode: "hint" as const },
    };

    expect(deriveToolEligibility(understanding)).toEqual([]);
  });

  it.each([
    ["answer", "concept"],
    ["diagnose", "current_user_code"],
    ["optimize", "current_user_code"],
  ] as const)("keeps the hint tool for %s responses", (family, target) => {
    const seed = understandingWithOperations([operation(family, target)]);
    const understanding = {
      ...seed,
      modifiers: { ...seed.modifiers, deliveryMode: "hint" as const },
    };

    expect(deriveToolEligibility(understanding)).toEqual([
      "get_algorithm_hint",
    ]);
  });
});

describe("operation memory intent family mapping", () => {
  it.each([
    ["answer", "concept", "concept_question"],
    ["lookup_api", "api_object", "api_reference_question"],
    ["diagnose", "current_user_code", "execute_failed_ask"],
    ["execute", "current_user_code", "run_case_request"],
    ["optimize", "current_user_code", "optimization_request"],
    ["recall", "past_problem", "past_problem_recall_request"],
    ["recall", "past_mistake", "past_mistake_recall_request"],
    ["profile_meta", "learner_profile", "profile_meta_question"],
    ["recommend", "practice_problem", "practice_request"],
    ["persist", "mistake_book", "general_followup"],
  ] as const)("maps %s:%s to %s", (family, target, expected) => {
    expect(
      deriveMemoryIntent(
        understandingWithOperations([operation(family, target)]),
      ),
    ).toBe(expected);
  });
  it("recognizes the supported English profile fixture", () => {
    expect(
      deriveMemoryIntent(parseTurnUnderstanding("What do you know about me?")),
    ).toBe("profile_meta_question");
  });
});
describe("operation memory intent modifier and fallback mapping", () => {
  it("uses response modifiers after business-operation profiles", () => {
    const seed = understandingWithOperations([
      operation("answer", "active_problem"),
    ]);
    expect(
      deriveMemoryIntent({
        ...seed,
        modifiers: { ...seed.modifiers, affect: "anxious_stuck" },
      }),
    ).toBe("anxiety_or_stuck");
    expect(
      deriveMemoryIntent({
        ...seed,
        modifiers: { ...seed.modifiers, deliveryMode: "hint" },
      }),
    ).toBe("hint_request");
    expect(
      deriveMemoryIntent({
        ...seed,
        modifiers: {
          ...seed.modifiers,
          codeDisclosure: { level: "full_code", source: "explicit_allow" },
        },
      }),
    ).toBe("full_code_request");
  });
  it("maps contextual answers and empty operations to general follow-up", () => {
    expect(
      deriveMemoryIntent(
        understandingWithOperations([
          operation("answer", "contextual_referent"),
        ]),
      ),
    ).toBe("general_followup");
    expect(deriveMemoryIntent(understandingWithOperations([]))).toBe(
      "general_followup",
    );
  });
});
describe("operation memory intent compound priority", () => {
  it.each([
    [
      [operation("answer", "concept"), operation("recall", "past_problem")],
      "past_problem_recall_request",
    ],
    [
      [
        operation("diagnose", "current_user_code"),
        operation("recall", "past_mistake"),
      ],
      "past_mistake_recall_request",
    ],
    [
      [
        operation("lookup_api", "api_object"),
        operation("persist", "knowledge_handbook"),
      ],
      "api_reference_question",
    ],
  ] as const)("selects %s for the compound operation set", (ops, expected) => {
    expect(deriveMemoryIntent(understandingWithOperations([...ops]))).toBe(
      expected,
    );
  });
});
