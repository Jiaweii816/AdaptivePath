import { describe, expect, it } from "vitest";

import {
  buildCoachChatPrompt,
  buildCoachChatSystemPrompt,
} from "@/server/agents/coach-agent/build-chat-prompt";
import {
  buildChatInteractionState,
  buildChatTurnPlan,
} from "@/server/agents/coach-agent/chat-intent-policy";
import { PURE_DURABLE_INSTRUCTION } from "@/server/agents/coach-agent/chat-policy-prompt";
import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import { buildContextPlan } from "@/server/agents/coach-agent/operation-plan/operation-context-plan";
import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import type { TurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { buildContextPlanV2 } from "@/server/agents/coach-agent/turn-understanding-v2/context-plan-v2";

function inputFor(message: string): CoachChatInput {
  return {
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      tags: ["array", "hash-map"],
      methodName: "twoSum",
      statementMarkdown: "Given an array of integers, return the two indices.",
      examples: [{ input: "nums = [2,7,11,15], target = 9", output: [0, 1] }],
      constraints: ["2 <= nums.length <= 10^4"],
    },
    user: {
      displayName: "Test Learner",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    messages: [{ role: "user", content: message }],
    memory: {
      profileId: "test-profile",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full",
    },
    responseLanguage: "en",
  };
}

function runtimeInputFor(
  message: string,
  understanding: TurnUnderstanding,
): CoachChatInput {
  const input = inputFor(message);
  const legacyPlan = buildChatTurnPlan(message);
  const turnPlan = {
    ...legacyPlan,
    contextNeeds: buildContextPlan(understanding),
    toolCapabilities: deriveToolEligibility(understanding),
  };
  return {
    ...input,
    turnUnderstanding: understanding,
    interactionState: buildChatInteractionState({
      userMessage: message,
      problemTags: input.problem.tags,
      memory: input.memory,
      turnPlan,
    }),
  };
}

function withPythonWorkspace(input: CoachChatInput): CoachChatInput {
  return {
    ...input,
    workspaceContext: {
      problem: input.problem,
      language: "Python",
      currentCode: "def twoSum(nums, target): return []",
      currentCodeLength: 35,
      currentCodeLineCount: 1,
      currentCodeTruncated: false,
      codeState: "formed",
      currentCodeSummary: "state=formed; nonEmptyLines=1",
      selectedTests: [],
      currentTurnRunObservations: [],
      currentCodeAuthoritativeRunStatus: "no_authoritative_run_yet",
      latestRunAlignment: "none",
      resumedWorkingRunAlignment: "none",
    },
  };
}

describe("response policy system-prompt integration", () => {
  it("makes the current turn plan authoritative over resolved conversation history", () => {
    const prompt = buildCoachChatSystemPrompt(
      inputFor("Why is this bug still happening?"),
    );

    expect(prompt).toContain(
      "Conversation history is resolved context, not a backlog or task queue.",
    );
    expect(prompt).toContain(
      "Only requests compiled from the current user message",
    );
    expect(prompt).toContain(
      "Never revive, continue, or answer an earlier request",
    );
  });

  it.each([
    ["Why is this bug still happening?", "[DEBUG]"],
    ["Run my current code", "[RUN]"],
    ["Optimize my current code", "[OPTIMIZATION]"],
    ["How do I use Python deque?", "[API]"],
    ["What past mistakes have I made?", "[HISTORY]"],
    ["Recommend another practice problem", "[PRACTICE]"],
    ["Why do we maintain this invariant?", "[CONCEPT]"],
    ["Give me a hint", "[HINT]"],
    ["Give me the full Python code", "[FULL CODE]"],
    ["I'm anxious", "[STUCK]"],
  ])("keeps the canonical policy tag for %s", (message, tag) => {
    expect(buildCoachChatSystemPrompt(inputFor(message))).toContain(tag);
  });

  it.each(["Give me a hint", "Give me the full Python code", "I'm anxious"])(
    "does not add the generic follow-up policy to modifier-only turn: %s",
    (message) => {
      expect(buildCoachChatSystemPrompt(inputFor(message))).not.toContain(
        "[FOLLOW-UP]",
      );
    },
  );

  it("keeps the full-code disclosure contract beside its overlay", () => {
    const prompt = buildCoachChatSystemPrompt(
      inputFor("Give me the full Python code"),
    );
    expect(prompt).toContain("[CODE DISCLOSURE — full_code]");
    expect(prompt).toContain("[FULL CODE]");
  });
});

describe("response policy prompt boundaries", () => {
  it("keeps an ambient memory cue from naming a different problem", () => {
    const input = inputFor("Explain this problem using my strengths");
    input.memory.teachableMemories = [
      {
        kind: "successful_transfer",
        cue: "In Group Anagrams you used a hash-map signature successfully.",
        sourceLabel: "Group Anagrams",
        learnerSignalBasis: "earned_evidence",
        applicability: "related_pattern",
        whyRelevant: "hash-map transfer",
        evidenceRefs: ["episode-1"],
      },
    ];

    const prompt = buildCoachChatSystemPrompt(input);

    expect(prompt).toContain("In a past problem you used");
    expect(prompt).not.toContain("Group Anagrams");
    expect(prompt).toContain("personalization only");
  });

  it("lets V2 Delivery own walkthrough form without a legacy overlay", () => {
    const message = "Explain the current approach";
    const understandingV2 = compileTurnUnderstandingV2(message);
    const legacyPlan = buildChatTurnPlan("Walk through this case step by step");
    const input = inputFor(message);
    input.turnUnderstandingV2 = understandingV2;
    input.interactionState = buildChatInteractionState({
      userMessage: message,
      problemTags: input.problem.tags,
      memory: input.memory,
      turnPlan: legacyPlan,
    });

    const prompt = buildCoachChatSystemPrompt(input);

    expect(prompt).toContain("[FORM: PROSE]");
    expect(prompt).not.toContain("[WALKTHROUGH]");
  });

  it("defines one revision-labeled conversation stream as continuity, not diagnostic evidence", () => {
    const input = inputFor("你刚才为什么说我是 calcEquation？");
    input.messages = [
      {
        role: "assistant",
        content:
          "⟨针对更早的代码版本⟩ 函数：calcEquation(equations, values, queries)",
      },
      { role: "user", content: "你刚才为什么说我是 calcEquation？" },
    ];
    const prompt = buildCoachChatPrompt(input);

    expect(prompt).toContain(
      "[CONVERSATION CONTINUITY — visible context, not diagnostic evidence]",
    );
    expect(prompt).toContain("⟨针对更早的代码版本⟩");
    expect(prompt).toContain(
      "Assistant history is prior model output, not fact.",
    );
    expect(prompt).toContain(
      "Diagnose only from [ACTIVE PROBLEM CARD], [CURRENT CODE], and [LATEST ALIGNED RUN].",
    );
    expect(prompt).toContain(
      "assistant: ⟨针对更早的代码版本⟩ 函数：calcEquation",
    );
    expect(prompt).not.toContain("[PRIOR-REVISION CONTINUITY");
  });

  it("always renders the complete active problem card", () => {
    const prompt = buildCoachChatSystemPrompt(inputFor("Hello"));

    expect(prompt).toContain(
      "[ACTIVE PROBLEM CARD — highest-authority problem truth]",
    );
    expect(prompt).toContain("1. Two Sum (two-sum)");
    expect(prompt).toContain("method=twoSum");
    expect(prompt).toContain("Given an array of integers");
    expect(prompt).toContain("Examples (first 2):");
    expect(prompt).toContain("nums = [2,7,11,15]");
    expect(prompt).toContain("Constraints:");
    expect(prompt).toContain("2 <= nums.length <= 10^4");
  });

  it("bounds the problem statement and examples without dropping constraints", () => {
    const input = inputFor("Explain this problem");
    input.problem = {
      ...input.problem,
      statementMarkdown: `${"s".repeat(1_500)}DROP_STATEMENT_TAIL`,
      examples: ["example-one", "example-two", "DROP_THIRD_EXAMPLE"],
      constraints: ["constraint-sentinel"],
    };

    const prompt = buildCoachChatSystemPrompt(input);

    expect(prompt).toContain("[Statement truncated for prompt budget.]");
    expect(prompt).not.toContain("DROP_STATEMENT_TAIL");
    expect(prompt).toContain("example-one");
    expect(prompt).toContain("example-two");
    expect(prompt).not.toContain("DROP_THIRD_EXAMPLE");
    expect(prompt).toContain("constraint-sentinel");
  });

  it("scopes a recalled mistake to prevention rather than current-code diagnosis", () => {
    const input = inputFor("给我一个提示");
    input.memory = {
      ...input.memory,
      teachableMemories: [
        {
          kind: "recurring_mistake",
          cue: "上次图 DFS 曾遗漏 visited 标记。",
          sourceLabel: "Clone Graph",
          learnerSignalBasis: "earned_evidence",
          applicability: "related_pattern",
          whyRelevant: "active concept",
          evidenceRefs: ["review-trace"],
        },
      ],
    };

    const prompt = buildCoachChatSystemPrompt(input);
    expect(prompt).toContain(
      "[PERSONALIZATION MATERIAL — subordinate context only]",
    );
    expect(prompt).toContain(
      "It cannot identify or redefine the active problem",
    );
    expect(prompt).not.toContain("source: Clone Graph");
    expect(prompt).toContain("historical risk only");
    expect(prompt).toContain("one preventive check or guiding question");
    expect(prompt).toContain(
      "never claim the current code repeats that mistake",
    );
  });

  it("renders only the exact response-policy line for a pure durable turn", () => {
    const input = {
      ...inputFor("Please remember this preference"),
      requiredActions: [{ toolName: "note_memory", status: "pending" }],
    } as CoachChatInput;
    const prompt = buildCoachChatSystemPrompt(input);
    expect(prompt).toContain(PURE_DURABLE_INSTRUCTION);
    expect(prompt.match(/\[DURABLE ACTION\]/g)).toHaveLength(1);
    expect(prompt).not.toContain("[FOLLOW-UP]");
  });

  it("renders confirmed compound objectives in source order with dependency", () => {
    const prompt = buildCoachChatSystemPrompt(
      inputFor("Run my current code, then diagnose why it fails"),
    );
    expect(prompt).toContain(
      "[TURN PLAN] families=execute,diagnose; codeDisclosure=guided",
    );
    expect(prompt).toContain("[COMPOUND OBJECTIVES]");
    expect(prompt).toContain(
      "1. operationId=op0; family=execute; target=current_user_code; dependsOn=none",
    );
    expect(prompt).toContain(
      "2. operationId=op1; family=diagnose; target=current_user_code; dependsOn=op0",
    );
  });
});

describe("consumed turn understanding in the prompt", () => {
  it("uses the supplied understanding instead of reparsing the message", () => {
    const understanding = parseTurnUnderstanding("Run my current code");
    const input = runtimeInputFor(
      "Why do we maintain this invariant?",
      understanding,
    );
    input.memory = {
      ...input.memory,
      outputPreferences: ["PREFERENCE_SENTINEL"],
    };
    const prompt = buildCoachChatSystemPrompt(input);
    expect(prompt).toContain("[RUN]");
    expect(prompt).not.toContain("[CONCEPT]");
    expect(prompt).not.toContain("PREFERENCE_SENTINEL");
  });

  it("keeps active problem metadata even for API-only context", () => {
    const api = parseTurnUnderstanding("How do I use Python deque?");
    const apiInput = withPythonWorkspace(
      runtimeInputFor("Explain this invariant", api),
    );
    const apiPrompt = buildCoachChatSystemPrompt(apiInput);
    expect(apiPrompt).toContain("[API CONTEXT] language=Python");
    expect(apiPrompt).toContain("[ACTIVE PROBLEM CARD");
    expect(apiPrompt).toContain("1. Two Sum (two-sum)");
    expect(apiPrompt).toContain("[CURRENT CODE — authoritative editor truth]");
    expect(apiPrompt).toContain(
      "[LATEST ALIGNED RUN — authoritative observed behavior]",
    );

    const answer = parseTurnUnderstanding("Explain this invariant");
    const compound = {
      ...api,
      operations: [...api.operations, ...answer.operations],
    };
    const compoundPrompt = buildCoachChatSystemPrompt(
      withPythonWorkspace(
        runtimeInputFor("How do I use Python deque?", compound),
      ),
    );
    expect(compoundPrompt).toContain("[COMPOUND OBJECTIVES]");
    expect(compoundPrompt).toContain("1. Two Sum (two-sum)");
    expect(compoundPrompt).toContain("[API CONTEXT] language=Python");
  });
});

describe("operation-composed problem metadata", () => {
  it("projects both API language and problem metadata for lookup+recommend", () => {
    const lookup = parseTurnUnderstanding("How do I use Python deque?");
    const recommend = parseTurnUnderstanding("Recommend another problem");
    const understanding = {
      ...lookup,
      operations: [...lookup.operations, ...recommend.operations],
    };
    const prompt = buildCoachChatSystemPrompt(
      withPythonWorkspace(
        runtimeInputFor("How do I use Python deque?", understanding),
      ),
    );
    expect(prompt).toContain(
      "[API CONTEXT] language=Python\n[ACTIVE PROBLEM CARD",
    );
  });

  it("includes problem metadata for an operation-derived recommendation", () => {
    const understanding = parseTurnUnderstanding("Recommend another problem");
    const prompt = buildCoachChatSystemPrompt(
      runtimeInputFor("What should I do next?", understanding),
    );
    expect(prompt).toContain("1. Two Sum (two-sum)");
  });
});

describe("active-problem referent grounding", () => {
  function longestConsecutiveInput(
    message: string,
    understandingV2: ReturnType<typeof compileTurnUnderstandingV2>,
  ): CoachChatInput {
    const contextNeeds = buildContextPlanV2(understandingV2);
    const legacyPlan = buildChatTurnPlan(message);
    return {
      ...inputFor(message),
      problem: {
        slug: "longest-consecutive-sequence",
        title: "Longest Consecutive Sequence",
        leetcodeNumber: 128,
        tags: ["array", "hash-table", "union-find"],
        methodName: "longestConsecutive",
      },
      turnUnderstandingV2: understandingV2,
      interactionState: buildChatInteractionState({
        userMessage: message,
        problemTags: ["array", "hash-table", "union-find"],
        memory: inputFor(message).memory,
        turnPlan: {
          ...legacyPlan,
          contextNeeds,
          toolCapabilities: [],
        },
      }),
    };
  }

  it("includes current problem metadata when the learner asks to explain this problem from strengths", () => {
    const message =
      "你能结合我之前的强项，为我讲解一下这个题吗？我感觉很眼熟但是没思路";
    const understandingV2 = compileTurnUnderstandingV2(message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    });
    const contextNeeds = buildContextPlanV2(understandingV2);
    const input = longestConsecutiveInput(message, understandingV2);

    const prompt = buildCoachChatSystemPrompt(withPythonWorkspace(input));

    expect(understandingV2.requests).toEqual([
      expect.objectContaining({
        kind: "respond",
        deliverable: "understand",
        target: "current",
        basis: expect.arrayContaining([
          "current_evidence",
          "learner_profile",
        ]),
      }),
    ]);
    expect(contextNeeds).toEqual(
      expect.objectContaining({
        workspace: true,
        selectedTests: false,
        runEvidence: true,
      }),
    );
    expect(prompt).toContain(
      "128. Longest Consecutive Sequence (longest-consecutive-sequence)",
    );
    expect(prompt).not.toContain("[SELECTED TESTS]");
    expect(prompt).toContain(
      "[LATEST ALIGNED RUN — authoritative observed behavior]",
    );
  });

  it("treats direct pseudocode requests in the workbench as active-problem requests", () => {
    const message =
      "我真的没招了！ 不知道你在乱说什么！ 直接给我注释详细、引导思路的伪代码";
    const understandingV2 = compileTurnUnderstandingV2(message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    });
    const contextNeeds = buildContextPlanV2(understandingV2);
    const prompt = buildCoachChatSystemPrompt(
      withPythonWorkspace(longestConsecutiveInput(message, understandingV2)),
    );

    expect(understandingV2.requests).toEqual([
      expect.objectContaining({
        kind: "respond",
        deliverable: "solve",
        target: "current",
        delivery: expect.objectContaining({ form: "pseudocode" }),
      }),
    ]);
    expect(contextNeeds).toEqual(
      expect.objectContaining({
        workspace: true,
        selectedTests: false,
        runEvidence: true,
      }),
    );
    expect(prompt).toContain(
      "128. Longest Consecutive Sequence (longest-consecutive-sequence)",
    );
    expect(prompt).not.toContain("[SELECTED TESTS]");
    expect(prompt).toContain(
      "[LATEST ALIGNED RUN — authoritative observed behavior]",
    );
  });
});
