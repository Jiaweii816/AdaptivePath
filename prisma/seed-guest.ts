import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { genericCampaignSkeleton } from "../src/server/campaign/curriculum";
import { formatCampaignDate } from "../src/server/campaign/core";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
} from "../src/server/campaign/services";
import { createFtsStore } from "../src/server/memory/store/fts-store";
import {
  assertLocalDatabaseProfileEnvironment,
  resolveSqliteFilePath,
} from "../src/server/db/sqlite-path";
import { seedDatabase, type LocalSeedProfile } from "./seed";

const json = (value: unknown) => JSON.stringify(value);
const GUEST_HANDLE = "guest";
// Guest is an isolated, resettable learner profile. Using learner provenance
// makes the normal Memory/Profile paths work without any guest-only branches.
const GUEST_ORIGIN = "learner";
const GUEST_TIMEZONE = "America/Chicago";

const guestProfile: LocalSeedProfile = {
  handle: GUEST_HANDLE,
  displayName: "Guest Learner",
  interviewGoal: "full_time",
  preferredLanguages: ["Python"],
  strongPatterns: ["Hash Mapping and Counting", "In-place Arrays"],
  weakPatterns: ["Sliding Windows", "Binary Search Boundary Invariants"],
  explanationStyle: ["Short, step-by-step answer", "Concrete example first"],
  outputPreferences: ["Pseudocode before full code", "Explain with examples"],
};

