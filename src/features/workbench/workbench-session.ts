import { irisHandle } from "@/features/onboarding/profile-defaults";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import prisma from "@/server/db/prisma";
import {
  classifyExecutionEvidence,
  readEvidenceVerdict,
} from "@/lib/evidence-trust";
import {
  formatEvidenceSource,
  formatRunnerProvider,
  readProviderUsed,
} from "@/server/tools/code-runner/evidence-metadata";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import type { CoachDiagnosis } from "@/types/coach";
import { sanitizeToolProtocolText } from "@/server/llm/tool-protocol-leak";
import {
  codeRunResultSchema,
  type CodeRunResult,
  type CodeRunnerLanguage,
} from "@/types/code-runner";
import type {
  WorkbenchActionOutcome,
  WorkbenchChatTurn,
  WorkbenchReviewResult,
  WorkbenchSession,
} from "./types";

type ReviewAttemptInput = {
  id: string;
  coachReplyMarkdown: string | null;
  diagnosisJson: string;
  language: CodeRunnerLanguage;
  selectedTestCaseIds: string;
  rawResultJson: string;
  problemHistoryId: string | null;
};

type MessageInput = {
  id: string;
  role: string;
  contentMarkdown: string;
  reviewAttemptId: string | null;
  sequence: number;
  metadataJson?: string;
};

