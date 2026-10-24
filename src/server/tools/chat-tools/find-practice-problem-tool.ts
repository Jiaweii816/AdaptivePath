import type { PrismaClient } from "@prisma/client";
import {
  type ChatToolArgs,
  type ChatToolResult,
} from "./chat-tool-contracts";
import { practiceCatalog, type PracticeCatalogItem } from "./practice-catalog";
import type { MemoryOrigin } from "@/server/memory/memory-origin";

type PracticeProblemContext = {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  problemTags: string[];
  problem?: {
    slug: string;
    leetcodeNumber: number | null;
  };
};

const MEMBERSHIP_TAGS = new Set([
  "top-interview-150",
  "interview-150",
  "hot150",
]);
const BROAD_CONTEXT_TAGS = new Set(["array", "string"]);

export async function findPracticeProblemChatTool(
  args: ChatToolArgs<"find_practice_problem">,
  context: PracticeProblemContext,
): Promise<ChatToolResult<"find_practice_problem">> {
  const searchedTags = resolveSearchedTags(args, context);
  const excludedCompletedIds = await loadCompletedIds({
    prisma: context.prisma,
    userId: context.userId,
    memoryOrigin: context.memoryOrigin,
    providedCompletedIds: args.completed_ids ?? [],
  });

  const hot150SameType = pickSuggestions({
    items: practiceCatalog.hot150,
    mode: args.mode,
    tags: searchedTags,
    completedIds: excludedCompletedIds,
  });
  const extendedSameType = pickSuggestions({
    items: practiceCatalog.extended,
    mode: args.mode,
    tags: searchedTags,
    completedIds: excludedCompletedIds,
  });
  const recommendation = chooseRecommendations({
    mode: args.mode,
    searchedTags,
    completedIds: excludedCompletedIds,
    hot150SameType,
    extendedSameType,
  });

  return {
    mode: args.mode,
    searchedTags,
    excludedCompletedIds,
    recommendationScope: recommendation.scope,
    transitionMessage: recommendation.transitionMessage,
    usedFallback: recommendation.suggestions.some(
      (suggestion) => suggestion.tier === "extended",
    ),
    suggestions: recommendation.suggestions.map((item) => ({
      ...item,
      reason: buildReason({
        item,
        mode: args.mode,
        searchedTags,
        scope: recommendation.scope,
      }),
    })),
  };
}

type RecommendationScope =
  | "hot150_same_type"
  | "extended_same_type"
  | "hot150_next_type"
  | "extended_fallback";

function chooseRecommendations(args: {
  mode: "advance" | "reinforce";
  searchedTags: string[];
  completedIds: string[];
  hot150SameType: PracticeCatalogItem[];
  extendedSameType: PracticeCatalogItem[];
}): {
  scope: RecommendationScope;
  transitionMessage?: string;
  suggestions: PracticeCatalogItem[];
} {
  if (args.hot150SameType.length > 0) {
    return {
      scope: "hot150_same_type",
      suggestions: args.hot150SameType.slice(0, 3),
    };
  }

  const searchedPatternLabel = formatPatternLabel(args.searchedTags);

  if (args.mode === "reinforce") {
    return {
      scope: "extended_same_type",
      transitionMessage: `Hot-150 has no remaining ${searchedPatternLabel} problems, so same-pattern reinforcement is coming from the extended catalog.`,
      suggestions: args.extendedSameType.slice(0, 3),
    };
  }

  const nextHot150Type = pickNextHot150TypeSuggestions({
    searchedTags: args.searchedTags,
    completedIds: args.completedIds,
  });

  if (nextHot150Type.length > 0) {
    const nextPatternLabel = formatSectionLabel(nextHot150Type[0]);

    return {
      scope: "hot150_next_type",
      transitionMessage: `Hot-150 ${searchedPatternLabel} is complete. Tell the user: "恭喜，攻克完 ${searchedPatternLabel} 类型了！可以进入下一个新类型 ${nextPatternLabel}，推荐 ${nextHot150Type[0].title}。"`,
      suggestions: nextHot150Type,
    };
  }

  return {
    scope: "extended_fallback",
    transitionMessage: `No unfinished Hot-150 problem matched the current or next pattern, so recommendations fall back to the extended catalog.`,
    suggestions: args.extendedSameType.slice(0, 3),
  };
}

