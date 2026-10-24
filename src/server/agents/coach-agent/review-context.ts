import type { PrismaClient } from "@prisma/client";
import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { getOrFetchProblem } from "@/server/problems/hot150-problem-cache";
import { hasLeetCodeSession } from "@/server/tools/leetcode-api/lc-api-client";
import { findNextTodayDoseItem } from "@/server/planner/planner-service";
import type { CodeRunTestCase } from "@/types/code-runner";
import type {
  CoachProblemContext,
  CoachReviewPlannerContext,
  CoachUserContext,
} from "./coach-agent.types";
import { ReviewPipelineError } from "./review-pipeline-contract";

type ChatSequencePrisma = Pick<PrismaClient, "chatMessage">;

export function parseJson<T>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getLocalUserAndProfile(
  db: Pick<PrismaClient, "user" | "userProfile"> = prisma,
) {
  const user = await db.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });
  const storedProfile = await db.userProfile.findUnique({
    where: { userId: user.id },
  });

  return {
    user,
    profile: {
      displayName: storedProfile?.displayName ?? irisDefaultProfile.displayName,
      preferredLanguages: storedProfile
        ? parseJson<string[]>(storedProfile.preferredLanguages, [])
        : [...irisDefaultProfile.preferredLanguages],
      strongPatterns: storedProfile
        ? parseJson<string[]>(storedProfile.strongPatterns, [])
        : [...irisDefaultProfile.strongPatterns],
      weakPatterns: storedProfile
        ? parseJson<string[]>(storedProfile.weakPatterns, [])
        : [...irisDefaultProfile.weakPatterns],
      explanationStyle: storedProfile
        ? parseJson<string[]>(storedProfile.explanationStyle, [])
        : [...irisDefaultProfile.explanationStyle],
      outputPreferences: storedProfile
        ? parseJson<string[]>(storedProfile.outputPreferences, [])
        : [...irisDefaultProfile.outputPreferences],
    },
  };
}

export async function getDemoProblem(
  input: { problemId?: string; problemSlug?: string },
  db: Pick<PrismaClient, "problem"> = prisma,
) {
  const problem = await db.problem.findFirst({
    where: {
      OR: [
        input.problemId ? { id: input.problemId } : undefined,
        input.problemSlug ? { slug: input.problemSlug } : undefined,
      ].filter(Boolean) as Array<{ id: string } | { slug: string }>,
    },
  });
  if (!problem) throw new ReviewPipelineError("Problem was not found.", 404);
  if (!problem.statementMarkdown.trim() && hasLeetCodeSession()) {
    return getOrFetchProblem(problem.slug);
  }
  return problem;
}

export function buildCoachProblemContext(
  problem: Awaited<ReturnType<typeof getDemoProblem>>,
  tags = parseJson<string[]>(problem.tags, []),
): CoachProblemContext {
  return {
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: problem.leetcodeNumber,
    tags,
    methodName: problem.methodName,
    statementMarkdown: problem.statementMarkdown,
  };
}

export function buildCoachUserContext(
  profile: Awaited<ReturnType<typeof getLocalUserAndProfile>>["profile"],
): CoachUserContext {
  return {
    displayName: profile.displayName,
    strongPatterns: profile.strongPatterns,
    weakPatterns: profile.weakPatterns,
    outputPreferences: profile.outputPreferences,
  };
}

export async function buildReviewPlannerContext(args: {
  userId: string;
  currentProblemId: string;
  currentPlanItemId?: string;
}): Promise<CoachReviewPlannerContext | undefined> {
  const nextTodayItem = await findNextTodayDoseItem({
    userId: args.userId,
    currentPlanItemId: args.currentPlanItemId,
    currentProblemId: args.currentProblemId,
  });
  if (!args.currentPlanItemId && !nextTodayItem) return undefined;
  return {
    currentPlanItemId: args.currentPlanItemId,
    nextTodayItem: nextTodayItem
      ? {
          planItemId: nextTodayItem.planItemId,
          slug: nextTodayItem.slug,
          title: nextTodayItem.title,
          leetcodeNumber: nextTodayItem.leetcodeNumber,
          source: nextTodayItem.source,
        }
      : undefined,
  };
}

export function inferResponseLanguage(args: {
  explicit?: "zh" | "en";
  userQuestion?: string;
  explanationStyle: string[];
  outputPreferences: string[];
}): "zh" | "en" {
  const userQuestion = args.userQuestion?.trim();
  if (userQuestion) return /[\u3400-\u9fff]/.test(userQuestion) ? "zh" : "en";
  if (args.explicit) return args.explicit;
  const preferences = [
    ...args.explanationStyle,
    ...args.outputPreferences,
  ].join(" ");
  return /Chinese|中文|汉语/i.test(preferences) ? "zh" : "en";
}

export async function loadLatestVisibleUserMessageForReview(
  db: PrismaClient,
  args: { userId: string; problemId: string },
) {
  const memoryOrigin = resolveMemoryOrigin();
  const session = await db.chatSession.findUnique({
    where: {
      userId_problemId_memoryOrigin: {
        userId: args.userId,
        problemId: args.problemId,
        memoryOrigin,
      },
    },
    select: { id: true, clearedBeforeSequence: true },
  });
  if (!session) return undefined;
  const message = await db.chatMessage.findFirst({
    where: {
      sessionId: session.id,
      role: "user",
      memoryOrigin,
      sequence: { gt: session.clearedBeforeSequence },
    },
    orderBy: { sequence: "desc" },
    select: { contentMarkdown: true },
  });
  return message?.contentMarkdown;
}

export async function loadSelectedVisibleTests(
  args: {
    problemId: string;
    userId: string;
    selectedTestCaseIds: string[];
  },
  db: Pick<PrismaClient, "problemTestCase"> = prisma,
): Promise<CodeRunTestCase[]> {
  const selectedIds = Array.from(new Set(args.selectedTestCaseIds));
  if (selectedIds.length === 0) return [];
  const testCases = await db.problemTestCase.findMany({
    where: {
      id: { in: selectedIds },
      problemId: args.problemId,
      isVisible: true,
      OR: [{ userId: null }, { userId: args.userId }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return testCases.map((testCase) => ({
    id: testCase.id,
    label: testCase.label,
    input: parseJson(testCase.inputJson, null),
    expected: parseJson(testCase.expectedJson, null),
    source: testCase.source,
  }));
}

export async function getNextChatSequence(
  chatSessionId: string,
  db: ChatSequencePrisma = prisma,
) {
  const aggregate = await db.chatMessage.aggregate({
    where: { sessionId: chatSessionId },
    _max: { sequence: true },
  });
  return (aggregate._max.sequence ?? 0) + 1;
}