function addDays(date: Date, days: number) {
  return new Date(date.valueOf() + days * 24 * 60 * 60 * 1_000);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function failedSlidingWindowRun() {
  const failedCase = {
    id: "guest-case-abba",
    label: "left boundary must not roll back",
    input: { s: "abba" },
    expected: 2,
    actual: 3,
  };
  return {
    status: "failed",
    passedCount: 3,
    failedCount: 1,
    stdout: "",
    stderr: "",
    durationMs: 18,
    actualOutput: "3",
    expectedOutput: "2",
    firstFailedCase: failedCase,
    testResults: [
      { ...failedCase, passed: false, status: "failed" },
    ],
    providerUsed: "local_hot150",
    evidenceVerdict: {
      class: "local_visible",
      authority: "visible_tests",
      scope: "selected_visible_tests",
      subject: "current_revision",
      canVerdict: true,
    },
  };
}

function passedTwoSumRun() {
  return {
    status: "passed_visible_tests",
    passedCount: 3,
    failedCount: 0,
    stdout: "",
    stderr: "",
    durationMs: 12,
    testResults: [
      {
        id: "guest-case-two-sum",
        label: "sample 1",
        input: { nums: [2, 7, 11, 15], target: 9 },
        expected: [0, 1],
        actual: [0, 1],
        passed: true,
        status: "passed",
      },
    ],
    providerUsed: "local_hot150",
    evidenceVerdict: {
      class: "local_visible",
      authority: "visible_tests",
      scope: "selected_visible_tests",
      subject: "current_revision",
      canVerdict: true,
    },
  };
}

async function seedReviewAndMemoryExamples(
  prisma: PrismaClient,
  input: { userId: string; now: Date },
) {
  const slidingProblem = await prisma.problem.findUniqueOrThrow({
    where: { slug: "longest-substring-without-repeating-characters" },
  });
  const twoSumProblem = await prisma.problem.findUniqueOrThrow({
    where: { slug: "two-sum" },
  });
  const reviewAt = addDays(input.now, -8);
  const successAt = addDays(input.now, -5);
  const failedRun = failedSlidingWindowRun();
  const passedRun = passedTwoSumRun();
  const slidingCode = [
    "class Solution:",
    "    def lengthOfLongestSubstring(self, s: str) -> int:",
    "        last_seen = {}",
    "        left = answer = 0",
    "        for right, char in enumerate(s):",
    "            if char in last_seen:",
    "                left = last_seen[char] + 1",
    "            last_seen[char] = right",
    "            answer = max(answer, right - left + 1)",
    "        return answer",
  ].join("\n");
  const twoSumCode = [
    "class Solution:",
    "    def twoSum(self, nums, target):",
    "        seen = {}",
    "        for index, value in enumerate(nums):",
    "            if target - value in seen:",
    "                return [seen[target - value], index]",
    "            seen[value] = index",
  ].join("\n");

  await prisma.codeDraft.createMany({
    data: [
      {
        id: "guest-draft-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        language: "Python",
        content: slidingCode,
        selectedTestCaseIds: json(["guest-case-abba"]),
        createdAt: reviewAt,
        updatedAt: reviewAt,
      },
      {
        id: "guest-draft-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        language: "Python",
        content: twoSumCode,
        selectedTestCaseIds: json(["guest-case-two-sum"]),
        createdAt: successAt,
        updatedAt: successAt,
      },
    ],
  });

  await prisma.chatSession.createMany({
    data: [
      {
        id: "guest-chat-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        title: "Sliding-window boundary repair",
        primaryLanguage: "Python",
        rollingSummary: "Fixed a left-boundary rollback bug using max(left, last_seen[c] + 1).",
        sessionPlanJson: json({
          goal: "Repair the current invariant before discussing optimization.",
          nextStep: "Trace the visible abba case.",
        }),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
        updatedAt: addDays(reviewAt, 0.02),
      },
      {
        id: "guest-chat-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        title: "Hash-map complement check",
        primaryLanguage: "Python",
        rollingSummary: "Used a one-pass complement map and passed the selected visible cases.",
        sessionPlanJson: json({
          goal: "Confirm the complement-map invariant.",
          nextStep: "Explain why lookup happens before insert.",
        }),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
        updatedAt: addDays(successAt, 0.02),
      },
    ],
  });

  await prisma.reviewAttempt.createMany({
    data: [
      {
        id: "guest-review-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        chatSessionId: "guest-chat-sliding",
        codeDraftId: "guest-draft-sliding",
        language: "Python",
        userState: "My idea feels right but my code has bugs",
        userQuestion: "Why does abba return 3?",
        codeSnapshot: slidingCode,
        selectedTestCaseIds: json(["guest-case-abba"]),
        selectedTestsJson: json([{ id: "guest-case-abba", input: { s: "abba" }, expected: 2 }]),
        coachReplyMarkdown: "Your left boundary moves backward when the second `a` is outside the current window. Keep it monotonic with `left = max(left, last_seen[char] + 1)`, then rerun the visible `abba` case.",
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
      },
      {
        id: "guest-review-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        chatSessionId: "guest-chat-two-sum",
        codeDraftId: "guest-draft-two-sum",
        language: "Python",
        userState: "I have a working approach",
        userQuestion: "Is the one-pass map invariant sound?",
        codeSnapshot: twoSumCode,
        selectedTestCaseIds: json(["guest-case-two-sum"]),
        selectedTestsJson: json([{ id: "guest-case-two-sum", input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] }]),
        coachReplyMarkdown: "The selected visible cases pass. Looking up the complement before inserting the current value prevents reusing the same index; this is local visible evidence, not an official hidden-test verdict.",
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
      },
    ],
  });

  await prisma.runEvidence.createMany({
    data: [
      {
        id: "guest-run-sliding",
        reviewAttemptId: "guest-review-sliding",
        chatSessionId: "guest-chat-sliding",
        source: "review",
        codeHash: stableHash(slidingCode),
        executionFingerprint: stableHash(`guest-sliding|${json(failedRun)}`),
        status: "failed",
        passedCount: 3,
        failedCount: 1,
        durationMs: 18,
        actualOutput: "3",
        expectedOutput: "2",
        firstFailedCaseJson: json(failedRun.firstFailedCase),
        rawResultJson: json(failedRun),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
      },
      {
        id: "guest-run-two-sum",
        reviewAttemptId: "guest-review-two-sum",
        chatSessionId: "guest-chat-two-sum",
        source: "review",
        codeHash: stableHash(twoSumCode),
        executionFingerprint: stableHash(`guest-two-sum|${json(passedRun)}`),
        status: "passed_visible_tests",
        passedCount: 3,
        failedCount: 0,
        durationMs: 12,
        rawResultJson: json(passedRun),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
      },
    ],
  });

  await prisma.diagnosisResult.createMany({
    data: [
      {
        id: "guest-diagnosis-sliding",
        reviewAttemptId: "guest-review-sliding",
        diagnosisJson: json({ rootCause: "The left boundary can move backward after a repeat outside the active window." }),
        memoryUpdateCandidateJson: json({ factType: "weakness", tag: "sliding_window_left_boundary" }),
        mistakeTags: json(["sliding-window", "boundary-invariant"]),
        skillTags: json(["Sliding Windows"]),
        userIssueSummary: "Left boundary rollback breaks the active-window invariant.",
        coachSummary: "Use max to keep left monotonic.",
        selfCheckQuestion: "Why must left never decrease?",
        selfCheckAnswer: "A smaller left would reintroduce characters already excluded from the active window.",
        createdAt: reviewAt,
      },
      {
        id: "guest-diagnosis-two-sum",
        reviewAttemptId: "guest-review-two-sum",
        diagnosisJson: json({ rootCause: null, mechanism: "One-pass complement lookup" }),
        memoryUpdateCandidateJson: json({ factType: "strength", tag: "hashmap_complement_lookup" }),
        mistakeTags: "[]",
        skillTags: json(["Hash Mapping and Counting"]),
        userIssueSummary: "No visible-case failure.",
        coachSummary: "Complement lookup is implemented with the correct update order.",
        selfCheckQuestion: "Why check before inserting the current number?",
        selfCheckAnswer: "It prevents the current index from satisfying its own complement lookup.",
        createdAt: successAt,
      },
    ],
  });

  await prisma.problemHistory.createMany({
    data: [
      {
        id: "guest-history-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        reviewAttemptId: "guest-review-sliding",
        chatSessionId: "guest-chat-sliding",
        language: "Python",
        userState: "My idea feels right but my code has bugs",
        problemTags: json(["sliding-window", "string"]),
        runStatus: "failed",
        failedCaseSummary: "s=abba, expected 2, actual 3",
        userIssueSummary: "Left boundary moved backward.",
        coachSummary: "Preserve a monotonic left boundary.",
        memoryUpdateSummary: "Recorded a sliding-window boundary weakness.",
        nextRecommendation: "Retry Minimum Size Subarray Sum after repairing this case.",
        durationSeconds: 720,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
      },
      {
        id: "guest-history-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        reviewAttemptId: "guest-review-two-sum",
        chatSessionId: "guest-chat-two-sum",
        language: "Python",
        userState: "I have a working approach",
        problemTags: json(["array", "hash-table"]),
        runStatus: "passed_visible_tests",
        coachSummary: "Confirmed the one-pass complement-map invariant on selected visible cases.",
        memoryUpdateSummary: "Reinforced hash-map lookup/update ordering.",
        nextRecommendation: "Practice Group Anagrams to extend key design.",
        durationSeconds: 540,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
      },
    ],
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        id: "guest-message-sliding-user",
        sessionId: "guest-chat-sliding",
        role: "user",
        contentMarkdown: "My sliding-window idea seems right, but `abba` returns 3. What invariant am I breaking?",
        metadataJson: json({ workspace: { codeHash: stableHash(slidingCode), language: "Python" } }),
        sequence: 1,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
      },
      {
        id: "guest-message-sliding-review",
        sessionId: "guest-chat-sliding",
        reviewAttemptId: "guest-review-sliding",
        role: "assistant",
        contentMarkdown: "Your left boundary moves backward when the repeated character is outside the current window. Keep `left` monotonic with `max` and rerun `abba`.",
        metadataJson: json({ type: "review_reply", evidenceScope: "visible_tests" }),
        sequence: 2,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(reviewAt, 0.005),
      },
      {
        id: "guest-message-sliding-followup",
        sessionId: "guest-chat-sliding",
        role: "user",
        contentMarkdown: "So `left` represents the earliest valid index of the current window?",
        sequence: 3,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(reviewAt, 0.01),
      },
      {
        id: "guest-message-sliding-coach",
        sessionId: "guest-chat-sliding",
        role: "assistant",
        contentMarkdown: "Exactly. Once an index is excluded, a later character cannot make it valid again. That is why `left` may stay or move right, but never move left.",
        sequence: 4,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(reviewAt, 0.015),
      },
      {
        id: "guest-message-two-sum-user",
        sessionId: "guest-chat-two-sum",
        role: "user",
        contentMarkdown: "Please review the order of my complement lookup and insertion.",
        sequence: 1,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
      },
      {
        id: "guest-message-two-sum-review",
        sessionId: "guest-chat-two-sum",
        reviewAttemptId: "guest-review-two-sum",
        role: "assistant",
        contentMarkdown: "The selected visible cases pass, and lookup-before-insert prevents reusing the current index.",
        metadataJson: json({ type: "review_reply", evidenceScope: "visible_tests" }),
        sequence: 2,
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(successAt, 0.005),
      },
    ],
  });

  await prisma.problemWorkspaceSession.create({
    data: {
      id: "guest-workspace-sliding",
      userId: input.userId,
      problemId: slidingProblem.id,
      browserInstanceId: "guest-seed-browser",
      startTrigger: "campaign_task",
      captureLevel: "full",
      memoryOrigin: GUEST_ORIGIN,
      foregroundStatus: "ended",
      backgroundStatus: "complete",
      startedAt: reviewAt,
      lastActivityAt: addDays(reviewAt, 0.02),
      foregroundEndedAt: addDays(reviewAt, 0.02),
      endReason: "review_completed",
      settledAt: addDays(reviewAt, 0.02),
      createdAt: reviewAt,
      updatedAt: addDays(reviewAt, 0.02),
    },
  });

  await prisma.memoryActivityCluster.createMany({
    data: [
      {
        id: "guest-cluster-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        chatSessionId: "guest-chat-sliding",
        rootReviewAttemptId: "guest-review-sliding",
        clusterKind: "review",
        status: "sealed",
        sourceKey: "review:guest-review-sliding",
        memoryOrigin: GUEST_ORIGIN,
        startedAt: reviewAt,
        endedAt: addDays(reviewAt, 0.02),
        createdAt: reviewAt,
        updatedAt: addDays(reviewAt, 0.02),
      },
      {
        id: "guest-cluster-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        chatSessionId: "guest-chat-two-sum",
        rootReviewAttemptId: "guest-review-two-sum",
        clusterKind: "review",
        status: "sealed",
        sourceKey: "review:guest-review-two-sum",
        memoryOrigin: GUEST_ORIGIN,
        startedAt: successAt,
        endedAt: addDays(successAt, 0.02),
        createdAt: successAt,
        updatedAt: addDays(successAt, 0.02),
      },
    ],
  });

  await prisma.memoryActivityItem.createMany({
    data: [
      {
        id: "guest-item-sliding-review",
        activityClusterId: "guest-cluster-sliding",
        sourceType: "review_attempt",
        sourceId: "guest-review-sliding",
        ordinal: 1,
        role: "learner",
        occurredAt: reviewAt,
        contentHash: stableHash(slidingCode),
      },
      {
        id: "guest-item-sliding-chat",
        activityClusterId: "guest-cluster-sliding",
        sourceType: "chat_message",
        sourceId: "guest-message-sliding-followup",
        ordinal: 2,
        role: "user",
        occurredAt: addDays(reviewAt, 0.01),
        contentHash: stableHash("left represents earliest valid index"),
      },
      {
        id: "guest-item-two-sum-review",
        activityClusterId: "guest-cluster-two-sum",
        sourceType: "review_attempt",
        sourceId: "guest-review-two-sum",
        ordinal: 1,
        role: "learner",
        occurredAt: successAt,
        contentHash: stableHash(twoSumCode),
      },
    ],
  });

  await prisma.memoryExtractionReceipt.createMany({
    data: [
      {
        id: "guest-receipt-sliding",
        activityClusterId: "guest-cluster-sliding",
        extractorVersion: "guest-seed-v1",
        status: "completed",
        inputHash: stableHash("guest-cluster-sliding"),
        outputHash: stableHash("guest-episode-sliding"),
        startedAt: addDays(reviewAt, 0.02),
        completedAt: addDays(reviewAt, 0.021),
        createdAt: addDays(reviewAt, 0.02),
        updatedAt: addDays(reviewAt, 0.021),
      },
      {
        id: "guest-receipt-two-sum",
        activityClusterId: "guest-cluster-two-sum",
        extractorVersion: "guest-seed-v1",
        status: "completed",
        inputHash: stableHash("guest-cluster-two-sum"),
        outputHash: stableHash("guest-episode-two-sum"),
        startedAt: addDays(successAt, 0.02),
        completedAt: addDays(successAt, 0.021),
        createdAt: addDays(successAt, 0.02),
        updatedAt: addDays(successAt, 0.021),
      },
    ],
  });

  await prisma.memoryEpisode.createMany({
    data: [
      {
        id: "guest-episode-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        chatSessionId: "guest-chat-sliding",
        activityClusterId: "guest-cluster-sliding",
        kind: "review",
        title: "Sliding-window left boundary repair",
        summary: "The visible abba case exposed a left-boundary rollback. The learner connected left to the earliest valid index and repaired it with a monotonic max update.",
        outcome: "repair_identified",
        tags: json(["sliding-window", "boundary-invariant"]),
        salience: 0.9,
        sourceTraceIds: json(["guest-review-sliding", "guest-message-sliding-followup"]),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(reviewAt, 0.021),
      },
      {
        id: "guest-episode-two-sum",
        userId: input.userId,
        problemId: twoSumProblem.id,
        chatSessionId: "guest-chat-two-sum",
        activityClusterId: "guest-cluster-two-sum",
        kind: "review",
        title: "One-pass complement map confirmed",
        summary: "The learner used lookup-before-insert and passed the selected visible Two Sum cases.",
        outcome: "visible_cases_passed",
        tags: json(["hash-map", "complement-lookup"]),
        salience: 0.75,
        sourceTraceIds: json(["guest-review-two-sum"]),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(successAt, 0.021),
      },
    ],
  });

  await prisma.memoryClaimObservation.createMany({
    data: [
      {
        id: "guest-observation-sliding",
        userId: input.userId,
        activityClusterId: "guest-cluster-sliding",
        problemId: slidingProblem.id,
        episodeId: "guest-episode-sliding",
        claimType: "weakness",
        claimText: "The learner may let a sliding-window left boundary move backward after seeing an out-of-window duplicate.",
        polarity: "negative",
        scopeJson: json({ mechanism: "sliding_window_boundary" }),
        mechanismKeysJson: json(["sliding_window_boundary"]),
        source: "review_diagnosis",
        memoryOrigin: GUEST_ORIGIN,
        status: "materialized",
        claimFingerprint: stableHash("guest-sliding-window-boundary"),
        evidenceStrength: "observed",
        createdAt: addDays(reviewAt, 0.021),
        updatedAt: addDays(reviewAt, 0.021),
      },
      {
        id: "guest-observation-two-sum",
        userId: input.userId,
        activityClusterId: "guest-cluster-two-sum",
        problemId: twoSumProblem.id,
        episodeId: "guest-episode-two-sum",
        claimType: "strength",
        claimText: "The learner correctly orders complement lookup before map insertion in a one-pass hash-map solution.",
        polarity: "positive",
        scopeJson: json({ mechanism: "hashmap_complement_lookup" }),
        mechanismKeysJson: json(["hashmap_complement_lookup"]),
        source: "review_diagnosis",
        memoryOrigin: GUEST_ORIGIN,
        status: "materialized",
        claimFingerprint: stableHash("guest-hashmap-complement"),
        evidenceStrength: "observed",
        createdAt: addDays(successAt, 0.021),
        updatedAt: addDays(successAt, 0.021),
      },
    ],
  });

  await prisma.l2MemoryFact.createMany({
    data: [
      {
        id: "guest-fact-sliding",
        userId: input.userId,
        problemId: slidingProblem.id,
        sourceReviewAttemptId: "guest-review-sliding",
        factType: "weakness",
        tag: "sliding_window_left_boundary",
        label: "Sliding-window left boundary",
        value: "Needs a monotonic left-boundary invariant when duplicates fall outside the active window.",
        confidence: 0.72,
        evidenceCount: 1,
        lastEvidenceSummary: "Visible abba case returned 3 instead of 2.",
        lastSeenAt: reviewAt,
        status: "active",
        source: "claim_ledger",
        memoryOrigin: GUEST_ORIGIN,
        evidenceTraceIds: json(["guest-review-sliding"]),
        validationJson: json({
          authority: "visible_tests",
          independentEvidenceCount: 1,
          integrity: {
            version: 1,
            origin: "learner",
            subject: "learner_behavior",
            mechanism: "sliding_window_boundary",
            humanLabel: "Sliding-window left boundary",
            portability: "portable",
            promotionStatus: "trusted",
            evidenceClusters: [{
              key: "guest-cluster-sliding",
              problemId: slidingProblem.id,
              reviewAttemptId: "guest-review-sliding",
              revisionKey: stableHash(slidingCode),
              transition: "candidate_to_active",
              evidenceTraceIds: ["guest-review-sliding", "guest-run-sliding"],
            }],
          },
        }),
        clusterKey: "guest:sliding_window_left_boundary",
        claimText: "The learner may move a sliding-window left boundary backward.",
        polarity: "negative",
        scopeJson: json({ mechanism: "sliding_window_boundary" }),
        mechanismKeysJson: json(["sliding_window_boundary"]),
        createdAt: reviewAt,
        updatedAt: reviewAt,
      },
      {
        id: "guest-fact-hashmap",
        userId: input.userId,
        problemId: twoSumProblem.id,
        sourceReviewAttemptId: "guest-review-two-sum",
        factType: "strength",
        tag: "hashmap_complement_lookup",
        label: "Hash-map complement lookup",
        value: "Correctly checks the complement before inserting the current index.",
        confidence: 0.79,
        evidenceCount: 1,
        lastEvidenceSummary: "Selected Two Sum visible cases passed.",
        lastSeenAt: successAt,
        status: "active",
        source: "claim_ledger",
        memoryOrigin: GUEST_ORIGIN,
        evidenceTraceIds: json(["guest-review-two-sum"]),
        validationJson: json({
          authority: "visible_tests",
          independentEvidenceCount: 1,
          integrity: {
            version: 1,
            origin: "learner",
            subject: "learner_behavior",
            mechanism: "hashmap_complement_lookup",
            humanLabel: "Hash-map complement lookup",
            portability: "portable",
            promotionStatus: "trusted",
            evidenceClusters: [{
              key: "guest-cluster-two-sum",
              problemId: twoSumProblem.id,
              reviewAttemptId: "guest-review-two-sum",
              revisionKey: stableHash(twoSumCode),
              transition: "candidate_to_active",
              evidenceTraceIds: ["guest-review-two-sum", "guest-run-two-sum"],
            }],
          },
        }),
        clusterKey: "guest:hashmap_complement_lookup",
        claimText: "The learner correctly orders complement lookup before insertion.",
        polarity: "positive",
        scopeJson: json({ mechanism: "hashmap_complement_lookup" }),
        mechanismKeysJson: json(["hashmap_complement_lookup"]),
        createdAt: successAt,
        updatedAt: successAt,
      },
    ],
  });

  await prisma.memoryClaimRelation.createMany({
    data: [
      {
        id: "guest-relation-sliding",
        observationId: "guest-observation-sliding",
        targetClusterFactId: "guest-fact-sliding",
        relation: "supports",
        modelConfidence: 0.91,
        rationale: "The failed visible case directly demonstrates the boundary rollback.",
        status: "accepted",
        createdAt: addDays(reviewAt, 0.021),
        updatedAt: addDays(reviewAt, 0.021),
      },
      {
        id: "guest-relation-two-sum",
        observationId: "guest-observation-two-sum",
        targetClusterFactId: "guest-fact-hashmap",
        relation: "supports",
        modelConfidence: 0.88,
        rationale: "The code and selected visible evidence align on update ordering.",
        status: "accepted",
        createdAt: addDays(successAt, 0.021),
        updatedAt: addDays(successAt, 0.021),
      },
    ],
  });

  await prisma.memoryEvidenceContribution.createMany({
    data: [
      {
        id: "guest-contribution-sliding",
        observationId: "guest-observation-sliding",
        targetClusterFactId: "guest-fact-sliding",
        activityClusterId: "guest-cluster-sliding",
        problemId: slidingProblem.id,
        reviewAttemptId: "guest-review-sliding",
        contributionKey: "guest:sliding:review",
        evidenceRole: "support",
        transition: "candidate_to_active",
        authority: "visible_tests",
        revisionKey: stableHash(slidingCode),
        evidenceTraceIds: json(["guest-review-sliding", "guest-run-sliding"]),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(reviewAt, 0.021),
      },
      {
        id: "guest-contribution-two-sum",
        observationId: "guest-observation-two-sum",
        targetClusterFactId: "guest-fact-hashmap",
        activityClusterId: "guest-cluster-two-sum",
        problemId: twoSumProblem.id,
        reviewAttemptId: "guest-review-two-sum",
        contributionKey: "guest:two-sum:review",
        evidenceRole: "support",
        transition: "candidate_to_active",
        authority: "visible_tests",
        revisionKey: stableHash(twoSumCode),
        evidenceTraceIds: json(["guest-review-two-sum", "guest-run-two-sum"]),
        memoryOrigin: GUEST_ORIGIN,
        createdAt: addDays(successAt, 0.021),
      },
    ],
  });

  await prisma.l1MemoryEvent.createMany({
    data: [
      {
        id: "guest-l1-sliding-review",
        userId: input.userId,
        problemId: slidingProblem.id,
        chatSessionId: "guest-chat-sliding",
        reviewAttemptId: "guest-review-sliding",
        eventType: "review_attempt",
        eventJson: json({ status: "failed", evidenceScope: "visible_tests" }),
        content: "Sliding-window boundary review",
        source: "review",
        memoryOrigin: GUEST_ORIGIN,
        occurredAt: reviewAt,
        createdAt: reviewAt,
      },
      {
        id: "guest-l1-sliding-chat",
        userId: input.userId,
        problemId: slidingProblem.id,
        chatSessionId: "guest-chat-sliding",
        eventType: "chat_user_message",
        eventJson: json({ sequence: 3 }),
        content: "So left represents the earliest valid index of the current window?",
        source: "chat",
        memoryOrigin: GUEST_ORIGIN,
        occurredAt: addDays(reviewAt, 0.01),
        createdAt: addDays(reviewAt, 0.01),
      },
      {
        id: "guest-l1-two-sum-review",
        userId: input.userId,
        problemId: twoSumProblem.id,
        chatSessionId: "guest-chat-two-sum",
        reviewAttemptId: "guest-review-two-sum",
        eventType: "review_attempt",
        eventJson: json({ status: "passed_visible_tests", evidenceScope: "visible_tests" }),
        content: "Two Sum complement-map review",
        source: "review",
        memoryOrigin: GUEST_ORIGIN,
        occurredAt: successAt,
        createdAt: successAt,
      },
    ],
  });

  await prisma.synthesisSlot.createMany({
    data: [
      {
        id: "guest-synthesis-strength",
        userId: input.userId,
        slot: "strengths",
        synthesisKey: "hashmap_update_order",
        text: "Uses hash-map complement lookup with a sound lookup-before-insert invariant.",
        evidenceFactIds: json(["guest-fact-hashmap"]),
        confidence: 0.78,
        status: "active",
        memoryOrigin: GUEST_ORIGIN,
        createdAt: successAt,
        updatedAt: successAt,
      },
      {
        id: "guest-synthesis-weakness",
        userId: input.userId,
        slot: "weakness_patterns",
        synthesisKey: "sliding_window_boundary",
        text: "Needs to keep the sliding-window left boundary monotonic after out-of-window repeats.",
        evidenceFactIds: json(["guest-fact-sliding"]),
        confidence: 0.72,
        status: "active",
        memoryOrigin: GUEST_ORIGIN,
        createdAt: reviewAt,
        updatedAt: reviewAt,
      },
    ],
  });

  await prisma.knowledgeNote.create({
    data: {
      id: "guest-note-window-invariant",
      userId: input.userId,
      conceptKey: "sliding-window-left-monotonic",
      title: "Sliding-window left boundary",
      snippet: "left = max(left, last_seen[char] + 1)",
      whenToUse: "When the repeated character may be outside the current window.",
      category: "algorithm_pattern",
      lookupCount: 2,
      firstNeededAt: reviewAt,
      lastNeededAt: addDays(reviewAt, 0.02),
      status: "active",
      source: "coach",
      sourceTraceIds: json(["guest-review-sliding"]),
      createdAt: reviewAt,
      updatedAt: addDays(reviewAt, 0.02),
    },
  });

  await prisma.mistakeBookEntry.create({
    data: {
      id: "guest-mistake-sliding",
      userId: input.userId,
      problemId: slidingProblem.id,
      chatSessionId: "guest-chat-sliding",
      reviewAttemptId: "guest-review-sliding",
      title: "Do not roll a sliding-window boundary backward",
      guideMarkdown: "Trace whether the duplicate index is still inside the active window. Preserve `left` with `max` before recomputing the length.",
      selfCheckQuestion: "Can a character seen before left invalidate the current window?",
      selfCheckAnswer: "No. It is already outside the active window.",
      tags: json(["sliding-window", "boundary-invariant"]),
      sourceTraceIds: json(["guest-review-sliding"]),
      firstSavedAt: addDays(reviewAt, 0.02),
      lastSavedAt: addDays(reviewAt, 0.02),
      createdAt: addDays(reviewAt, 0.02),
      updatedAt: addDays(reviewAt, 0.02),
    },
  });

  return {
    slidingProblem,
    reviewAt,
  };
}

