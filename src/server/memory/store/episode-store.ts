import type { PrismaClient } from "@prisma/client";
import type { EpisodeOutcome } from "@/server/memory/memory.types";
import {
  resolveMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";
import {
  containsDevelopmentNoiseText,
  isBlockedDurableFactTag,
  isCodeShapeOnlyFactTag,
  redactDevelopmentNoiseText,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  enrichEpisodeFtsContent,
  isCollectionSearchTag,
  type ProblemSearchMetadata,
} from "./memory-document-content";

type EpisodePrisma = Pick<PrismaClient, "memoryEpisode">;

export type MemoryEpisodeInput = {
  id?: string;
  userId: string;
  problemId?: string;
  chatSessionId?: string;
  kind:
    | "review"
    | "chat_segment"
    | "recommendation"
    | "milestone"
    | "mock_interview"
    | "assisted_repair";
  title: string;
  summary: string;
  outcome: EpisodeOutcome;
  tags: string[];
  salience: number;
  sourceTraceIds: string[];
  memoryOrigin?: MemoryOrigin;
  createdAt?: Date;
};

export async function createMemoryEpisode(
  prisma: EpisodePrisma,
  input: MemoryEpisodeInput,
) {
  const sanitized = sanitizeMemoryEpisode(input);
  return prisma.memoryEpisode.create({
    data: {
      id: sanitized.id,
      userId: sanitized.userId,
      problemId: sanitized.problemId,
      chatSessionId: sanitized.chatSessionId,
      kind: sanitized.kind,
      title: sanitized.title,
      summary: sanitized.summary,
      outcome: sanitized.outcome,
      tags: JSON.stringify(sanitized.tags),
      salience: sanitized.salience,
      sourceTraceIds: JSON.stringify(sanitized.sourceTraceIds),
      memoryOrigin: sanitized.memoryOrigin ?? resolveMemoryOrigin(),
      createdAt: sanitized.createdAt,
    },
  });
}

export async function listRecentEpisodes(
  prisma: EpisodePrisma,
  args: {
    userId: string;
    kind?: string;
    limit: number;
    memoryOrigin?: MemoryOrigin;
  },
) {
  const episodes = await prisma.memoryEpisode.findMany({
    where: {
      userId: args.userId,
      memoryOrigin: args.memoryOrigin ?? resolveMemoryOrigin(),
      ...(args.kind ? { kind: args.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: args.limit,
  });
  return episodes.filter(isSafeEpisodeForConsumption);
}

export async function findEpisodesByIds(
  prisma: EpisodePrisma,
  ids: string[],
  memoryOrigin: MemoryOrigin = resolveMemoryOrigin(),
) {
  if (ids.length === 0) {
    return [];
  }

  const episodes = await prisma.memoryEpisode.findMany({
    where: { id: { in: ids }, memoryOrigin },
  });
  return episodes.filter(isSafeEpisodeForConsumption);
}

export function episodeFtsContent(episode: {
  title: string;
  summary: string;
  tags: string;
}, problem?: ProblemSearchMetadata | null) {
  const title = sanitizeEpisodeTeachingText(episode.title, "Learning episode");
  const summary = sanitizeEpisodeTeachingText(
    episode.summary,
    "Revision-specific implementation details were excluded from durable recall.",
  );
  const tags = parseEpisodeTags(episode.tags)
    .filter(isDurableEpisodeTag)
    .filter((tag) => !isCollectionSearchTag(tag));
  const searchableTags = tags.map((tag) => tag.replaceAll("_", " "));
  return enrichEpisodeFtsContent(
    [title, summary, ...searchableTags].join("\n"),
    problem,
  );
}

export function sanitizeMemoryEpisode(
  input: MemoryEpisodeInput,
): MemoryEpisodeInput {
  return {
    ...input,
    title: sanitizeEpisodeTeachingText(input.title, "Learning episode"),
    summary: sanitizeEpisodeTeachingText(
      input.summary,
      "Revision-specific implementation details were excluded from durable recall.",
    ),
    tags: [
      ...new Set(
        input.tags
          .filter(isDurableEpisodeTag)
          .filter((tag) => !isCollectionSearchTag(tag)),
      ),
    ],
  };
}

export function containsBlockedEpisodeNoise(value: string) {
  return containsDevelopmentNoiseText(value);
}

export function isSafeEpisodeForConsumption(episode: {
  title: string;
  summary: string;
  tags?: string;
}) {
  return (
    !containsBlockedEpisodeNoise(episode.title) &&
    !containsBlockedEpisodeNoise(episode.summary) &&
    !containsInternalMemoryLabel(episode.title) &&
    !containsInternalMemoryLabel(episode.summary) &&
    (episode.tags === undefined ||
      parseEpisodeTags(episode.tags).every(isDurableEpisodeTag))
  );
}

export function isSafeEpisodeForIndexing(episode: {
  title: string;
  summary: string;
  tags?: string;
  kind?: string;
  sourceTraceIds: string;
  memoryOrigin?: string | null;
}) {
  return (
    episode.memoryOrigin === "learner" &&
    (episode.kind !== "assisted_repair" ||
      parseEpisodeTraceIds(episode.sourceTraceIds).length > 0) &&
    isSafeEpisodeForConsumption(episode)
  );
}

export function containsInternalMemoryLabel(value: string) {
  return /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(value);
}

export function safeStoredMemoryTeachingText(
  value: string | null | undefined,
) {
  const text = value?.trim();
  if (
    !text ||
    containsBlockedEpisodeNoise(text) ||
    containsInternalMemoryLabel(text)
  ) {
    return undefined;
  }
  return text;
}

function sanitizeEpisodeTeachingText(value: string, fallback: string) {
  const sanitized = redactDevelopmentNoiseText(value)
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, (token) =>
      token.replace(/_/g, " "),
    )
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return sanitized.length >= 8 ? sanitized : fallback;
}

function isDurableEpisodeTag(tag: string) {
  return (
    !isBlockedDurableFactTag(tag) &&
    !isCodeShapeOnlyFactTag(tag) &&
    !containsDevelopmentNoiseText(tag)
  );
}

function parseEpisodeTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function parseEpisodeTraceIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (traceId): traceId is string =>
            typeof traceId === "string" && traceId.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}
