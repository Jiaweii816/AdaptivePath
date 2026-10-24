import { hot150Problems } from "@/data/hot150";
import { canonicalMechanismsForProblemTags } from "@/server/problems/hot150-taxonomy";
import type { ChatToolArgs } from "./chat-tool-contracts";
import {
  recentSearchStartDate,
  searchTavilyRecentPages,
  TAVILY_RETRIEVAL_RESULT_LIMIT,
  TAVILY_WINDOW_MONTHS,
  type TavilySearchResult,
} from "./tavily-search-client";

type VariantSearchContext = {
  problem: { title: string; slug: string; leetcodeNumber: number | null };
  problemTags: string[];
  learnerWeaknessCues?: string[];
};

type VariantSearchDependencies = {
  apiKey?: string;
  fetcher?: typeof fetch;
  now?: Date;
};

type RetrievalStage = "exact_title" | "mechanism_fallback";

const MAX_RETURNED_CANDIDATES = 3;
const MAX_CANDIDATE_URL_LENGTH = 512;
const MAX_CANDIDATE_SNIPPET_LENGTH = 220;
const VARIANT_SIGNAL_PATTERNS = [
  /\bfollow[ -]?up\b/i,
  /\bvariant(?:s|ion)?\b/i,
  /\bextension\b/i,
  /\btwist\b/i,
  /\badvanced\b/i,
  /\boptimization\b/i,
  /\btrade-?off\b/i,
  /\bsimilar problem\b/i,
  /变体|追问|进阶|拓展|优化/,
];

const clean = (value: string, maxLength: number) =>
  value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

const HOT150_TITLE_KEYS = hot150Problems
  .map((problem) => normalizeForMatch(problem.title))
  .sort((left, right) => right.length - left.length);

function readableTag(value: string) {
  return clean(value.replace(/[_/]+/g, " "), 80);
}

function mechanismTerms(context: VariantSearchContext) {
  const canonical = canonicalMechanismsForProblemTags(context.problemTags)
    .flatMap((mechanism) => mechanism.aliases)
    .filter((alias) => alias.length <= 32);
  return [...context.problemTags.map(readableTag), ...canonical]
    .map((term) => clean(term, 80))
    .filter(Boolean)
    .filter(
      (term, index, terms) =>
        terms.findIndex(
          (candidate) => normalizeForMatch(candidate) === normalizeForMatch(term),
        ) === index,
    )
    .slice(0, 3);
}

function optionalQueryTerms(
  args: ChatToolArgs<"search_interview_variant_candidates">,
) {
  return [
    args.company ? clean(args.company, 80) : "",
    args.focus ? clean(args.focus, 120) : "",
  ].filter(Boolean);
}

