import { describe, expect, it } from "vitest";
import {
  buildCoachChatSystemPrompt,
  buildCoachReviewPrompt,
} from "@/server/agents/coach-agent/build-coach-prompt";
import type {
  CoachChatInput,
  CoachReviewInput,
} from "@/server/agents/coach-agent/coach-agent.types";
import type { CodeRunResult } from "@/types/code-runner";
import { buildCurrentWorkspaceContext } from "@/server/agents/coach-agent/current-workspace-context";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

function makeInput(status: CodeRunResult["status"]): CoachReviewInput {
  return {
    problem: {
      slug: "add-two-numbers",
      title: "Add Two Numbers",
      leetcodeNumber: 2,
      tags: ["linked-list", "math"],
      methodName: "addTwoNumbers",
    },
    user: {
      displayName: "try",
      strongPatterns: ["Two pointers"],
      weakPatterns: ["Carry handling"],
      outputPreferences: ["Short, step-by-step answer"],
    },
    memory: coachMemoryBrief(),
    language: "Python",
    code: "class Solution:\n    def addTwoNumbers(self, l1, l2):\n        return l1",
    runResult: {
      status,
      passedCount: status === "passed_visible_tests" ? 3 : 1141,
      failedCount: status === "passed_visible_tests" ? 0 : 428,
      stdout: "",
      stderr: "",
      actualOutput: "[7,0,4,3,1]",
      expectedOutput: "[7,0,4,0,1]",
      firstFailedCase:
        status === "passed_visible_tests"
          ? undefined
          : {
              id: "case-1",
              label: "uneven lengths",
              input: { l1: [2, 4, 9], l2: [5, 6, 4, 9] },
              expected: [7, 0, 4, 0, 1],
              actual: [7, 0, 4, 3, 1],
            },
      testResults: [],
    },
    responseLanguage: "zh",
  };
}

function makeChatInput(): CoachChatInput {
  return {
    problem: {
      slug: "search-insert-position",
      title: "Search Insert Position",
      leetcodeNumber: 35,
      tags: ["array", "binary-search"],
      methodName: "searchInsert",
    },
    user: {
      displayName: "try",
      strongPatterns: ["Array traversal"],
      weakPatterns: ["Binary Search"],
      outputPreferences: ["Short, step-by-step answer"],
    },
    memory: coachMemoryBrief(),
    messages: [
      {
        role: "user",
        content: "我想看优化思路但只要一点暗示，别跑代码。",
      },
    ],
    responseLanguage: "zh",
  };
}

describe("buildCoachReviewPrompt failed-run shape", () => {
  const prompt = buildCoachReviewPrompt(makeInput("failed"));

  it("instructs the soft beats", () => {
    expect(prompt).toContain("Root cause in ONE sentence");
    expect(prompt).toContain("Brief why");
    expect(prompt).toContain("Minimal fix");
    expect(prompt).toContain("optional invitation to Chat walkthrough");
    expect(prompt).toContain("Do not perform the walkthrough in Review");
    expect(prompt).not.toContain("Walk a minimal case");
    expect(prompt).not.toContain("mandatory minimal-case walkthrough");
  });

  it("injects learner history into Review only when memory is present", () => {
    // Empty memory (makeInput default) => no learner-history section, and never
    // the raw chat-side blocks.
    expect(prompt).not.toContain("[Learner history");
    expect(prompt).not.toContain("[Learner profile]");
    expect(prompt).not.toContain("[Session plan]");

    // Populated memory => only selected, human-readable cues reach the single
    // Review LLM call, with the learner-signal basis kept explicit.
    const base = makeInput("failed");
    const withMemory = buildCoachReviewPrompt({
      ...base,
      memory: coachMemoryBrief({
        teachableMemories: [
          teachableMemory({
            kind: "recurring_mistake",
            cue: "On uneven linked lists, the final carry was dropped more than once.",
            sourceLabel: "Add Two Numbers reviews",
          }),
          teachableMemory({
            cue: "Used a running carry successfully on Add Binary.",
            sourceLabel: "Add Binary review",
          }),
        ],
      }),
    });
    expect(withMemory).toContain("[COACH MEMORY BRIEF");
    expect(withMemory).toContain(
      "On uneven linked lists, the final carry was dropped more than once.",
    );
    expect(withMemory).toContain("Used a running carry successfully on Add Binary.");
    expect(withMemory).toContain("basis: earned_evidence");
    expect(withMemory).not.toContain("internal-trace-ref");
    expect(withMemory).not.toContain("Internal ranking explanation");
  });

  it("no longer emits the fixed five-section headings", () => {
    expect(prompt).not.toContain("### 你现在卡在哪里");
    expect(prompt).not.toContain("Required Chinese headings");
    expect(prompt).not.toContain("### Your Current Blocker");
  });

  it("keeps passed-run replies short and free-form", () => {
    const passed = buildCoachReviewPrompt(makeInput("passed_visible_tests"));

    expect(passed).toContain("Passed-run reply shape");
    expect(passed).not.toContain("Root cause in ONE sentence");
  });
});

