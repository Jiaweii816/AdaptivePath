import { describe, expect, it } from "vitest";
import {
  buildCoachChatPrompt,
  buildCoachChatSystemPrompt,
  buildCoachReviewPrompt,
} from "@/server/agents/coach-agent/build-coach-prompt";
import {
  buildChatInteractionState,
  buildChatTurnPlan,
} from "@/server/agents/coach-agent/chat-intent-policy";
import { formatReviewMemorySection } from "@/server/agents/coach-agent/review-memory";
import type {
  CoachChatInput,
  CoachReviewInput,
} from "@/server/agents/coach-agent/coach-agent.types";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import type { CodeRunResult } from "@/types/code-runner";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

describe("coach prompt memory budget", () => {
  it("injects at most two human-readable Review cues without trace internals", () => {
    const prompt = buildCoachReviewPrompt({
      ...baseReviewInput(),
      memory: oversizedMemoryBrief(),
    });

    expect(prompt).toContain("[COACH MEMORY BRIEF");
    expect(prompt).toContain("Kept the candidate midpoint on a prior lower-bound task.");
    expect(prompt).toContain("The learner described array traversal as a strength.");
    expect(prompt).not.toContain("MUST_NOT_APPEAR_THIRD_CUE");
    expect(prompt).toContain("basis: earned_evidence");
    expect(prompt).toContain("basis: self_reported");
    expect(prompt).not.toContain("binary_search_boundary");
    expect(prompt).not.toContain("raw-confidence=0.93");
    expect(prompt).not.toContain("fact-internal-id");
    expect(prompt).toContain("Prefer one concrete example before abstraction.");
    expect(prompt).not.toContain("MUST_NOT_APPEAR_FOURTH_PREFERENCE");
    expect(prompt).toContain("First >= target");
    expect(prompt).not.toContain("MUST_NOT_APPEAR_SECOND_REFERENCE");
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toContain("Run evidence JSON:");
  });

  it("projects Chat memory to the same two-cue contract", () => {
    const prompt = buildCoachChatSystemPrompt({
      ...baseChatInput(),
      memory: oversizedMemoryBrief(),
    });
    const learnerSection = sectionLines(
      prompt,
      "[COACH MEMORY BRIEF",
      "Use at most the selected cues above.",
    );

    expect(
      learnerSection.filter((line) => line.startsWith("- ")),
    ).toHaveLength(2);
    expect(prompt).toContain("basis: earned_evidence");
    expect(prompt).toContain("basis: self_reported");
    expect(prompt).not.toContain("MUST_NOT_APPEAR_THIRD_CUE");
    expect(prompt).not.toContain("raw-confidence=0.93");
    expect(prompt).not.toContain("fact-internal-id");
    expect(prompt).not.toContain("retrievalStatus");
    expect(prompt.length).toBeLessThan(6000);
  });

  it("keeps Rotate optimization below budget with relevant current code but without unrelated selected-test or API-KB data", () => {
    const message =
      "这个题目我的思路很浅薄，我想用一个空数组，先从位置k开始往队列里加入元素，一直到结尾后，再来从索引0 的位置加，加到k-1. 直觉告诉我这不是最优解，请你优化我的思路";
    const turnPlan = buildChatTurnPlan(message);
    const currentCode =
      "class Solution:\n    def rotate(self, nums, k):\n        current_rotate_code_marker = nums[:]";
    const memory = coachMemoryBrief({
      teachableMemories: [
        teachableMemory({
          cue: "Previously compared extra-space and in-place array transformations.",
          sourceLabel: "Array review",
        }),
      ],
    });
    const input: CoachChatInput = {
      problem: {
        slug: "rotate-array",
        title: "Rotate Array",
        leetcodeNumber: 189,
        tags: ["array", "math", "two-pointers"],
        methodName: "rotate",
      },
      user: {
        displayName: "try",
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: ["Pseudocode before full code"],
      },
      memory,
      workspaceContext: {
        problem: {
          slug: "rotate-array",
          title: "Rotate Array",
          leetcodeNumber: 189,
          tags: ["array", "math", "two-pointers"],
          methodName: "rotate",
        },
        language: "Python",
        currentCode,
        currentCodeLength: currentCode.length,
        currentCodeLineCount: 3,
        currentCodeTruncated: false,
        codeState: "formed",
        currentCodeSummary: "state=formed; nonEmptyLines=3",
        selectedTests: [
          {
            id: "sample-1",
            label: "MUST_NOT_APPEAR_SELECTED_TEST",
            source: "sample",
            input: { nums: [1, 2, 3, 4, 5, 6, 7], k: 3 },
            expected: [5, 6, 7, 1, 2, 3, 4],
          },
        ],
        currentTurnRunObservations: [],
        currentCodeAuthoritativeRunStatus: "no_authoritative_run_yet",
        latestRunAlignment: "none",
        resumedWorkingRunAlignment: "none",
      },
      messages: [{ role: "user", content: message }],
      interactionState: buildChatInteractionState({
        userMessage: message,
        problemTags: ["array", "math", "two-pointers"],
        memory,
        turnPlan,
      }),
      responseLanguage: "zh",
    };
    const systemPrompt = buildCoachChatSystemPrompt(input);
    const providerText = buildCoachChatPrompt(input);

    expect(turnPlan).toMatchObject({
      primaryIntent: "optimization_request",
      codeDisclosure: "guided",
      toolCapabilities: [],
      contextNeeds: {
        currentCode: true,
        handbook: false,
        episodes: false,
      },
    });
    expect(systemPrompt.length).toBeLessThanOrEqual(6000);
    expect(providerText.length).toBeLessThan(8000);
    expect(systemPrompt).toContain("[OPTIMIZATION]");
    expect(systemPrompt).toContain(
      "you may include at most one or two language-neutral core pseudocode lines",
    );
    expect(systemPrompt).toContain("never provide complete pseudocode");
    expect(systemPrompt).not.toContain("pseudocode-level plan");
    expect(systemPrompt).toContain(
      "Previously compared extra-space and in-place array transformations.",
    );
    expect(systemPrompt).toContain("Current editor code");
    expect(systemPrompt).toContain("current_rotate_code_marker");
    expect(systemPrompt).not.toContain("MUST_NOT_APPEAR_SELECTED_TEST");
    expect(systemPrompt).not.toContain("RequestedAction vocabulary");
    expect(systemPrompt).not.toContain("EvidencePlan vocabulary");
    expect(systemPrompt).not.toContain("lookup_api_reference");
    expect(systemPrompt).not.toContain("run_current_code");
  });
});

