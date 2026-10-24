import type { Prisma } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  appendL1TraceEvents,
  type AppendL1TraceEventInput,
} from "@/server/memory/l1-trace/append-trace";
import type { CodeRunResult, CodeRunnerLanguage } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";

type ReviewL1Args = {
  userId: string;
  problem: { id: string; title: string };
  chatSessionId: string;
  reviewAttemptId: string;
  runEvidenceId: string;
  diagnosisResultId: string;
  assistantMessageId: string;
  problemHistoryId: string;
  language: CodeRunnerLanguage;
  userState?: string;
  userQuestion?: string;
  codeLength: number;
  codeHash: string;
  executionFingerprint: string;
  selectedTestCaseIds: string[];
  selectedTestsJson: unknown;
  runResult: CodeRunResult;
  evidenceVerdict: EvidenceVerdict;
  coachResult: CoachReviewResult;
  pathStartedAt: number;
  occurredAt: {
    reviewAttempt: Date;
    runEvidence: Date;
    diagnosis: Date;
    coachReply: Date;
  };
  traceContext?: TraceContext;
};

export function appendReviewL1Events(
  tx: Prisma.TransactionClient,
  args: ReviewL1Args,
) {
  return appendL1TraceEvents(tx, [
    reviewAttemptEvent(args),
    runEvidenceEvent(args),
    diagnosisEvent(args),
    coachReplyEvent(args),
  ]);
}

function baseEvent(args: ReviewL1Args) {
  return {
    userId: args.userId,
    problemId: args.problem.id,
    chatSessionId: args.chatSessionId,
    reviewAttemptId: args.reviewAttemptId,
    source: "review_pipeline",
  } as const;
}

function reviewAttemptEvent(args: ReviewL1Args): AppendL1TraceEventInput {
  return {
    ...baseEvent(args),
    eventType: "review_attempt",
    occurredAt: args.occurredAt.reviewAttempt,
    content:
      args.userQuestion ??
      args.userState ??
      `Review My Code for ${args.problem.title}`,
    eventJson: {
      traceRunId: args.traceContext?.traceRunId,
      reviewAttemptId: args.reviewAttemptId,
      language: args.language,
      userState: args.userState,
      userQuestion: args.userQuestion,
      codeSnapshotLength: args.codeLength,
      codeHash: args.codeHash,
      executionFingerprint: args.executionFingerprint,
      selectedTestCaseIds: args.selectedTestCaseIds,
      selectedTests: args.selectedTestsJson,
      evidenceVerdict: args.evidenceVerdict,
    },
  };
}

function runEvidenceEvent(args: ReviewL1Args): AppendL1TraceEventInput {
  return {
    ...baseEvent(args),
    eventType: "run_evidence",
    occurredAt: args.occurredAt.runEvidence,
    content: `${args.runResult.status}: ${args.runResult.passedCount} passed, ${args.runResult.failedCount} failed`,
    eventJson: {
      traceRunId: args.traceContext?.traceRunId,
      runEvidenceId: args.runEvidenceId,
      codeHash: args.codeHash,
      executionFingerprint: args.executionFingerprint,
      status: args.runResult.status,
      passedCount: args.runResult.passedCount,
      failedCount: args.runResult.failedCount,
      failureProvenance: args.runResult.failureProvenance,
      errorDetail: args.runResult.errorDetail,
      evidenceVerdict: args.evidenceVerdict,
      firstFailedCase: args.runResult.firstFailedCase,
      actualOutput: args.runResult.actualOutput,
      expectedOutput: args.runResult.expectedOutput,
    },
  };
}

function diagnosisEvent(args: ReviewL1Args): AppendL1TraceEventInput {
  return {
    ...baseEvent(args),
    eventType: "diagnosis",
    occurredAt: args.occurredAt.diagnosis,
    content: args.coachResult.diagnosis.userIssueSummary,
    eventJson: {
      traceRunId: args.traceContext?.traceRunId,
      diagnosisResultId: args.diagnosisResultId,
      diagnosis: args.coachResult.diagnosis,
    },
  };
}

function coachReplyEvent(args: ReviewL1Args): AppendL1TraceEventInput {
  return {
    ...baseEvent(args),
    eventType: "coach_reply",
    occurredAt: args.occurredAt.coachReply,
    content: args.coachResult.coachReply,
    eventJson: {
      traceRunId: args.traceContext?.traceRunId,
      chatMessageId: args.assistantMessageId,
      problemHistoryId: args.problemHistoryId,
      runStatus: args.runResult.status,
      evidenceVerdict: args.evidenceVerdict,
      degraded: args.coachResult.degraded ?? null,
      timings: {
        totalMs: Date.now() - args.pathStartedAt,
        runnerMs: args.traceContext?.runnerMs,
        llmMsTotal: args.traceContext?.llmMsTotal,
      },
    },
  };
}
