import type { Prisma } from "@prisma/client";
import type { MemoryOrigin } from "@/server/memory/memory-origin";
import type { CodeRunResult, CodeRunnerLanguage } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";
import type { CoachReviewPlannerContext } from "./coach-agent.types";
import type { buildWorkspaceMetadata } from "./current-workspace-context";
import { getNextChatSequence } from "./review-context";
import { runResultWithEvidenceVerdict } from "./review-non-verdict";
import {
  summarizeFailedCase,
  summarizeMemoryCandidate,
  summarizeNextRecommendation,
} from "./review-summaries";

const json = (value: unknown) => JSON.stringify(value);

export type ReviewRecordArgs = {
  userId: string;
  problem: { id: string; slug: string; title: string };
  tags: string[];
  chatSessionId: string;
  codeDraftId: string;
  language: CodeRunnerLanguage;
  code: string;
  userState?: string;
  userQuestion?: string;
  activeSeconds?: number;
  selectedTestCaseIds: string[];
  selectedTestsJson: unknown;
  codeHash: string;
  executionFingerprint: string;
  runResult: CodeRunResult;
  evidenceVerdict: EvidenceVerdict;
  coachResult: CoachReviewResult;
  sanitizedSelfCheck: CoachReviewResult["diagnosis"]["selfCheck"];
  plannerContext?: CoachReviewPlannerContext;
  workspaceMetadata: ReturnType<typeof buildWorkspaceMetadata>;
  memoryOrigin: MemoryOrigin;
};

export async function createReviewRecords(
  tx: Prisma.TransactionClient,
  args: ReviewRecordArgs,
  onReviewAttemptCreated?: (reviewAttemptId: string) => void,
) {
  const reviewAttempt = await createReviewAttempt(tx, args);
  onReviewAttemptCreated?.(reviewAttempt.id);
  const runEvidence = await createRunEvidence(tx, args, reviewAttempt.id);
  const diagnosisResult = await createDiagnosisResult(tx, args, reviewAttempt.id);
  const problemHistory = await createProblemHistory(tx, args, reviewAttempt.id);
  const assistantReviewMessage = await appendAssistantReviewMessage(tx, args, {
    reviewAttemptId: reviewAttempt.id,
    problemHistoryId: problemHistory.id,
  });
  return {
    reviewAttempt,
    runEvidence,
    diagnosisResult,
    problemHistory,
    assistantReviewMessage,
  };
}

function createReviewAttempt(tx: Prisma.TransactionClient, args: ReviewRecordArgs) {
  return tx.reviewAttempt.create({
    data: {
      userId: args.userId,
      problemId: args.problem.id,
      chatSessionId: args.chatSessionId,
      codeDraftId: args.codeDraftId,
      language: args.language,
      userState: args.userState,
      userQuestion: args.userQuestion,
      codeSnapshot: args.code,
      selectedTestCaseIds: json(args.selectedTestCaseIds),
      selectedTestsJson: json(args.selectedTestsJson),
      coachReplyMarkdown: args.coachResult.coachReply,
      memoryOrigin: args.memoryOrigin,
    },
  });
}

function createRunEvidence(
  tx: Prisma.TransactionClient,
  args: ReviewRecordArgs,
  reviewAttemptId: string,
) {
  return tx.runEvidence.create({
    data: {
      reviewAttemptId,
      chatSessionId: args.chatSessionId,
      source: "review",
      codeHash: args.codeHash,
      executionFingerprint: args.executionFingerprint,
      status: args.runResult.status,
      passedCount: args.runResult.passedCount,
      failedCount: args.runResult.failedCount,
      durationMs: args.runResult.durationMs,
      stdout: args.runResult.stdout,
      stderr: args.runResult.stderr,
      actualOutput: args.runResult.actualOutput,
      expectedOutput: args.runResult.expectedOutput,
      firstFailedCaseJson: args.runResult.firstFailedCase
        ? json(args.runResult.firstFailedCase)
        : null,
      rawResultJson: json(
        runResultWithEvidenceVerdict(args.runResult, args.evidenceVerdict),
      ),
      memoryOrigin: args.memoryOrigin,
    },
  });
}

function createDiagnosisResult(
  tx: Prisma.TransactionClient,
  args: ReviewRecordArgs,
  reviewAttemptId: string,
) {
  return tx.diagnosisResult.create({
    data: {
      reviewAttemptId,
      diagnosisJson: json(args.coachResult.diagnosis),
      memoryUpdateCandidateJson: json(
        args.coachResult.diagnosis.memoryUpdateCandidate,
      ),
      mistakeTags: json(args.coachResult.diagnosis.mistakeTags),
      skillTags: json(args.coachResult.diagnosis.skillTags),
      userIssueSummary: args.coachResult.diagnosis.userIssueSummary,
      coachSummary: args.coachResult.diagnosis.coachSummary,
      selfCheckQuestion: args.sanitizedSelfCheck?.question ?? null,
      selfCheckAnswer: args.sanitizedSelfCheck?.answer ?? null,
    },
  });
}

function createProblemHistory(
  tx: Prisma.TransactionClient,
  args: ReviewRecordArgs,
  reviewAttemptId: string,
) {
  return tx.problemHistory.create({
    data: {
      userId: args.userId,
      problemId: args.problem.id,
      reviewAttemptId,
      chatSessionId: args.chatSessionId,
      language: args.language,
      userState: args.userState,
      problemTags: json(args.tags),
      runStatus: args.runResult.status,
      failedCaseSummary: summarizeFailedCase(args.runResult, args.evidenceVerdict),
      userIssueSummary: args.coachResult.diagnosis.userIssueSummary,
      coachSummary: args.coachResult.diagnosis.coachSummary,
      memoryUpdateSummary: summarizeMemoryCandidate(args.coachResult.diagnosis),
      nextRecommendation: summarizeNextRecommendation({
        runResult: args.runResult,
        evidenceVerdict: args.evidenceVerdict,
        planner: args.plannerContext,
      }),
      durationSeconds: args.activeSeconds ?? null,
      memoryOrigin: args.memoryOrigin,
    },
  });
}

async function appendAssistantReviewMessage(
  db: Pick<Prisma.TransactionClient, "chatMessage">,
  args: ReviewRecordArgs,
  ids: { reviewAttemptId: string; problemHistoryId: string },
) {
  const sequence = await getNextChatSequence(args.chatSessionId, db);
  return db.chatMessage.create({
    data: {
      sessionId: args.chatSessionId,
      reviewAttemptId: ids.reviewAttemptId,
      role: "assistant",
      contentMarkdown: args.coachResult.coachReply,
      sequence,
      memoryOrigin: args.memoryOrigin,
      metadataJson: json({
        type: "review_reply",
        runStatus: args.runResult.status,
        evidenceVerdict: args.evidenceVerdict,
        problemHistoryId: ids.problemHistoryId,
        degraded: args.coachResult.degraded ?? null,
        workspace: args.workspaceMetadata,
      }),
    },
  });
}
