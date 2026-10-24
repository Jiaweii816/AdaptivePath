import { describe, expect, it } from "vitest";
import { buildCoachReviewPrompt } from "@/server/agents/coach-agent/build-coach-prompt";
import type { CoachReviewInput } from "@/server/agents/coach-agent/coach-agent.types";
import type { EvidenceVerdict } from "@/types/evidence";
import { coachMemoryBrief } from "./coach-memory-brief-test-helpers";

const localOnlyVerdict: EvidenceVerdict = {
  evidenceClass: "local_only",
  replyMode: "local_fallback",
  capabilities: {
    canVerdict: true,
    canWriteMistakeMemory: false,
    canWriteEpisode: true,
    canSignalPlanner: true,
    canUseFailureSalience: false,
  },
  status: "passed_visible_tests",
  scopeLabel: "local visible-test fallback",
  modelInstruction:
    "Stay scoped to local visible fallback tests; do not claim official success.",
};

function baseInput(overrides: Partial<CoachReviewInput> = {}): CoachReviewInput {
  return {
    problem: {
      slug: "maximum-sum-circular-subarray",
      title: "Maximum Sum Circular Subarray",
      leetcodeNumber: 918,
      tags: ["array", "dynamic-programming"],
      methodName: "maxSubarraySumCircular",
    },
    user: {
      displayName: "Iris",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: coachMemoryBrief(),
    language: "Python",
    code: "class Solution:\n    pass",
    runResult: {
      status: "passed_visible_tests",
      passedCount: 3,
      failedCount: 0,
      stdout: "",
      stderr: "",
      durationMs: 12,
      testResults: [],
    },
    responseLanguage: "zh",
    ...overrides,
  };
}

describe("buildCoachReviewPrompt Local-Evidence Examiner mode", () => {
  it("uses the static remote-unavailable contract for failed LeetCode submit evidence", () => {
    const prompt = buildCoachReviewPrompt(
      baseInput({
        evidenceVerdict: {
          evidenceClass: "evidence_unavailable",
          replyMode: "unavailable",
          capabilities: {
            canVerdict: false,
            canWriteMistakeMemory: false,
            canWriteEpisode: false,
            canSignalPlanner: false,
            canUseFailureSalience: false,
          },
          status: "runner_error",
          providerUsed: "lc_submit",
          scopeLabel: "execution evidence unavailable",
          modelInstruction:
            "Remote LeetCode evidence is unavailable; use static review only.",
        },
        runResult: {
          status: "runner_error",
          failureProvenance: "judge_service",
          passedCount: 0,
          failedCount: 0,
          stdout: "",
          stderr: "Remote judge unavailable",
          testResults: [],
          rawResult: { providerUsed: "lc_submit" },
        },
      }),
    );

    expect(prompt).toContain(
      "远程 LeetCode 评测暂时不可用，当前为静态代码审查，并非官方判定结果。建议您点击左侧 LeetCode 链接提交代码以获取官方正式评测。",
    );
    expect(prompt).toContain("Static remote-unavailable reply shape");
    expect(prompt).toContain("Do not use Piston/local visible-test results as the Review conclusion");
    expect(prompt).toContain("memoryUpdateCandidate.facts must be []");
    expect(prompt).not.toContain("Local-Evidence Examiner reply");
  });

  it("hands aligned local passed evidence to Coach while limiting its authority", () => {
    const prompt = buildCoachReviewPrompt(
      baseInput({ evidenceVerdict: localOnlyVerdict }),
    );

    expect(prompt).toContain("Local-Evidence Examiner reply");
    expect(prompt).toContain("selected local visible tests");
    expect(prompt).toContain("not an official LeetCode verdict");
    expect(prompt).toContain("Run evidence JSON:");
    expect(prompt).toContain('"passedCount": 3');
    expect(prompt).toContain('"failedCount": 0');
    expect(prompt).not.toContain("WITHHELD from CoachAgent");
    expect(prompt).toContain("memoryUpdateCandidate.facts must not contain mistake facts");
    expect(prompt).not.toContain("`near_optimal` or `can_optimize:");
    expect(prompt).not.toContain("static examiner");
  });

  it("hands the actual failed case to Coach and permits an evidence-scoped candidate", () => {
    const prompt = buildCoachReviewPrompt(
      baseInput({
        evidenceVerdict: {
          ...localOnlyVerdict,
          status: "failed",
          capabilities: {
            ...localOnlyVerdict.capabilities,
            canWriteMistakeMemory: true,
            canSignalPlanner: false,
            canUseFailureSalience: true,
          },
        },
        runResult: {
          status: "failed",
          passedCount: 0,
          failedCount: 1,
          stdout: "trace",
          stderr: "",
          actualOutput: "0",
          expectedOutput: "3",
          firstFailedCase: {
            id: "visible-1",
            label: "wraparound",
            input: { nums: [5, -3, 5] },
            expected: 10,
            actual: 5,
          },
          testResults: [],
        },
      }),
    );

    expect(prompt).toContain('"label": "wraparound"');
    expect(prompt).toContain('"actualOutput": "0"');
    expect(prompt).toContain('"expectedOutput": "3"');
    expect(prompt).toContain("evidence-scoped local_only Review failures");
    expect(prompt).toContain("must not imply official acceptance or hidden-test coverage");
  });

  it("keeps the near-optimal success contract for verdict-bearing passed runs", () => {
    const verdict: EvidenceVerdict = {
      ...localOnlyVerdict,
      evidenceClass: "verdict_bearing",
      replyMode: "success",
      scopeLabel: "execution evidence",
    };
    const prompt = buildCoachReviewPrompt(baseInput({ evidenceVerdict: verdict }));

    expect(prompt).toContain("`near_optimal` or `can_optimize:");
    expect(prompt).not.toContain("Local-Evidence Examiner reply");
  });

  it("uses soft-beat diagnostic instructions for failed runs", () => {
    const prompt = buildCoachReviewPrompt(
      baseInput({
        runResult: {
          status: "failed",
          passedCount: 0,
          failedCount: 1,
          stdout: "",
          stderr: "",
          testResults: [],
        },
      }),
    );

    expect(prompt).toContain("Root cause in ONE sentence");
    expect(prompt).toContain("Brief why");
    expect(prompt).toContain("Minimal fix");
    expect(prompt).toContain("optional invitation to Chat walkthrough");
    expect(prompt).toContain("Do not include a variable trace or case walkthrough in Review");
    expect(prompt).not.toContain("Walk a minimal case");
    expect(prompt).toContain("no fixed headings");
    expect(prompt).not.toContain("Required Chinese headings");
    expect(prompt).not.toContain("### 你现在卡在哪里");
    expect(prompt).not.toContain("### Your Current Blocker");
    expect(prompt).not.toContain("read-only examiner");
  });
});
