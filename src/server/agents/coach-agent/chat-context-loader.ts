import type { PrismaClient } from "@prisma/client";
import prisma from "@/server/db/prisma";
import type { CoachReviewContext } from "./coach-agent.types";
import type { StoredChatMessageForProjection } from "./history-projection";
import {
  buildWorkspaceCodeRevision,
  sameWorkspaceCodeRevision,
  type WorkspaceCodeRevision,
} from "./workspace-revision";

const STORED_HISTORY_SCAN_LIMIT = 8;

type ContextLoaderPrisma = Pick<
  PrismaClient,
  "chatMessage" | "reviewAttempt" | "algorithmHintProgress"
>;

export type LatestReviewAlignment =
  | "matches_current_revision"
  | "different_revision"
  | "unknown_revision"
  | "no_review";

export type LatestReviewProjection = {
  context?: CoachReviewContext;
  alignment: LatestReviewAlignment;
};

export async function loadStoredRecentMessages(
  chatSessionId: string,
  clearedBeforeSequence: number,
  db: Pick<ContextLoaderPrisma, "chatMessage"> = prisma,
): Promise<StoredChatMessageForProjection[]> {
  const messages = await db.chatMessage.findMany({
    where: {
      sessionId: chatSessionId,
      sequence: { gt: clearedBeforeSequence },
      role: { in: ["user", "assistant"] },
    },
    include: {
      reviewAttempt: { select: { language: true, codeSnapshot: true } },
    },
    orderBy: { sequence: "desc" },
    take: STORED_HISTORY_SCAN_LIMIT,
  });

  return messages.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    role: message.role as "user" | "assistant",
    contentMarkdown: message.contentMarkdown,
    metadataJson: message.metadataJson,
    reviewAttemptId: message.reviewAttemptId,
    reviewAttempt: message.reviewAttempt,
  }));
}

export async function loadLatestReviewProjection(
  args: {
    userId: string;
    problemId: string;
    chatSessionId: string;
    currentRevision?: WorkspaceCodeRevision;
  },
  db: Pick<ContextLoaderPrisma, "reviewAttempt"> = prisma,
): Promise<LatestReviewProjection> {
  const latestReview = await loadLatestReview(args, db);
  if (!latestReview) {
    return { alignment: "no_review" };
  }

  const revision = resolveReviewRevision(latestReview, args.problemId);
  if (!args.currentRevision || !revision) {
    return { alignment: "unknown_revision" };
  }
  if (!sameWorkspaceCodeRevision(revision, args.currentRevision)) {
    return { alignment: "different_revision" };
  }

  return {
    alignment: "matches_current_revision",
    context: buildReviewContext(latestReview),
  };
}

export async function loadCurrentHintLevel(
  args: { userId: string; problemId: string },
  db: Pick<ContextLoaderPrisma, "algorithmHintProgress"> = prisma,
) {
  const hintProgress = await db.algorithmHintProgress.findUnique({
    where: {
      userId_problemId: {
        userId: args.userId,
        problemId: args.problemId,
      },
    },
  });

  return hintProgress?.currentLevel ?? 0;
}

async function loadLatestReview(
  args: { userId: string; problemId: string; chatSessionId: string },
  db: Pick<ContextLoaderPrisma, "reviewAttempt">,
) {
  return db.reviewAttempt.findFirst({
    where: {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId,
    },
    orderBy: { createdAt: "desc" },
    include: {
      diagnosisResult: true,
      problem: true,
      problemHistories: { orderBy: { createdAt: "desc" }, take: 1 },
      runEvidences: {
        where: { source: "review" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

type LoadedReview = NonNullable<Awaited<ReturnType<typeof loadLatestReview>>>;

function resolveReviewRevision(
  review: LoadedReview,
  problemId: string,
): WorkspaceCodeRevision | undefined {
  const runCodeHash = review.runEvidences[0]?.codeHash;
  if (runCodeHash) {
    return { problemId, codeHash: runCodeHash };
  }
  return buildWorkspaceCodeRevision({
    problemId,
    language: review.language,
    code: review.codeSnapshot,
  });
}

function buildReviewContext(review: LoadedReview): CoachReviewContext {
  const diagnosis = parseRecord(review.diagnosisResult?.diagnosisJson);
  const history = review.problemHistories[0];
  const runEvidence = review.runEvidences[0];
  const mistakeTags =
    readStringArray(diagnosis.mistakeTags) ??
    parseStringArray(review.diagnosisResult?.mistakeTags);
  const skillTags =
    readStringArray(diagnosis.skillTags) ??
    parseStringArray(review.diagnosisResult?.skillTags);

  return {
    reviewAttemptId: review.id,
    problemSlug: review.problem.slug,
    runStatus:
      readString(diagnosis.runStatus) ??
      history?.runStatus ??
      runEvidence?.status ??
      "unknown",
    failedCaseSummary:
      history?.failedCaseSummary ?? summarizeRunEvidence(runEvidence),
    userIssueSummary:
      history?.userIssueSummary ??
      review.diagnosisResult?.userIssueSummary ??
      readString(diagnosis.userIssueSummary),
    coachSummary:
      history?.coachSummary ??
      review.diagnosisResult?.coachSummary ??
      readString(diagnosis.coachSummary),
    mistakeTags,
    skillTags,
    currentConcept:
      readString(diagnosis.currentConcept) ??
      readString(diagnosis.current_concept) ??
      skillTags[0],
    suspiciousLine:
      readString(diagnosis.suspiciousLine) ??
      readString(diagnosis.suspicious_line),
    stuckLayer:
      readString(diagnosis.stuckLayer) ?? readString(diagnosis.stuck_layer),
  };
}

function summarizeRunEvidence(
  evidence: LoadedReview["runEvidences"][number] | undefined,
) {
  if (!evidence) return undefined;
  const label = parseRecord(evidence.firstFailedCaseJson).label;
  const caseLabel = readString(label) ?? "latest review case";
  if (evidence.actualOutput || evidence.expectedOutput) {
    return `${caseLabel}: expected ${evidence.expectedOutput ?? "unknown"}, actual ${evidence.actualOutput ?? "unknown"}`;
  }
  return `${evidence.status}: ${evidence.passedCount} passed, ${evidence.failedCount} failed`;
}

function parseRecord(value: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null | undefined) {
  try {
    return readStringArray(JSON.parse(value ?? "[]")) ?? [];
  } catch {
    return [];
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}
