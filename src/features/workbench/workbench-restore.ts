import type { PrismaClient } from "@prisma/client";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";
import { resolveLearnerActivityLedgerOrigins } from "@/server/memory/memory-origin";
import type { WorkbenchLanguage } from "./types";
import { buildWorkbenchHref, isWorkbenchLanguage } from "./workbench-context";

type WorkbenchRestoreDb = PrismaClient;

type RestoreCandidate = {
  language?: WorkbenchLanguage;
  planItemId?: string;
  priority: number;
  problemId: string;
  problemSlug: string;
  updatedAt: Date;
};

export type RestoredWorkbenchContext = {
  href: string;
  language: WorkbenchLanguage;
  planItemId?: string;
  problemSlug: string;
  updatedAt: Date;
};

function parsePreferredLanguage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.find(isWorkbenchLanguage) ?? null;
  } catch {
    return null;
  }
}

function candidateTimestamp(value: Date | null | undefined) {
  return value?.getTime() ?? 0;
}

function compareCandidates(a: RestoreCandidate, b: RestoreCandidate) {
  const timeDelta = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return b.priority - a.priority;
}

function latestDate(...dates: Array<Date | null | undefined>) {
  return dates
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];
}

async function findActivePlanItemForProblem(
  db: WorkbenchRestoreDb,
  input: { problemId: string; userId: string },
) {
  const items = await db.plannerPlanItem.findMany({
    where: {
      problemId: input.problemId,
      status: { notIn: ["completed", "replaced"] },
      userId: input.userId,
      OR: [{ lastOpenedAt: { not: null } }, { startedAt: { not: null } }],
    },
    select: {
      id: true,
      lastOpenedAt: true,
      startedAt: true,
      updatedAt: true,
    },
  });

  return items.sort((a, b) => {
    const openedDelta =
      candidateTimestamp(b.lastOpenedAt) - candidateTimestamp(a.lastOpenedAt);
    if (openedDelta !== 0) {
      return openedDelta;
    }

    const startedDelta =
      candidateTimestamp(b.startedAt) - candidateTimestamp(a.startedAt);
    if (startedDelta !== 0) {
      return startedDelta;
    }

    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

async function latestDraftLanguageForProblem(
  db: WorkbenchRestoreDb,
  input: { problemId: string; userId: string },
) {
  const draft = await db.codeDraft.findFirst({
    where: {
      problemId: input.problemId,
      userId: input.userId,
    },
    orderBy: { updatedAt: "desc" },
    select: { language: true },
  });

  return isWorkbenchLanguage(draft?.language) ? draft.language : null;
}

export async function resolveLastWorkbenchContext(
  options: { db?: WorkbenchRestoreDb } = {},
): Promise<RestoredWorkbenchContext | null> {
  const db = options.db ?? prisma;
  const user = await db.user.findUnique({ where: { handle: irisHandle } });

  if (!user) {
    return null;
  }

  const [profile, planItems, drafts, chatSessions] = await Promise.all([
    db.userProfile.findUnique({
      where: { userId: user.id },
      select: { preferredLanguages: true },
    }),
    db.plannerPlanItem.findMany({
      where: {
        userId: user.id,
        status: { notIn: ["completed", "replaced"] },
        OR: [{ lastOpenedAt: { not: null } }, { startedAt: { not: null } }],
      },
      include: { problem: true },
    }),
    db.codeDraft.findMany({
      where: { userId: user.id },
      include: { problem: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    db.chatSession.findMany({
      where: {
        userId: user.id,
        memoryOrigin: { in: resolveLearnerActivityLedgerOrigins() },
      },
      include: { problem: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);

  const candidates: RestoreCandidate[] = [
    ...planItems
      .map((item): RestoreCandidate | null => {
        const updatedAt = latestDate(item.lastOpenedAt, item.startedAt);
        if (!updatedAt) {
          return null;
        }

        return {
          planItemId: item.id,
          priority: 3,
          problemId: item.problemId,
          problemSlug: item.problem.slug,
          updatedAt,
        };
      })
      .filter((item): item is RestoreCandidate => Boolean(item)),
    ...drafts.map((draft) => ({
      language: isWorkbenchLanguage(draft.language) ? draft.language : undefined,
      priority: 2,
      problemId: draft.problemId,
      problemSlug: draft.problem.slug,
      updatedAt: draft.updatedAt,
    })),
    ...chatSessions.map((session) => ({
      language: isWorkbenchLanguage(session.primaryLanguage)
        ? session.primaryLanguage
        : undefined,
      priority: 1,
      problemId: session.problemId,
      problemSlug: session.problem.slug,
      updatedAt: session.updatedAt,
    })),
  ].sort(compareCandidates);

  const candidate = candidates[0];
  if (!candidate) {
    return null;
  }

  const activePlanItem = candidate.planItemId
    ? { id: candidate.planItemId }
    : await findActivePlanItemForProblem(db, {
        problemId: candidate.problemId,
        userId: user.id,
      });
  const language =
    candidate.language ??
    (await latestDraftLanguageForProblem(db, {
      problemId: candidate.problemId,
      userId: user.id,
    })) ??
    parsePreferredLanguage(profile?.preferredLanguages) ??
    "Python";
  const planItemId = activePlanItem?.id;

  return {
    href: buildWorkbenchHref({
      language,
      planItemId,
      problemSlug: candidate.problemSlug,
    }),
    language,
    planItemId,
    problemSlug: candidate.problemSlug,
    updatedAt: candidate.updatedAt,
  };
}
