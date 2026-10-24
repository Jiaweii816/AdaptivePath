import { describe, expect, it } from "vitest";
import {
  buildCurrentWorkspaceContext,
  buildWorkspaceMetadata,
} from "@/server/agents/coach-agent/current-workspace-context";
import { formatAlignedRunLines } from "@/server/agents/coach-agent/chat-workspace-prompt";
import type {
  CoachUserContext,
  InternalRunEvidenceEnvelope,
} from "@/server/agents/coach-agent/coach-agent.types";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

const user: CoachUserContext = {
  displayName: "try",
  strongPatterns: [],
  weakPatterns: [],
  outputPreferences: [],
};

const baseMemory = coachMemoryBrief();

describe("buildCurrentWorkspaceContext strength fallback", () => {
  it("uses an earned successful-transfer cue for empty Two Sum code", () => {
    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "two-sum",
        title: "Two Sum",
        leetcodeNumber: 1,
        tags: ["array", "hashmap"],
        methodName: "twoSum",
      },
      language: "Python",
      code: "",
      selectedTests: [],
      memory: coachMemoryBrief({
        teachableMemories: [
          teachableMemory({
            cue: "Built a lookup map correctly on a prior complement problem.",
            sourceLabel: "Two Sum review",
            learnerSignalBasis: "earned_evidence",
          }),
        ],
      }),
      user,
    });

    expect(context.strengthFallback).toMatchObject({
      source: "l2_strength",
    });
    expect(context.strengthFallback?.text).toContain(
      "Built a lookup map correctly on a prior complement problem.",
    );
  });

  it("labels a self-reported successful-transfer cue as profile strength", () => {
    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "two-sum",
        title: "Two Sum",
        leetcodeNumber: 1,
        tags: ["array", "hashmap"],
        methodName: "twoSum",
      },
      language: "Python",
      code: "",
      selectedTests: [],
      memory: coachMemoryBrief({
        teachableMemories: [
          teachableMemory({
            cue: "The learner described hash maps as a strength.",
            sourceLabel: "Onboarding profile",
            learnerSignalBasis: "self_reported",
            evidenceRefs: [],
          }),
        ],
      }),
      user,
    });

    expect(context.strengthFallback).toMatchObject({
      source: "profile_strength",
    });
    expect(context.strengthFallback?.text).toContain("Onboarding profile");
  });

  it("falls back to problem first principles without a transfer cue", () => {
    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "search-insert-position",
        title: "Search Insert Position",
        leetcodeNumber: 35,
        tags: ["array", "binary-search"],
        methodName: "searchInsert",
      },
      language: "Python",
      code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
      selectedTests: [],
      memory: baseMemory,
      user,
    });

    expect(context.codeState).toBe("dummy_return");
    expect(context.strengthFallback).toMatchObject({
      source: "problem_first_principles",
    });
    expect(context.strengthFallback?.text).toContain(
      "Search Insert Position's input/output contract",
    );
  });
});

