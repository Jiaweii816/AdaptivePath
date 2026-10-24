import type { MistakeBookEntry, PrismaClient } from "@prisma/client";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import type { MemoryOrigin } from "@/server/memory/memory-origin";

const BANNED_ENTRY_TEXT = ["structured json", "evidence-only", "did not return"];

export type CoachMistakeBookEntryInput = {
  title: string;
  guideMarkdown: string;
  selfCheckQuestion?: string | null;
  selfCheckAnswer?: string | null;
  tags?: string[];
};

type MistakeBookEntryPrisma = Pick<PrismaClient, "mistakeBookEntry">;

export function isCleanCoachMistakeBookEntry(
  entry: Pick<CoachMistakeBookEntryInput, "title" | "guideMarkdown">,
) {
  const title = entry.title.trim();
  const guideMarkdown = entry.guideMarkdown.trim();
  if (!title || !guideMarkdown) {
    return false;
  }

  const text = `${title}\n${guideMarkdown}`.toLowerCase();
  return !BANNED_ENTRY_TEXT.some((needle) => text.includes(needle));
}

export async function upsertMistakeBookEntryFromCoach(
  prisma: MistakeBookEntryPrisma,
  args: {
    userId: string;
    problemId: string;
    chatSessionId?: string | null;
    reviewAttemptId?: string | null;
    entry: CoachMistakeBookEntryInput;
    traceId: string;
    memoryOrigin: MemoryOrigin;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const cleaned = normalizeCoachEntry(args.entry);
  if (!isCleanCoachMistakeBookEntry(cleaned)) {
    return { saved: false as const, reason: "title or guide empty or contained banned content" };
  }

  const existing = await prisma.mistakeBookEntry.findUnique({
    where: {
      userId_problemId: {
        userId: args.userId,
        problemId: args.problemId,
      },
    },
  });

  if (!existing) {
    const entry = await createCoachEntry(prisma, {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId,
      reviewAttemptId: args.reviewAttemptId,
      entry: cleaned,
      traceId: args.traceId,
      memoryOrigin: args.memoryOrigin,
      now,
    });
    return { saved: true as const, entry };
  }

  if (existing.memoryOrigin !== args.memoryOrigin) {
    return { saved: false as const, reason: "cross-origin mistake-book update denied" };
  }

  const entry = await updateCoachEntry(prisma, existing, {
    chatSessionId: args.chatSessionId,
    reviewAttemptId: args.reviewAttemptId,
    entry: cleaned,
    traceId: args.traceId,
    memoryOrigin: args.memoryOrigin,
    now,
  });
  return { saved: true as const, entry };
}

export async function listMistakeBookEntriesForNotebook(
  prisma: MistakeBookEntryPrisma,
  userId: string,
) {
  return prisma.mistakeBookEntry.findMany({
    where: { userId },
    include: { problem: true },
    orderBy: [{ lastSavedAt: "desc" }, { id: "asc" }],
  });
}

function normalizeCoachEntry(
  entry: CoachMistakeBookEntryInput,
): Required<CoachMistakeBookEntryInput> {
  return {
    title: entry.title.trim(),
    guideMarkdown: entry.guideMarkdown.trim(),
    selfCheckQuestion: cleanOptional(entry.selfCheckQuestion),
    selfCheckAnswer: cleanOptional(entry.selfCheckAnswer),
    tags: normalizeEntryTags(entry.tags ?? []),
  };
}

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function normalizeEntryTags(tags: string[]) {
  return [...new Set(tags.map(normalizeMemoryTag).filter(Boolean))].slice(0, 8);
}

async function createCoachEntry(
  prisma: MistakeBookEntryPrisma,
  args: {
    userId: string;
    problemId: string;
    chatSessionId?: string | null;
    reviewAttemptId?: string | null;
    entry: Required<CoachMistakeBookEntryInput>;
    traceId: string;
    memoryOrigin: MemoryOrigin;
    now: Date;
  },
) {
  return prisma.mistakeBookEntry.create({
    data: {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId ?? null,
      reviewAttemptId: args.reviewAttemptId ?? null,
      title: args.entry.title,
      guideMarkdown: args.entry.guideMarkdown,
      selfCheckQuestion: args.entry.selfCheckQuestion,
      selfCheckAnswer: args.entry.selfCheckAnswer,
      tags: JSON.stringify(args.entry.tags),
      saveCount: 1,
      sourceTraceIds: JSON.stringify([args.traceId]),
      memoryOrigin: args.memoryOrigin,
      firstSavedAt: args.now,
      lastSavedAt: args.now,
    },
  });
}

async function updateCoachEntry(
  prisma: MistakeBookEntryPrisma,
  existing: MistakeBookEntry,
  args: {
    chatSessionId?: string | null;
    reviewAttemptId?: string | null;
    entry: Required<CoachMistakeBookEntryInput>;
    traceId: string;
    memoryOrigin: MemoryOrigin;
    now: Date;
  },
) {
  return prisma.mistakeBookEntry.update({
    where: { id: existing.id },
    data: {
      chatSessionId: args.chatSessionId ?? existing.chatSessionId,
      reviewAttemptId: args.reviewAttemptId ?? existing.reviewAttemptId,
      title: args.entry.title,
      guideMarkdown: args.entry.guideMarkdown,
      selfCheckQuestion: args.entry.selfCheckQuestion,
      selfCheckAnswer: args.entry.selfCheckAnswer,
      tags: JSON.stringify(args.entry.tags),
      saveCount: existing.saveCount + 1,
      sourceTraceIds: appendTraceId(existing.sourceTraceIds, args.traceId),
      lastSavedAt: args.now,
    },
  });
}

function appendTraceId(existing: string, traceId: string) {
  try {
    const parsed = JSON.parse(existing) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
    return JSON.stringify([...new Set([...ids, traceId])]);
  } catch {
    return JSON.stringify([traceId]);
  }
}