const FALLBACK_RUN_RESULT: CodeRunResult = {
  status: "runner_error",
  passedCount: 0,
  failedCount: 0,
  stdout: "",
  stderr: "",
  testResults: [],
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseRunResultJson(value: string): CodeRunResult {
  const parsed = codeRunResultSchema.safeParse(parseJson<unknown>(value, null));

  return parsed.success
    ? attachCodeRunErrorDetail(parsed.data)
    : FALLBACK_RUN_RESULT;
}

export function buildWorkbenchSession(args: {
  chatSessionId: string;
  problem: { id: string; slug: string; title: string };
  reviewAttempts: ReviewAttemptInput[];
  messages: MessageInput[];
}): WorkbenchSession {
  const { chatSessionId, problem, reviewAttempts, messages } = args;

  const reviewById = new Map(
    reviewAttempts.map((attempt) => {
      const runResult = parseRunResultJson(attempt.rawResultJson);
      const selectedTestCaseIds = parseJson<string[]>(
        attempt.selectedTestCaseIds,
        [],
      );
      const providerUsed = readProviderUsed(runResult);
      const evidenceVerdict = evidenceVerdictForRunResult(runResult);

      return [
        attempt.id,
        {
          coachReply: attempt.coachReplyMarkdown ?? "",
          evidence: {
            source: "review" as const,
            language: attempt.language,
            selectedTestCaseIds,
            runnerProvider: formatRunnerProvider(providerUsed),
            evidenceSource: formatEvidenceSource(providerUsed),
            evidenceVerdict,
            runResult,
          },
          runResult,
        },
      ] as const;
    }),
  );

  const chatTurns: WorkbenchChatTurn[] = [];
  for (const message of [...messages].sort((a, b) => a.sequence - b.sequence)) {
    if (message.role === "user") {
      chatTurns.push({
        id: message.id,
        role: "user",
        content: message.contentMarkdown,
      });
      continue;
    }

    if (message.role !== "assistant") {
      continue;
    }

    const review = message.reviewAttemptId
      ? reviewById.get(message.reviewAttemptId)
      : undefined;

    if (review) {
      chatTurns.push({
        id: message.id,
        role: "review",
        content: message.contentMarkdown,
        evidence: review.evidence,
        runResult: review.runResult,
      });
    } else {
      const metadata = parseJson<{ actionOutcomes?: unknown }>(
        message.metadataJson ?? "{}",
        {},
      );
      const actionOutcomes = readActionOutcomes(metadata.actionOutcomes);
      chatTurns.push({
        id: message.id,
        role: "assistant",
        content: sanitizeToolProtocolText(message.contentMarkdown).text,
        ...(actionOutcomes.length > 0 ? { actionOutcomes } : {}),
      });
    }
  }

  const latest = reviewAttempts[0] ?? null;
  const latestRunResult = latest
    ? parseRunResultJson(latest.rawResultJson)
    : null;
  const latestSelectedTestCaseIds = latest
    ? parseJson<string[]>(latest.selectedTestCaseIds, [])
    : [];
  const latestProviderUsed = latestRunResult
    ? readProviderUsed(latestRunResult)
    : undefined;
  const latestEvidenceVerdict = latestRunResult
    ? evidenceVerdictForRunResult(latestRunResult)
    : undefined;
  const latestReview: WorkbenchReviewResult | null = latest
    ? {
        ok: true,
        problem,
        chatSessionId,
        reviewAttemptId: latest.id,
        problemHistoryId: latest.problemHistoryId ?? "",
        runResult: latestRunResult ?? FALLBACK_RUN_RESULT,
        evidence: {
          source: "review",
          language: latest.language,
          selectedTestCaseIds: latestSelectedTestCaseIds,
          runnerProvider: formatRunnerProvider(latestProviderUsed),
          evidenceSource: formatEvidenceSource(latestProviderUsed),
          evidenceVerdict: latestEvidenceVerdict,
          runResult: latestRunResult ?? FALLBACK_RUN_RESULT,
        },
        diagnosis: parseJson<CoachDiagnosis>(
          latest.diagnosisJson,
          {} as CoachDiagnosis,
        ),
        coachReply: latest.coachReplyMarkdown ?? "",
      }
    : null;

  return { chatSessionId, latestReview, chatTurns };
}

function evidenceVerdictForRunResult(runResult: CodeRunResult) {
  return (
    readEvidenceVerdict(rawResultRecord(runResult.rawResult).evidenceVerdict) ??
    classifyExecutionEvidence(runResult, {
      consumer: "history",
      providerUsed: readProviderUsed(runResult),
    })
  );
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadWorkbenchSession(
  problemId: string,
): Promise<WorkbenchSession | null> {
  const user = await prisma.user.findUnique({ where: { handle: irisHandle } });
  if (!user) return null;

  const session = await prisma.chatSession.findUnique({
    where: {
      userId_problemId_memoryOrigin: {
        userId: user.id,
        problemId,
        memoryOrigin: resolveMemoryOrigin(),
      },
    },
    include: {
      problem: true,
      messages: { orderBy: { sequence: "asc" } },
      reviewAttempts: {
        orderBy: { createdAt: "desc" },
        include: {
          runEvidences: { where: { source: "review" }, take: 1 },
          diagnosisResult: true,
          problemHistories: { take: 1 },
        },
      },
    },
  });
  if (!session) return null;

  const visibleMessages = session.messages.filter(
    (message) => message.sequence > session.clearedBeforeSequence,
  );

  return buildWorkbenchSession({
    chatSessionId: session.id,
    problem: {
      id: session.problem.id,
      slug: session.problem.slug,
      title: session.problem.title,
    },
    reviewAttempts: session.reviewAttempts.map((attempt) => ({
      id: attempt.id,
      coachReplyMarkdown: attempt.coachReplyMarkdown,
      diagnosisJson: attempt.diagnosisResult?.diagnosisJson ?? "{}",
      language: attempt.language as CodeRunnerLanguage,
      selectedTestCaseIds: attempt.selectedTestCaseIds,
      rawResultJson: attempt.runEvidences[0]?.rawResultJson ?? "{}",
      problemHistoryId: attempt.problemHistories[0]?.id ?? null,
    })),
    messages: visibleMessages.map((message) => ({
      id: message.id,
      role: message.role,
      contentMarkdown: message.contentMarkdown,
      reviewAttemptId: message.reviewAttemptId,
      sequence: message.sequence,
      metadataJson: message.metadataJson,
    })),
  });
}

function readActionOutcomes(value: unknown): WorkbenchActionOutcome[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is WorkbenchActionOutcome => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const candidate = entry as Record<string, unknown>;
    return (
      (candidate.toolName === "note_memory" ||
        candidate.toolName === "save_knowledge_note" ||
        candidate.toolName === "save_mistake_book_entry") &&
      (candidate.status === "completed" ||
        candidate.status === "failed" ||
        candidate.status === "unfulfilled") &&
      typeof candidate.displayName === "string" &&
      typeof candidate.message === "string"
    );
  });
}