async function seedCampaign(
  prisma: PrismaClient,
  input: {
    userId: string;
    now: Date;
    reviewAt: Date;
    slidingProblemId: string;
  },
) {
  const campaignDate = formatCampaignDate(input.now, GUEST_TIMEZONE);
  const unlockedAt = addDays(input.now, -30);
  const masteredAt = addDays(input.now, -14);
  const mastered = new Set(["N1", "N2", "N4"]);
  const locked = new Set(["N13", "N17", "N20"]);

  await prisma.campaign.create({
    data: {
      id: "guest-campaign",
      userId: input.userId,
      status: "active",
      activeOwnerKey: input.userId,
      creationKey: stableHash("guest-campaign-seed-v1"),
      activeSkeletonVersion: 1,
      createdAt: addDays(input.now, -35),
      updatedAt: input.now,
      goal: {
        create: {
          id: "guest-campaign-goal",
          endDate: addDays(input.now, 90),
          dailyQuestionBudget: 5,
          language: "Python",
          timezone: GUEST_TIMEZONE,
          selfReportedWeakNodesJson: json(["N9", "N10", "N19"]),
          preferredNodesJson: json(["N2", "N12"]),
          createdAt: addDays(input.now, -35),
          updatedAt: input.now,
        },
      },
      skeletons: {
        create: {
          id: "guest-skeleton-v1",
          version: 1,
          mixedWindowDays: genericCampaignSkeleton.mixedWindowDays,
          createdAt: addDays(input.now, -35),
          nodePlans: {
            create: genericCampaignSkeleton.nodePlans.map((plan) => ({
              id: `guest-plan-${plan.nodeId.toLowerCase()}`,
              nodeId: plan.nodeId,
              included: true,
              sortOrder: plan.order,
              targetWeek: plan.targetWeek,
              targetByDate: dateOnly(addDays(input.now, plan.targetWeek * 14)),
              goalDepth: "mastery",
              priority: plan.nodeId === "N9" ? 90 : plan.nodeId === "N10" ? 80 : plan.priority,
              rationale:
                plan.nodeId === "N9"
                  ? "Prioritize a demonstrated sliding-window boundary weakness."
                  : plan.rationale,
            })),
          },
        },
      },
      learnerNodeStates: {
        create: genericCampaignSkeleton.nodePlans.map((plan) => ({
          id: `guest-state-${plan.nodeId.toLowerCase()}`,
          nodeId: plan.nodeId,
          exposureState: mastered.has(plan.nodeId)
            ? "internally_attempted"
            : plan.nodeId === "N9"
              ? "internally_attempted"
              : "unknown",
          masteryState: mastered.has(plan.nodeId) ? "mastered" : "learning",
          masteryHealth:
            plan.nodeId === "N9"
              ? "needs_reinforcement"
              : plan.nodeId === "N4"
                ? "watch"
                : "stable",
          unlockedAt: locked.has(plan.nodeId) ? null : unlockedAt,
          startedAt:
            mastered.has(plan.nodeId) || plan.nodeId === "N9"
              ? addDays(input.now, -24)
              : null,
          masteredAt: mastered.has(plan.nodeId) ? masteredAt : null,
          latestPositiveStreak: mastered.has(plan.nodeId) ? 2 : 0,
          latestSettlementIdsJson: "[]",
          createdAt: addDays(input.now, -35),
          updatedAt: input.now,
        })),
      },
    },
  });

  const historyDate = formatCampaignDate(input.reviewAt, GUEST_TIMEZONE);
  await prisma.campaignDailyTask.create({
    data: {
      id: "guest-history-task",
      campaignId: "guest-campaign",
      campaignDate: historyDate,
      budget: 3,
      primaryNodeId: "N9",
      status: "completed",
      selectionMetadataJson: json({ selectorVersion: "guest-seed-v1", skeletonVersion: 1 }),
      createdAt: input.reviewAt,
      updatedAt: addDays(input.reviewAt, 0.02),
      items: {
        create: {
          id: "guest-history-task-item",
          problemSlug: "longest-substring-without-repeating-characters",
          nodeId: "N9",
          slotRole: "target",
          exposureType: "never_seen",
          sortOrder: 1,
          status: "completed",
          createdAt: input.reviewAt,
          updatedAt: addDays(input.reviewAt, 0.02),
        },
      },
    },
  });

  await prisma.campaignTaskItemAttempt.create({
    data: {
      id: "guest-campaign-attempt-sliding",
      taskItemId: "guest-history-task-item",
      workspaceSessionId: "guest-workspace-sliding",
      reviewAttemptId: "guest-review-sliding",
      codeRevision: stableHash("guest-review-sliding"),
      executionFingerprint: stableHash("guest-run-sliding"),
      selectedSuiteFingerprint: stableHash("guest-suite-abba"),
      evidenceProblemSlug: "longest-substring-without-repeating-characters",
      evidenceSubject: "current_revision",
      evidenceScope: "selected_visible_tests",
      evidenceClass: "local_visible",
      evidenceAuthority: "visible_tests",
      evidenceCanVerdict: true,
      verdict: "failed",
      startedAt: input.reviewAt,
      completedAt: addDays(input.reviewAt, 0.02),
      createdAt: input.reviewAt,
      updatedAt: addDays(input.reviewAt, 0.02),
    },
  });

  await prisma.campaignTaskItemSettlement.create({
    data: {
      id: "guest-settlement-sliding",
      taskItemId: "guest-history-task-item",
      attemptId: "guest-campaign-attempt-sliding",
      reviewCompleted: true,
      passed: false,
      selfRating: "hard",
      positiveForMastery: false,
      negativeOutcome: true,
      settledAt: addDays(input.reviewAt, 0.02),
      settlementVersion: 1,
      evidenceSource: "review",
      evidenceReferenceId: "guest-run-sliding",
      evidenceClass: "local_visible",
      evidenceAuthority: "visible_tests",
      evidenceScope: "selected_visible_tests",
      evidenceSubject: "current_revision",
      createdAt: addDays(input.reviewAt, 0.02),
    },
  });

  await prisma.campaignTaskReceipt.create({
    data: {
      id: "guest-history-task-receipt",
      taskId: "guest-history-task",
      campaignId: "guest-campaign",
      campaignDate: historyDate,
      status: "completed",
      plannedCount: 1,
      settledCount: 1,
      itemsJson: json([{ taskItemId: "guest-history-task-item", status: "completed" }]),
      createdAt: addDays(input.reviewAt, 0.02),
      updatedAt: addDays(input.reviewAt, 0.02),
    },
  });

  await prisma.campaignRepairQueueItem.create({
    data: {
      id: "guest-active-repair",
      campaignId: "guest-campaign",
      nodeId: "N9",
      triggerTaskItemId: "guest-history-task-item",
      reason: "target_negative",
      priority: 95,
      status: "pending",
      createdAt: addDays(input.reviewAt, 0.02),
      updatedAt: addDays(input.reviewAt, 0.02),
    },
  });

  await new CampaignCoreService(prisma, { now: () => input.now }).getOrCreateDailyTask({
    campaignId: "guest-campaign",
    campaignDate,
  });

  await new CampaignSkeletonPatchService(prisma, { now: () => input.now })
    .createSkeletonPatchProposal({
      userId: input.userId,
      campaignId: "guest-campaign",
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "guest_seed_future_route",
        rationale: "Move one-dimensional DP earlier while preserving today's materialized task.",
        operations: [
          { type: "set_node_priority", nodeId: "N19", priority: 85 },
          { type: "set_target_by_date", nodeId: "N19", targetByDate: dateOnly(addDays(input.now, 45)) },
        ],
        dateBudgetSuggestions: [],
      },
    });

  return { campaignDate };
}

