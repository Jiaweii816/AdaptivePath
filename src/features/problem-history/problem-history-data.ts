import { irisHandle } from "@/features/onboarding/profile-defaults";
import { runStatusKind } from "@/lib/ui-status";
import { englishSystemText } from "@/lib/system-copy";
import prisma from "@/server/db/prisma";
import { resolveLearnerActivityLedgerOrigins } from "@/server/memory/memory-origin";
import { safeStoredMemoryTeachingText } from "@/server/memory/store/episode-store";
import {
  loadGrowthStats,
  type GrowthStats,
} from "@/server/growth/growth-stats";

export type ProblemHistoryAttempt = {
  id: string;
  reviewAttemptId: string;
  chatSessionId: string;
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    difficulty: string | null;
  };
  createdAt: Date;
  language: string;
  userState: string | null;
  tags: string[];
  runStatus: string;
  failedCaseSummary: string | null;
  userIssueSummary: string | null;
  durationSeconds: number | null;
  hasFlashcard: boolean;
};

export type ProblemHistoryGroup = {
  problem: ProblemHistoryAttempt["problem"];
  latest: ProblemHistoryAttempt;
  attempts: ProblemHistoryAttempt[];
  firstAcAttemptCount: number | null;
};

export type ProblemHistoryStatusFilter = "all" | "passed" | "failed";

export type ProblemHistoryPageData = {
  groups: ProblemHistoryGroup[];
  growth: GrowthStats;
  filters: {
    problem: string;
    tag: string;
    status: ProblemHistoryStatusFilter;
  };
  availableTags: string[];
};

export const OLD_ATTEMPT_CUTOFF_DAYS = 90;

export function filterAttemptsByStatus(
  attempts: ProblemHistoryAttempt[],
  status: ProblemHistoryStatusFilter,
): ProblemHistoryAttempt[] {
  if (status === "all") return attempts;
  return attempts.filter((a) => runStatusKind(a.runStatus) === status);
}

export function groupProblemHistoryAttempts(
  attempts: ProblemHistoryAttempt[],
): ProblemHistoryGroup[] {
  const byProblemId = new Map<string, ProblemHistoryAttempt[]>();

  for (const attempt of attempts) {
    byProblemId.set(attempt.problem.id, [
      ...(byProblemId.get(attempt.problem.id) ?? []),
      attempt,
    ]);
  }

  return [...byProblemId.values()]
    .map((group) => {
      const sorted = sortAttemptsDesc(group);
      return {
        problem: sorted[0].problem,
        latest: sorted[0],
        attempts: sorted,
        firstAcAttemptCount: firstAcAttemptCount(sorted),
      };
    })
    .sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime());
}

export function splitAttemptsByAge(
  attempts: ProblemHistoryAttempt[],
  now: Date = new Date(),
) {
  const cutoff = now.getTime() - OLD_ATTEMPT_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  return {
    recent: attempts.filter((attempt) => attempt.createdAt.getTime() >= cutoff),
    older: attempts.filter((attempt) => attempt.createdAt.getTime() < cutoff),
  };
}

export async function getProblemHistoryPageData(filters: {
  problem?: string;
  tag?: string;
  status?: ProblemHistoryStatusFilter;
}): Promise<ProblemHistoryPageData> {
  const ledgerOrigins = resolveLearnerActivityLedgerOrigins();
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });
  const [histories, growth] = await Promise.all([
    prisma.problemHistory.findMany({
      where: { userId: user.id, memoryOrigin: { in: ledgerOrigins } },
      include: {
        problem: true,
        reviewAttempt: { include: { diagnosisResult: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
    loadGrowthStats(prisma, user.id),
  ]);
  const attempts = histories.map<ProblemHistoryAttempt>((history) => {
    const tags = parseJson<string[]>(history.problemTags, []);
    const diagnosis = history.reviewAttempt.diagnosisResult;

    return {
      id: history.id,
      reviewAttemptId: history.reviewAttemptId,
      chatSessionId: history.chatSessionId,
      problem: {
        id: history.problem.id,
        slug: history.problem.slug,
        title: history.problem.title,
        leetcodeNumber: history.problem.leetcodeNumber,
        difficulty: history.problem.difficulty,
      },
      createdAt: history.createdAt,
      language: history.language,
      userState: history.userState,
      tags,
      runStatus: history.runStatus,
      failedCaseSummary: history.failedCaseSummary,
      userIssueSummary: problemHistoryIssueSummary(
        history.userIssueSummary,
      ),
      durationSeconds: history.durationSeconds,
      hasFlashcard: Boolean(
        diagnosis?.selfCheckQuestion && diagnosis.selfCheckAnswer,
      ),
    };
  });
  const status: ProblemHistoryStatusFilter = filters.status ?? "all";
  const textFiltered = filterAttempts(attempts, filters);
  const filteredAttempts = filterAttemptsByStatus(textFiltered, status);

  return {
    groups: groupProblemHistoryAttempts(filteredAttempts),
    growth,
    filters: {
      problem: filters.problem?.trim() ?? "",
      tag: filters.tag?.trim() ?? "",
      status,
    },
    availableTags: unique(attempts.flatMap((attempt) => attempt.tags)).sort(),
  };
}

function firstAcAttemptCount(attempts: ProblemHistoryAttempt[]) {
  const chronological = [...attempts].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const index = chronological.findIndex(
    (attempt) => runStatusKind(attempt.runStatus) === "passed",
  );
  return index < 0 ? null : index + 1;
}

function sortAttemptsDesc(attempts: ProblemHistoryAttempt[]) {
  return [...attempts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function filterAttempts(
  attempts: ProblemHistoryAttempt[],
  filters: { problem?: string; tag?: string },
) {
  const problemFilter = normalize(filters.problem ?? "");
  const tagFilter = normalize(filters.tag ?? "");

  return attempts.filter((attempt) => {
    const matchesProblem =
      !problemFilter ||
      [
        attempt.problem.title,
        attempt.problem.slug,
        attempt.problem.leetcodeNumber?.toString() ?? "",
      ]
        .map(normalize)
        .some((value) => value.includes(problemFilter));
    const matchesTag =
      !tagFilter || attempt.tags.map(normalize).includes(tagFilter);

    return matchesProblem && matchesTag;
  });
}

function normalize(value: string) {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function problemHistoryIssueSummary(
  summary: string | null,
) {
  const safeSummary = safeStoredMemoryTeachingText(summary);
  if (!safeSummary) {
    return null;
  }
  return englishSystemText(safeSummary, "Review issue recorded for this attempt.");
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
