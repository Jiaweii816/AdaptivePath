import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import prisma from "@/server/db/prisma";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { listActiveSlots } from "@/server/memory/store/synthesis-store";
import { safeStoredMemoryTeachingText } from "@/server/memory/store/episode-store";

type StoredProfile = {
  displayName: string;
  interviewGoal: string | null;
  preferredLanguages: string;
  strongPatterns: string;
  weakPatterns: string;
  explanationStyle: string;
  outputPreferences: string;
};

export type ProfileSkillRow = {
  name: string;
  status: "Strong" | "Learning" | "Watch" | "Unobserved";
  source: string;
  confidence: number | null;
  evidenceCount: number;
  lastSeenAt: Date | null;
};

export type ProfileMistakeRow = {
  tag: string;
  label: string;
  confidence: number;
  evidenceCount: number;
  lastEvidenceSummary: string | null;
  lastSeenAt: Date;
  problemTitle: string | null;
};

export type EnglishCoachSummaryItem = {
  kind: "strength" | "momentum" | "focus" | "next";
  label: string;
  subject: string;
  detail: string;
};

export type ProfilePageData = {
  displayName: string;
  interviewGoal: string | null;
  preferredLanguages: string[];
  strongPatterns: string[];
  weakPatterns: string[];
  explanationStyle: string[];
  outputPreferences: string[];
  skillProfile: ProfileSkillRow[];
  commonMistakes: ProfileMistakeRow[];
  latestSynthesis: string | null;
  recentlyUpdatedFrom: {
    problemTitle: string;
    problemSlug: string;
    runStatus: string;
    memoryUpdateSummary: string | null;
    createdAt: Date;
  } | null;
};

export async function getProfilePageData(): Promise<ProfilePageData> {
  const memoryOrigin = resolveMemoryOrigin();
  const user = await prisma.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });

  const [storedProfile, memoryFacts, latestHistory, activeSlots] =
    await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId: user.id },
      }),
      prisma.l2MemoryFact.findMany({
        where: {
          userId: user.id,
          memoryOrigin: "learner",
          status: { in: ["active", "improving", "validated"] },
        },
        include: { problem: true },
        orderBy: [{ evidenceCount: "desc" }, { lastSeenAt: "desc" }],
      }),
      prisma.problemHistory.findFirst({
        where: { userId: user.id, memoryOrigin },
        include: { problem: true },
        orderBy: { createdAt: "desc" },
      }),
      listActiveSlots(prisma, { userId: user.id, take: 6 }),
    ]);

  const profile = normalizeProfile(storedProfile);
  const trustedMemoryFacts = memoryFacts
    .filter(isTrustedL2FactForConsumption)
    .slice(0, 80);
  const skillProfile = buildDynamicSkillProfile({
    strongPatterns: profile.strongPatterns,
    weakPatterns: profile.weakPatterns,
    memoryFacts: trustedMemoryFacts,
  });
  const commonMistakes = buildCommonMistakes(trustedMemoryFacts);

  return {
    ...profile,
    skillProfile,
    commonMistakes,
    latestSynthesis: formatLatestSynthesis(activeSlots),
    recentlyUpdatedFrom: latestHistory
      ? {
          problemTitle: latestHistory.problem.title,
          problemSlug: latestHistory.problem.slug,
          runStatus: latestHistory.runStatus,
          memoryUpdateSummary:
            safeStoredMemoryTeachingText(latestHistory.memoryUpdateSummary) ??
            null,
          createdAt: latestHistory.createdAt,
        }
      : null,
  };
}