function indexGuestMemory(databaseUrl: string, userId: string) {
  const store = createFtsStore(resolveSqliteFilePath(databaseUrl));
  try {
    store.reconcileMemoryDocuments({
      kind: "episode",
      learnerId: userId,
      documents: [
        {
          refId: "guest-episode-sliding",
          content: "Sliding-window left boundary repair. Keep left monotonic after out-of-window duplicates.",
        },
        {
          refId: "guest-episode-two-sum",
          content: "One-pass hash-map complement lookup before insertion passed selected visible cases.",
        },
      ],
    });
    store.reconcileMemoryDocuments({
      kind: "fact",
      learnerId: userId,
      documents: [
        {
          refId: "guest-fact-sliding",
          content: "Sliding-window left boundary must remain monotonic.",
        },
        {
          refId: "guest-fact-hashmap",
          content: "Hash-map complement lookup before insertion is a learner strength.",
        },
      ],
    });
  } finally {
    store.close();
  }
}

export async function seedGuestDatabase(prisma: PrismaClient, databaseUrl: string) {
  await seedDatabase(prisma, { profile: guestProfile });
  const [guest, iris] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { handle: GUEST_HANDLE } }),
    prisma.user.findUnique({ where: { handle: "Iris904" } }),
  ]);
  if (iris) throw new Error("Guest database must not contain Iris904.");

  const now = new Date();
  const examples = await seedReviewAndMemoryExamples(prisma, {
    userId: guest.id,
    now,
  });
  const campaign = await seedCampaign(prisma, {
    userId: guest.id,
    now,
    reviewAt: examples.reviewAt,
    slidingProblemId: examples.slidingProblem.id,
  });
  indexGuestMemory(databaseUrl, guest.id);

  return {
    userId: guest.id,
    campaignDate: campaign.campaignDate,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the guest seed.");
  assertLocalDatabaseProfileEnvironment({ configuredDatabaseUrl: databaseUrl });
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
  try {
    await seedGuestDatabase(prisma, databaseUrl);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