/** The first retrieval must be anchored to the exact active Hot-150 title. */
export function buildExactTitleVariantQuery(
  args: ChatToolArgs<"search_interview_variant_candidates">,
  context: VariantSearchContext,
): string {
  return [
    `"${clean(context.problem.title, 160)}"`,
    context.problem.leetcodeNumber ? `"LC ${context.problem.leetcodeNumber}"` : "",
    "coding interview follow-up variant",
    ...optionalQueryTerms(args),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
}

/**
 * The fallback deliberately drops the title. It widens recall to the active
 * problem's controlled mechanisms while keeping all learner data local.
 */
export function buildMechanismFallbackVariantQuery(
  args: ChatToolArgs<"search_interview_variant_candidates">,
  context: VariantSearchContext,
): string {
  return [
    mechanismTerms(context).join(" "),
    "coding interview follow-up variant problem outside LeetCode Interview 150",
    ...optionalQueryTerms(args),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
}

function hasVariantSignal(value: string) {
  return VARIANT_SIGNAL_PATTERNS.some((pattern) => pattern.test(value));
}

function isNamedHot150ProblemPage(title: string) {
  const normalizedTitle = normalizeForMatch(title);
  return HOT150_TITLE_KEYS.some(
    (hot150Title) =>
      hot150Title.length >= 4 &&
      (normalizedTitle === hot150Title ||
        normalizedTitle.startsWith(hot150Title + "leetcode") ||
        normalizedTitle.startsWith(hot150Title + "力扣") ||
        normalizedTitle.startsWith(hot150Title + "题解")),
  );
}

function startsWithDifferentHot150Title(title: string, activeTitle: string) {
  const normalizedTitle = normalizeForMatch(title);
  const activeTitleKey = normalizeForMatch(activeTitle);
  return HOT150_TITLE_KEYS.some(
    (hot150Title) =>
      hot150Title !== activeTitleKey &&
      hot150Title.length >= 4 &&
      normalizedTitle.startsWith(hot150Title),
  );
}

function candidateFromResult(
  result: TavilySearchResult,
  context: VariantSearchContext,
  stage: RetrievalStage,
) {
  try {
    const url = new URL(result.url);
    const fullUrl = url.toString();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      fullUrl.length > MAX_CANDIDATE_URL_LENGTH ||
      /(^|\.)leetcode\.(com|cn)$/i.test(url.hostname)
    ) {
      return undefined;
    }

    const title = clean(result.title, 140);
    const snippet = clean(result.content, MAX_CANDIDATE_SNIPPET_LENGTH);
    if (!title || !snippet) return undefined;
    if (startsWithDifferentHot150Title(title, context.problem.title)) {
      return undefined;
    }

    const material = `${title} ${snippet}`;
    const normalizedMaterial = normalizeForMatch(material);
    const titleKey = normalizeForMatch(context.problem.title);
    const numberKey = context.problem.leetcodeNumber
      ? String(context.problem.leetcodeNumber)
      : "";
    const mechanisms = mechanismTerms(context);
    const matchedSignals = [
      titleKey && normalizedMaterial.includes(titleKey) ? "active title" : "",
      numberKey &&
      new RegExp(`(?:lc|leetcode|力扣)?\\s*#?${numberKey}\\b`, "i").test(
        material,
      )
        ? `LC ${numberKey}`
        : "",
      ...mechanisms
        .filter((label) => normalizeForMatch(label).length >= 3)
        .filter((label) => normalizedMaterial.includes(normalizeForMatch(label)))
        .slice(0, 1)
        .map((label) => `mechanism: ${label}`),
      hasVariantSignal(material) ? "variation cue" : "",
    ].filter(Boolean);

    const matchesAnchor = matchedSignals.some(
      (signal) => signal === "active title" || signal.startsWith("LC "),
    );
    const matchesMechanism = matchedSignals.some((signal) =>
      signal.startsWith("mechanism:"),
    );
    const hasVariation = matchedSignals.includes("variation cue");
    // A page whose title starts with a Hot-150 title is only useful when its
    // title or Tavily excerpt explicitly says it discusses a variation. This
    // retains a report such as “LRU Cache Variant Question” while excluding a
    // plain “LRU Cache - LeetCode” tutorial from recommendations.
    if (isNamedHot150ProblemPage(title) && !hasVariation) return undefined;
    const suitable =
      hasVariation &&
      (stage === "exact_title" ? matchesAnchor : matchesMechanism);
    if (!suitable) return undefined;

    return {
      title,
      url: fullUrl,
      sourceHost: url.hostname,
      snippet,
      matchedSignals: matchedSignals.slice(0, 3),
      ...(typeof result.score === "number" && result.score >= 0 && result.score <= 1
        ? { relevanceScore: result.score }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function selectCandidates(
  results: TavilySearchResult[],
  context: VariantSearchContext,
  stage: RetrievalStage,
) {
  const candidateByUrl = new Map<
    string,
    NonNullable<ReturnType<typeof candidateFromResult>>
  >();
  for (const result of results) {
    const candidate = candidateFromResult(result, context, stage);
    if (candidate && !candidateByUrl.has(candidate.url)) {
      candidateByUrl.set(candidate.url, candidate);
    }
  }
  return [...candidateByUrl.values()]
    .sort(
      (left, right) =>
        (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0),
    )
    .slice(0, MAX_RETURNED_CANDIDATES);
}

export async function searchInterviewVariantCandidatesChatTool(
  args: ChatToolArgs<"search_interview_variant_candidates">,
  context: VariantSearchContext,
  dependencies: VariantSearchDependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const startDate = recentSearchStartDate(now);
  const anchorProblem = {
    title: context.problem.title,
    slug: context.problem.slug,
    tags: context.problemTags
      .map((tag) => clean(tag, 48))
      .filter(Boolean)
      .slice(0, 8),
  };
  const executeSearch = (query: string) =>
    searchTavilyRecentPages({
      apiKey: dependencies.apiKey ?? process.env.TAVILY_API_KEY,
      query,
      startDate,
      maxResults: TAVILY_RETRIEVAL_RESULT_LIMIT,
      fetcher: dependencies.fetcher,
    });

  const exactResponse = await executeSearch(
    buildExactTitleVariantQuery(args, context),
  );
  let retrievalStage: RetrievalStage = "exact_title";
  let status = exactResponse.status;
  let candidates = selectCandidates(exactResponse.results, context, retrievalStage);

  // Do not retry provider failures: a second call would spend credits without
  // new evidence. The fallback is only for a successful but unhelpful search.
  if (status === "success" && candidates.length === 0) {
    retrievalStage = "mechanism_fallback";
    const fallbackResponse = await executeSearch(
      buildMechanismFallbackVariantQuery(args, context),
    );
    status = fallbackResponse.status;
    candidates = selectCandidates(
      fallbackResponse.results,
      context,
      retrievalStage,
    );
  }
  if (status === "success" && candidates.length === 0) status = "empty";

  return {
    status,
    anchorProblem,
    searchWindow: {
      startDate,
      endDate: now.toISOString().slice(0, 10),
      months: TAVILY_WINDOW_MONTHS,
    },
    retrievalStage,
    candidates,
    weaknessCues: (context.learnerWeaknessCues ?? [])
      .map((cue) => clean(cue, 120))
      .filter(Boolean)
      .slice(0, 3),
    message:
      status === "success"
        ? "Public web variant candidates found. They are unverified reports, not official or executable PatternCoach problems."
        : status === "disabled"
          ? "Web variant discovery is unavailable because TAVILY_API_KEY is not configured."
          : status === "empty"
            ? "No usable non-Hot-150 public variant candidate was found in the last 24 months."
            : "Web variant discovery is temporarily unavailable. Continue with the local Hot-150 bank.",
  };
}