describe("buildCoachChatSystemPrompt hint requests", () => {
  const prompt = buildCoachChatSystemPrompt(makeChatInput());

  it("does not steer direction-only hint requests into run_current_code", () => {
    expect(prompt).toContain("[HINT]");
    expect(prompt).toContain("Missing/starter code is not a reason to run code");
    expect(prompt).toContain("explicitly asks to execute or verify");
    expect(prompt).not.toContain("run_current_code");
  });

  it("keeps the authority contract and renders explicit empty run truth", () => {
    const prompt = buildCoachChatSystemPrompt(withWorkspace(makeChatInput()));

    expect(prompt).toContain(
      "[CURRENT CODE — authoritative editor truth]",
    );
    expect(prompt).toContain("Authority order is strict");
    expect(prompt).toContain(
      "Ground every diagnosis in the current code and aligned run supplied this turn.",
    );
    expect(prompt).toContain(
      "[CONVERSATION CONTINUITY — visible context, not diagnostic evidence]",
    );
    expect(prompt).toContain(
      "[LATEST ALIGNED RUN — authoritative observed behavior]\nnone",
    );
    expect(prompt).toContain("[CURRENT-TURN OBSERVATIONS — scoped and advisory]");
    expect(prompt).not.toContain("[SELECTED TESTS]");
  });

  it("keeps stable policy and problem truth ahead of turn-varying context", () => {
    const prompt = buildCoachChatSystemPrompt(withWorkspace(makeChatInput()));

    expect(prompt.indexOf("Authority order is strict")).toBeLessThan(
      prompt.indexOf("[ACTIVE PROBLEM CARD"),
    );
    expect(prompt.indexOf("[ACTIVE PROBLEM CARD")).toBeLessThan(
      prompt.indexOf("[TURN PLAN"),
    );
    expect(prompt.indexOf("[TURN PLAN")).toBeLessThan(
      prompt.indexOf("\n[CURRENT CODE — authoritative editor truth]"),
    );
  });

  it("renders only the selected cues and never leaks trace-only memory fields", () => {
    const base = makeChatInput();
    const prompt = buildCoachChatSystemPrompt({
      ...withWorkspace(base),
      memory: coachMemoryBrief({
        teachableMemories: [
          teachableMemory({
            cue: "Tracing the map after each item helped on Two Sum.",
            sourceLabel: "Two Sum review",
            whyRelevant: "same internal concept score",
            evidenceRefs: ["episode-internal-id"],
          }),
        ],
      }),
    });

    expect(prompt).toContain("[COACH MEMORY BRIEF");
    expect(prompt).toContain("Tracing the map after each item helped on Two Sum.");
    expect(prompt).toContain("basis: earned_evidence");
    expect(prompt).not.toContain("same internal concept score");
    expect(prompt).not.toContain("episode-internal-id");
  });

  it("requires tabular state changes in thinking walkthrough mode", () => {
    const thinkingPrompt = buildCoachChatSystemPrompt({
      ...makeChatInput(),
      thinking: true,
      messages: [
        {
          role: "user",
          content:
            '你能带我walk through case "ccc"吗？列表帮助我清晰观察各变量在循环中的值变化',
        },
      ],
    });

    expect(thinkingPrompt).toContain("[WALKTHROUGH]");
    expect(thinkingPrompt).toContain("You MUST use a compact Markdown table");
    expect(thinkingPrompt).toContain("Markdown table");
    expect(thinkingPrompt).toContain("key variables");
    expect(thinkingPrompt).toContain("branch or condition");
    expect(thinkingPrompt).toContain("state after the step");
    expect(thinkingPrompt).toContain("Do not use HTML tags such as <br>");
    expect(thinkingPrompt).toContain("Keep table cells short");
    expect(thinkingPrompt).toContain("at most two takeaway bullets");
    expect(thinkingPrompt).not.toContain("otherwise a short numbered list");
  });

  it("adds concrete walkthrough table instructions from the latest user text even if thinking flag is missing", () => {
    const prompt = buildCoachChatSystemPrompt({
      ...makeChatInput(),
      messages: [
        {
          role: "user",
          content:
            "我还是没有太看懂...你可以用nums = [10, 9, 2, 5, 3, 7, 101, 18] 带我walk through吗？",
        },
      ],
    });

    expect(prompt).toContain("[WALKTHROUGH]");
    expect(prompt).toContain("Markdown table");
    expect(prompt).toContain("current item/index");
    expect(prompt).toContain("key variables");
    expect(prompt).toContain("state after the step");
  });

  it("treats named examples as concrete walkthrough cases that must use a Markdown table", () => {
    const prompt = buildCoachChatSystemPrompt({
      ...makeChatInput(),
      thinking: true,
      messages: [
        {
          role: "user",
          content: "其实我对递归不熟，你能用example1，带我walk through吗？",
        },
      ],
    });

    expect(prompt).toContain("[WALKTHROUGH]");
    expect(prompt).toContain("You MUST use a compact Markdown table");
    expect(prompt).toContain("current item/index");
    expect(prompt).toContain("branch or condition");
    expect(prompt).not.toContain("otherwise a short numbered list");
  });

  it("keeps the response language instruction out of the cache-sensitive prompt prefix", () => {
    const prompt = buildCoachChatSystemPrompt(makeChatInput());
    const lines = prompt.split("\n");

    expect(lines[0]).toBe("You are CoachAgent for PatternCoach AI.");
    expect(lines[1]).not.toMatch(/Respond in (Chinese|English)/);
    expect(prompt).toContain("[OUTPUT LANGUAGE] Respond in Chinese.");
  });
});

function withWorkspace(input: CoachChatInput): CoachChatInput {
  return {
    ...input,
    workspaceContext: buildCurrentWorkspaceContext({
      problem: input.problem,
      language: "Python",
      code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
      selectedTests: [],
      memory: input.memory,
      user: input.user,
      sessionPlan: input.sessionPlan,
    }),
  };
}