describe("style-only cue projection", () => {
  it("places a teaching_style_only cue outside the learner cue block", () => {
    const lines = formatReviewMemorySection(
      coachMemoryBrief({
        teachableMemories: [
          teachableMemory({
            applicability: "teaching_style_only",
            cue: "你偏好先看一个具体例子再看结论。",
          }),
        ],
      }),
    );
    const text = lines.join("\n");

    expect(text).toContain("Teaching-style signals");
    expect(text).toContain(
      "must not be used as evidence about the current code",
    );
    const cueBlockIndex = text.indexOf("Selected learner cues");
    expect(cueBlockIndex).toBe(-1);
  });
});

function sectionLines(prompt: string, startMarker: string, endMarker: string) {
  const start = prompt.indexOf(startMarker);
  const end = prompt.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end).split("\n");
}

function oversizedMemoryBrief(): CoachMemoryBrief {
  return coachMemoryBrief({
    teachableMemories: [
      teachableMemory({
        cue: "Kept the candidate midpoint on a prior lower-bound task.",
        sourceLabel: "Search Insert review",
        whyRelevant: "raw-confidence=0.93 binary_search_boundary",
        evidenceRefs: ["fact-internal-id"],
      }),
      teachableMemory({
        cue: "The learner described array traversal as a strength.",
        sourceLabel: "Onboarding profile",
        learnerSignalBasis: "self_reported",
        evidenceRefs: [],
      }),
      teachableMemory({
        kind: "saved_knowledge",
        cue: "MUST_NOT_APPEAR_THIRD_CUE",
        sourceLabel: "Learner notebook",
      }),
    ],
    outputPreferences: [
      "Prefer one concrete example before abstraction.",
      "Keep the first response concise.",
      "Use Python identifiers in English.",
      "MUST_NOT_APPEAR_FOURTH_PREFERENCE",
    ],
    teachingStrategy: "Ask for the loop invariant before proposing a rewrite.",
    domainReferences: [
      {
        title: "First >= target",
        content: "A lower-bound loop preserves the first valid candidate.",
        sourceLabel: "Hot-150 domain reference",
      },
      {
        title: "MUST_NOT_APPEAR_SECOND_REFERENCE",
        content: "MUST_NOT_APPEAR_SECOND_REFERENCE_CONTENT",
        sourceLabel: "Internal reference",
      },
    ],
    retrievalStatus: "partial_failure",
  });
}

function baseReviewInput(): CoachReviewInput {
  return {
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      tags: ["array", "hash_map"],
      methodName: "twoSum",
    },
    user: {
      displayName: "try",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: coachMemoryBrief(),
    language: "Python",
    code: "class Solution:\n    pass\n",
    runResult: baseRunResult(),
    responseLanguage: "zh",
  };
}

function baseChatInput(): CoachChatInput {
  return {
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      tags: ["array", "hash_map"],
      methodName: "twoSum",
    },
    user: {
      displayName: "try",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: coachMemoryBrief(),
    messages: [{ role: "user", content: "给我一点提示，不要直接给答案。" }],
    lastRunResult: baseRunResult(),
    responseLanguage: "zh",
  };
}

function baseRunResult(): CodeRunResult {
  return {
    status: "failed",
    passedCount: 0,
    failedCount: 1,
    stdout: "",
    stderr: "",
    testResults: [],
  };
}