export function buildCommonMistakes(
  facts: Array<{
    factType: string;
    tag: string;
    label: string | null;
    value?: string | null;
    claimText?: string | null;
    polarity?: string | null;
    scopeJson?: string | null;
    mechanismKeysJson?: string | null;
    integrityVersion?: number | null;
    confidence: number;
    evidenceCount: number;
    lastEvidenceSummary: string | null;
    lastSeenAt: Date;
    problem?: { title: string } | null;
  }>,
) {
  return facts
    .filter(
      (fact) => readLearnerClaimSemantics(fact).polarity === "negative",
    )
    .slice(0, 8)
    .map((fact) => {
      const semantics = readLearnerClaimSemantics(fact);
      return {
        tag: semantics.displayTopics[0] ?? fact.tag,
        label: semantics.statement,
        confidence: fact.confidence,
        evidenceCount: fact.evidenceCount,
        lastEvidenceSummary: fact.lastEvidenceSummary,
        lastSeenAt: fact.lastSeenAt,
        problemTitle: fact.problem?.title ?? null,
      } satisfies ProfileMistakeRow;
    });
}

export function formatLatestSynthesis(
  slots: Array<{ slot: string; text: string }>,
) {
  const lines = slots.flatMap((slot) => {
    const text = safeStoredMemoryTeachingText(slot.text);
    return text ? [`- **${titleizeTag(slot.slot)}**: ${text}`] : [];
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildEnglishCoachSummary(args: {
  skillProfile: ProfileSkillRow[];
  commonMistakes: ProfileMistakeRow[];
  hasSynthesis: boolean;
}): EnglishCoachSummaryItem[] {
  if (!args.hasSynthesis && args.skillProfile.length === 0) return [];

  const rankedStrengths = args.skillProfile
    .filter(
      (skill) =>
        skill.status === "Strong" &&
        skill.confidence !== null &&
        isEnglishDisplayText(skill.name),
    )
    .sort(compareProfileSignals);
  const rankedWatchAreas = args.skillProfile
    .filter(
      (skill) =>
        skill.status === "Watch" &&
        skill.confidence !== null &&
        isEnglishDisplayText(skill.name),
    )
    .sort(compareProfileSignals);
  const leadStrength = rankedStrengths[0];
  const leadWatchArea = rankedWatchAreas[0];
  const items: EnglishCoachSummaryItem[] = [];

  if (leadStrength) {
    items.push({
      kind: "strength",
      label: "Leading strength",
      subject: leadStrength.name,
      detail: `leads at ${formatConfidence(
        leadStrength.confidence ?? 0,
      )} across ${formatEvidenceCount(leadStrength.evidenceCount)}.`,
    });
  }

  if (rankedStrengths.length > 1) {
    const supportingName = rankedStrengths[1]!.name;
    items.push({
      kind: "momentum",
      label: "Positive momentum",
      subject: supportingName,
      detail: "is also trending strong.",
    });
  }

  if (leadWatchArea) {
    items.push({
      kind: "focus",
      label: "Watch area",
      subject: leadWatchArea.name,
      detail: `is the top focus area at ${formatConfidence(
        leadWatchArea.confidence ?? 0,
      )} across ${formatEvidenceCount(leadWatchArea.evidenceCount)}.`,
    });
    items.push({
      kind: "next",
      label: "Recommended next step",
      subject: leadWatchArea.name,
      detail: "needs one focused visible-test rerun.",
    });
  } else if (args.commonMistakes.length > 0) {
    items.push({
      kind: "focus",
      label: "Watch area",
      subject: `${args.commonMistakes.length} recurring mistake ${
        args.commonMistakes.length === 1 ? "pattern" : "patterns"
      }`,
      detail: `${
        args.commonMistakes.length === 1 ? "remains" : "remain"
      } active in your review history.`,
    });
  }

  return items.slice(0, 4);
}

function normalizeProfile(profile: StoredProfile | null | undefined) {
  return {
    displayName: profile?.displayName ?? irisDefaultProfile.displayName,
    interviewGoal: profile?.interviewGoal ?? irisDefaultProfile.interviewGoal,
    preferredLanguages: profile
      ? parseJson<string[]>(profile.preferredLanguages, [])
      : [...irisDefaultProfile.preferredLanguages],
    strongPatterns: profile
      ? parseJson<string[]>(profile.strongPatterns, [])
      : [...irisDefaultProfile.strongPatterns],
    weakPatterns: profile
      ? parseJson<string[]>(profile.weakPatterns, [])
      : [...irisDefaultProfile.weakPatterns],
    explanationStyle: profile
      ? parseJson<string[]>(profile.explanationStyle, [])
      : [...irisDefaultProfile.explanationStyle],
    outputPreferences: profile
      ? parseJson<string[]>(profile.outputPreferences, [])
      : [...irisDefaultProfile.outputPreferences],
  };
}

export function buildDynamicSkillProfile(args: {
  strongPatterns: string[];
  weakPatterns: string[];
  memoryFacts: Array<{
    factType: string;
    tag: string;
    label: string | null;
    value?: string | null;
    claimText?: string | null;
    polarity?: string | null;
    scopeJson?: string | null;
    mechanismKeysJson?: string | null;
    integrityVersion?: number | null;
    confidence: number;
    evidenceCount: number;
    lastSeenAt: Date;
  }>;
}): ProfileSkillRow[] {
  const earned = new Map<string, ProfileSkillRow>();
  for (const fact of args.memoryFacts) {
    const semantics = readLearnerClaimSemantics(fact);
    for (const topic of semantics.displayTopics) {
      const key = normalizeText(topic);
      const next: ProfileSkillRow = {
        name: titleizeTag(topic),
        status:
          semantics.polarity === "negative"
            ? "Watch"
            : semantics.polarity === "positive"
              ? "Strong"
              : "Learning",
        source: semantics.statement,
        confidence: fact.confidence,
        evidenceCount: fact.evidenceCount,
        lastSeenAt: fact.lastSeenAt,
      };
      const current = earned.get(key);
      if (!current || preferEarnedRow(next, current)) earned.set(key, next);
    }
  }

  const rows = [...earned.values()].sort(
    (left, right) =>
      (right.lastSeenAt?.getTime() ?? 0) - (left.lastSeenAt?.getTime() ?? 0) ||
      right.evidenceCount - left.evidenceCount,
  );
  const earnedKeys = new Set(earned.keys());
  for (const [pattern, status] of [
    ...args.strongPatterns.map((value) => [value, "Strong"] as const),
    ...args.weakPatterns.map((value) => [value, "Learning"] as const),
  ]) {
    const key = normalizeText(pattern);
    if (!key || earnedKeys.has(key)) continue;
    rows.push({
      name: pattern,
      status,
      source: "Self-reported onboarding profile",
      confidence: null,
      evidenceCount: 0,
      lastSeenAt: null,
    });
  }
  return rows;
}

function preferEarnedRow(next: ProfileSkillRow, current: ProfileSkillRow) {
  const rank = { Watch: 3, Strong: 2, Learning: 1, Unobserved: 0 } as const;
  return (
    rank[next.status] > rank[current.status] ||
    (rank[next.status] === rank[current.status] &&
      (next.lastSeenAt?.getTime() ?? 0) > (current.lastSeenAt?.getTime() ?? 0))
  );
}

function compareProfileSignals(
  left: ProfileSkillRow,
  right: ProfileSkillRow,
) {
  return (
    (right.confidence ?? 0) - (left.confidence ?? 0) ||
    right.evidenceCount - left.evidenceCount ||
    (right.lastSeenAt?.getTime() ?? 0) - (left.lastSeenAt?.getTime() ?? 0)
  );
}

function isEnglishDisplayText(value: string) {
  return value.trim().length > 0 && !/[^\x20-\x7E]/.test(value);
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}% confidence`;
}

function formatEvidenceCount(count: number) {
  return `${count} evidence ${count === 1 ? "point" : "points"}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

function titleizeTag(tag: string) {
  return tag
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
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