describe("current-code authoritative run alignment", () => {
  const code =
    "class Solution:\n    def searchInsert(self, nums, target):\n        return 0";
  const matchingHash = hashCodeForRun({ language: "Python", code });

  it.each([
    {
      name: "matching authoritative hash",
      language: "Python" as const,
      evidence: authoritativeEvidence(matchingHash),
      expected: "authoritative_run_matches_current_code",
    },
    {
      name: "different authoritative hash",
      language: "Python" as const,
      evidence: authoritativeEvidence("sha256:an-earlier-code-version"),
      expected: "current_code_changed_since_authoritative_run",
    },
    {
      name: "no authoritative evidence",
      language: "Python" as const,
      evidence: undefined,
      expected: "no_authoritative_run_yet",
    },
    {
      name: "authoritative evidence without an alignable hash",
      language: "Python" as const,
      evidence: authoritativeEvidence(null),
      expected: "unknown_current_code_status",
    },
  ])("maps $name", ({ language, evidence, expected }) => {
    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "search-insert-position",
        title: "Search Insert Position",
        leetcodeNumber: 35,
        tags: ["array", "binary-search"],
        methodName: "searchInsert",
      },
      language,
      code,
      selectedTests: [],
      latestAuthoritativeRunEvidence: evidence,
      memory: baseMemory,
      user,
    });

    expect(context.currentCodeAuthoritativeRunStatus).toBe(expected);
    expect(context.currentTurnRunObservations).toEqual([]);
  });

  it("keeps authoritative evidence aligned after a comment-only edit", () => {
    const executedCode = `${code}\n        # old explanation`;
    const currentCode = `${code}\n        # clearer explanation`;
    const executedHash = hashCodeForRun({
      language: "Python",
      code: executedCode,
    });
    const currentHash = hashCodeForRun({
      language: "Python",
      code: currentCode,
    });
    const executionFingerprint = fingerprintCodeForExecution({
      language: "Python",
      code: executedCode,
    });

    expect(currentHash).not.toBe(executedHash);
    expect(
      fingerprintCodeForExecution({ language: "Python", code: currentCode }),
    ).toBe(executionFingerprint);

    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "search-insert-position",
        title: "Search Insert Position",
        leetcodeNumber: 35,
        tags: ["array", "binary-search"],
        methodName: "searchInsert",
      },
      language: "Python",
      code: currentCode,
      selectedTests: [],
      latestAuthoritativeRunEvidence: authoritativeEvidence(
        executedHash,
        executionFingerprint,
      ),
      memory: baseMemory,
      user,
    });

    expect(context.currentCodeHash).toBe(currentHash);
    expect(context.currentExecutionFingerprint).toBe(executionFingerprint);
    expect(context.currentCodeAuthoritativeRunStatus).toBe(
      "authoritative_run_matches_current_code",
    );
  });

  it("projects the authoritative evidence id, source, and status for durable chat metadata", () => {
    const evidence = authoritativeEvidence("sha256:executed");
    const context = buildCurrentWorkspaceContext({
      problem: {
        slug: "search-insert-position",
        title: "Search Insert Position",
        leetcodeNumber: 35,
        tags: ["array", "binary-search"],
        methodName: "searchInsert",
      },
      language: "Python",
      code,
      selectedTests: [],
      latestAuthoritativeRunEvidence: evidence,
      memory: baseMemory,
      user,
    });

    expect(buildWorkspaceMetadata(context)).toMatchObject({
      latestAuthoritativeRunEvidenceId: "authoritative-run-1",
      latestAuthoritativeRunSource: "practice_run",
      latestAuthoritativeRunStatus: "timeout",
    });
  });
});

describe("aligned run prompt projection", () => {
  it.each([
    ["exact", "[LATEST ALIGNED RUN", false, false],
    ["code_aligned_suite_drifted", "[SUITE DRIFT NOTICE]", true, false],
    ["stale", "[INVALIDATED EVIDENCE NOTICE]", false, true],
  ] as const)("renders %s evidence honestly", (alignment, marker, hasDrift, hasInvalidation) => {
    const context = buildCurrentWorkspaceContext({
      problem: { slug: "two-sum", title: "Two Sum", leetcodeNumber: 1, tags: ["array"], methodName: "twoSum" },
      language: "Python",
      code: "class Solution:\n    pass",
      selectedTests: [],
      latestAuthoritativeRunEvidence: authoritativeEvidence("sha256:executed"),
      latestRunAlignment: alignment,
      memory: baseMemory,
      user,
    });
    const text = formatAlignedRunLines(context).join("\n");
    expect(text).toContain(marker);
    expect(text.includes("[SUITE DRIFT NOTICE]")).toBe(hasDrift);
    expect(text.includes("[INVALIDATED EVIDENCE NOTICE]")).toBe(hasInvalidation);
    expect(text.includes('"status":"timeout"')).toBe(alignment !== "stale");
  });

  it("shows exact same-code chat tools as advisory resumed evidence", () => {
    const context = buildCurrentWorkspaceContext({
      problem: { slug: "two-sum", title: "Two Sum", leetcodeNumber: 1, tags: ["array"], methodName: "twoSum" },
      language: "Python", code: "class Solution:\n    pass", selectedTests: [],
      latestRunAlignment: "none", resumedWorkingRunAlignment: "exact",
      resumedWorkingRunEvidence: { ...authoritativeEvidence("sha256:tool"), storageSource: "chat_current_tool", producer: "assistant_tool", authority: "advisory" },
      memory: baseMemory, user,
    });
    expect(formatAlignedRunLines(context).join("\n")).toContain("[RESUMED WORKING RUN — advisory, alignment=exact]");
  });
});

function authoritativeEvidence(
  codeHash: string | null,
  executionFingerprint?: string | null,
): InternalRunEvidenceEnvelope {
  return {
    id: "authoritative-run-1",
    storageSource: "practice_run",
    producer: "user_action",
    subject: "current_user_code",
    authority: "authoritative",
    scope: { kind: "selected_suite", totalCount: 3 },
    oracle: "stored_expected",
    createdAt: "2026-07-10T10:00:00.000Z",
    codeHash,
    executionFingerprint,
    result: {
      status: "timeout",
      failureProvenance: "user_code",
      passedCount: 0,
      failedCount: 3,
      stdout: "",
      stderr: "Execution timed out",
      testResults: [],
    },
  };
}
