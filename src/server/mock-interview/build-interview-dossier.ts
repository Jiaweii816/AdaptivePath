import type { PrismaClient } from "@prisma/client";
import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import type { InterviewDossier } from "@/server/agents/interviewer-agent/interviewer-agent.types";

export async function buildInterviewDossier(
  prisma: PrismaClient,
  args: {
    userId: string;
    targetLabel?: string;
    focusTags: string[];
    responseLanguage?: "zh" | "en";
  },
): Promise<InterviewDossier> {
  const memoryOrigin = resolveMemoryOrigin();
  const [user, profile, facts, histories, activeGoal] = await Promise.all([
    prisma.user.findUnique({ where: { id: args.userId } }),
    prisma.userProfile.findUnique({ where: { userId: args.userId } }),
    prisma.l2MemoryFact.findMany({
      where: {
        userId: args.userId,
        memoryOrigin: "learner",
        status: { in: ["active", "improving", "validated"] },
      },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.problemHistory.findMany({
      where: { userId: args.userId, memoryOrigin },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.readinessGoal.findFirst({
      where: { userId: args.userId, status: "active" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const strongPatterns = profile
    ? parseStringArray(profile.strongPatterns)
    : irisDefaultProfile.strongPatterns;
  const weakPatterns = profile
    ? parseStringArray(profile.weakPatterns)
    : irisDefaultProfile.weakPatterns;
  const outputPreferences = profile
    ? parseStringArray(profile.outputPreferences)
    : irisDefaultProfile.outputPreferences;
  const trustedFacts = facts.filter(isTrustedL2FactForConsumption).slice(0, 40);
  const semanticFacts = trustedFacts.map((fact) => ({
    fact,
    semantics: readLearnerClaimSemantics(fact),
  }));
  const skillFacts = semanticFacts.filter(
    ({ semantics }) => semantics.polarity === "positive",
  );
  const weakFacts = semanticFacts.filter(
    ({ semantics }) => semantics.polarity === "negative",
  );
  const solvedFacts = trustedFacts.filter((fact) => fact.factType === "solved");
  const historyTags = histories.flatMap((history) =>
    parseStringArray(history.problemTags),
  );

  return {
    displayName: profile?.displayName ?? user?.handle ?? irisHandle,
    targetLabel: args.targetLabel ?? activeGoal?.targetLabel ?? undefined,
    focusTags: unique(args.focusTags.map(normalizeMemoryTag)),
    strongSignals: unique([
      ...skillFacts.map(({ semantics }) => semantics.statement),
      ...strongPatterns.map((pattern) => `Self-reported: ${pattern}`),
    ]).slice(0, 8),
    weakSignals: unique([
      ...weakFacts.map(({ semantics }) => semantics.statement),
      ...weakPatterns.map((pattern) => `Self-reported: ${pattern}`),
    ]).slice(0, 8),
    recentMistakes: weakFacts
      .map(({ semantics }) => semantics.statement)
      .slice(0, 6),
    solvedTags: unique([
      ...solvedFacts.map((fact) => fact.tag),
      ...historyTags.map(normalizeMemoryTag),
    ]).slice(0, 8),
    latestReadinessGoal: activeGoal
      ? `${activeGoal.targetLabel}, interview date ${activeGoal.interviewDate.toISOString().slice(0, 10)}`
      : undefined,
    languagePreference:
      args.responseLanguage ??
      (/Chinese|中文|汉语/i.test(outputPreferences.join(" ")) ? "zh" : "en"),
  };
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