function pickSuggestions(args: {
  items: PracticeCatalogItem[];
  mode: "advance" | "reinforce";
  tags: string[];
  completedIds: string[];
}) {
  return args.items
    .filter((item) => !isCompleted(item, args.completedIds))
    .map((item) => ({
      item,
      score: scoreItem({
        item,
        mode: args.mode,
        tags: args.tags,
      }),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.item.leetcodeNumber - b.item.leetcodeNumber)
    .map((scored) => scored.item);
}

function resolveSearchedTags(
  args: ChatToolArgs<"find_practice_problem">,
  context: PracticeProblemContext,
) {
  const rawTags = normalizePatternTags(
    args.tags.length > 0 ? args.tags : context.problemTags,
  );
  const currentSectionTags = getCurrentHot150SectionTags(context);
  const currentSectionMatches = currentSectionTags
    ? rawTags.filter((tag) => currentSectionTags.includes(tag))
    : [];

  if (currentSectionMatches.length > 0) {
    return unique(currentSectionMatches);
  }

  return preferSpecificTags(rawTags);
}

function getCurrentHot150SectionTags(context: PracticeProblemContext) {
  if (!context.problem) {
    return undefined;
  }

  const currentProblem = practiceCatalog.hot150.find(
    (item) =>
      item.slug === context.problem?.slug ||
      item.leetcodeNumber === context.problem?.leetcodeNumber,
  );

  if (!currentProblem) {
    return undefined;
  }

  return normalizePatternTags(currentProblem.tags);
}

function preferSpecificTags(tags: string[]) {
  const specificTags = tags.filter((tag) => !BROAD_CONTEXT_TAGS.has(tag));

  return specificTags.length > 0 ? unique(specificTags) : tags;
}

function scoreItem(args: {
  item: PracticeCatalogItem;
  mode: "advance" | "reinforce";
  tags: string[];
}) {
  const itemTags = normalizePatternTags(args.item.tags);
  const overlap = args.tags.filter((tag) => itemTags.includes(tag)).length;

  if (overlap === 0) {
    return 0;
  }

  const difficultyBonus =
    args.mode === "advance"
      ? difficultyRank(args.item.difficulty)
      : 4 - difficultyRank(args.item.difficulty);

  return overlap * 10 + difficultyBonus;
}

function buildReason(args: {
  item: PracticeCatalogItem;
  mode: "advance" | "reinforce";
  searchedTags: string[];
  scope: RecommendationScope;
}) {
  const matchingTags = normalizePatternTags(args.item.tags).filter((tag) =>
    args.searchedTags.includes(tag),
  );
  const tagText =
    matchingTags.length > 0 ? matchingTags.join(", ") : formatSectionLabel(args.item);

  if (args.scope === "hot150_next_type") {
    return `Good next Hot-150 step because the requested pattern is complete and this starts ${tagText}.`;
  }

  return args.mode === "advance"
    ? `Good next step after the current blocker because it raises the difficulty around ${tagText}.`
    : `Good reinforcement drill because it repeats ${tagText} without adding a new executable adapter.`;
}

function pickNextHot150TypeSuggestions(args: {
  searchedTags: string[];
  completedIds: string[];
}) {
  const hot150Items = practiceCatalog.hot150;
  const currentTypeItems = hot150Items.filter((item) =>
    hasPatternOverlap(item, args.searchedTags),
  );

  if (currentTypeItems.length === 0) {
    return [];
  }

  const currentTypeEndOrder = Math.max(
    ...currentTypeItems.map((item) => item.order ?? 0),
  );
  const afterCurrent = hot150Items
    .filter((item) => (item.order ?? 0) > currentTypeEndOrder)
    .filter((item) => !hasPatternOverlap(item, args.searchedTags))
    .filter((item) => !isCompleted(item, args.completedIds))
    .sort(compareHot150Order);
  const wrapped = hot150Items
    .filter((item) => !hasPatternOverlap(item, args.searchedTags))
    .filter((item) => !isCompleted(item, args.completedIds))
    .sort(compareHot150Order);
  const candidates = afterCurrent.length > 0 ? afterCurrent : wrapped;
  const nextSection = candidates[0]?.section;

  if (!nextSection) {
    return [];
  }

  return candidates.filter((item) => item.section === nextSection).slice(0, 3);
}

function hasPatternOverlap(item: PracticeCatalogItem, tags: string[]) {
  const itemTags = normalizePatternTags(item.tags);

  return tags.some((tag) => itemTags.includes(tag));
}

function compareHot150Order(a: PracticeCatalogItem, b: PracticeCatalogItem) {
  return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
}

async function loadCompletedIds(args: {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  providedCompletedIds: string[];
}) {
  const histories = await args.prisma.problemHistory.findMany({
    where: { userId: args.userId, memoryOrigin: args.memoryOrigin },
    include: { problem: true },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  const localCompletedIds = histories.flatMap((history) => [
    history.problem.id,
    history.problem.slug,
    history.problem.leetcodeNumber?.toString(),
  ]);

  return unique(
    [...args.providedCompletedIds, ...localCompletedIds]
      .filter((value): value is string => Boolean(value))
      .map(normalizeId),
  );
}

function isCompleted(item: PracticeCatalogItem, completedIds: string[]) {
  const ids = [
    item.slug,
    item.leetcodeNumber.toString(),
    `${item.leetcodeNumber}`,
    item.title,
  ].map(normalizeId);

  return ids.some((id) => completedIds.includes(id));
}

function difficultyRank(difficulty: PracticeCatalogItem["difficulty"]) {
  return difficulty === "Easy" ? 1 : difficulty === "Medium" ? 2 : 3;
}

function normalizeTags(tags: string[]) {
  return unique(
    tags
      .map((tag) => tag.trim().toLowerCase().replaceAll("_", "-"))
      .filter(Boolean),
  );
}

function normalizePatternTags(tags: string[]) {
  return normalizeTags(tags).filter((tag) => !MEMBERSHIP_TAGS.has(tag));
}

function formatPatternLabel(tags: string[]) {
  return tags.length > 0 ? tags.join(" / ") : "current pattern";
}

function formatSectionLabel(item: PracticeCatalogItem) {
  return item.section ?? (normalizePatternTags(item.tags).join(" / ") || item.title);
}

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values)];
}
