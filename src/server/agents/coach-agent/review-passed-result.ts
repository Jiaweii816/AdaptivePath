import type { CodeRunResult } from "@/types/code-runner";
import type { CoachDiagnosis, CoachReviewResult } from "@/types/coach";
import type { CoachReviewPlannerContext } from "./coach-agent.types";

export function buildPassedRunResult(args: {
  coachResult: CoachReviewResult;
  problemSlug: string;
  problemTitle: string;
  problemTags: string[];
  runResult: CodeRunResult;
  responseLanguage: "zh" | "en";
  planner?: CoachReviewPlannerContext;
}): CoachReviewResult {
  const optimization = inferPassedRunOptimization(args.coachResult);
  return {
    diagnosis: buildPassedRunDiagnosis({ ...args, optimization }),
    coachReply: buildPassedRunReply({ ...args, optimization }),
    degraded: args.coachResult.degraded,
  };
}

function buildPassedRunDiagnosis(args: {
  problemSlug: string;
  problemTags: string[];
  runResult: CodeRunResult;
  planner?: CoachReviewPlannerContext;
  optimization: PassedRunOptimization;
  coachResult: CoachReviewResult;
}): CoachDiagnosis {
  const counts = formatRunCounts(args.runResult);
  const next = args.planner?.nextTodayItem;
  const strengthFacts =
    args.coachResult.diagnosis.memoryUpdateCandidate.facts.filter((fact) =>
      ["strength", "skill"].includes(fact.factType),
    );
  return {
    problemSlug: args.problemSlug,
    runStatus: "passed_visible_tests",
    userIssueSummary: `Current run evidence passed (${counts}).`,
    coachSummary:
      args.optimization.kind === "can_optimize"
        ? `can_optimize: ${args.optimization.algorithm} - ${args.optimization.description}`
        : next
          ? `near_optimal; move on after self-rating; next Today item is ${formatProblemLabel(next)}.`
          : "near_optimal; move on after self-rating.",
    mistakeTags: [],
    skillTags: args.problemTags,
    memoryUpdateCandidate: {
      facts: strengthFacts,
      summary:
        strengthFacts.length > 0
          ? args.coachResult.diagnosis.memoryUpdateCandidate.summary
          : "Passed run evidence produced no eligible strength/skill candidate.",
    },
  };
}

function buildPassedRunReply(args: {
  problemTitle: string;
  responseLanguage: "zh" | "en";
  planner?: CoachReviewPlannerContext;
  optimization: PassedRunOptimization;
}) {
  const next = args.planner?.nextTodayItem;
  const handoff =
    args.responseLanguage === "en"
      ? buildEnglishPassedRunHandoff(args.problemTitle, next)
      : buildChinesePassedRunHandoff(args.problemTitle, next);
  if (args.responseLanguage === "en") {
    if (args.optimization.kind === "can_optimize") {
      return `Your current algorithm can still be optimized with ${args.optimization.algorithm} (${args.optimization.description}). Want me to walk you through it? ${handoff}`;
    }
    return `Your current algorithm is already close to optimal. ${handoff}`;
  }
  if (args.optimization.kind === "can_optimize") {
    return `你当前的算法还可以再优化，采用${args.optimization.algorithm}（${args.optimization.description}），你想要我给你讲解吗？${handoff}`;
  }
  return `你当前的算法已经接近最优解。${handoff}`;
}

type PassedRunOptimization =
  | { kind: "near_optimal" }
  | { kind: "can_optimize"; algorithm: string; description: string };

function inferPassedRunOptimization(
  coachResult: CoachReviewResult,
): PassedRunOptimization {
  const summary = coachResult.diagnosis.coachSummary.trim();
  const explicit = parseCanOptimizeSignal(summary);
  if (explicit) return explicit;
  if (/^near[_ -]?optimal\b/i.test(summary)) return { kind: "near_optimal" };
  return parseCanOptimizeSignal(coachResult.coachReply) ?? { kind: "near_optimal" };
}

function parseCanOptimizeSignal(
  source: string,
): PassedRunOptimization | undefined {
  const normalized = source.replace(/\s+/g, " ").trim();
  const explicit = normalized.match(
    /can_optimi[sz]e\s*:\s*([^:：\-–—()（）,，。;；]+?)\s*[-–—:：]\s*([^。;；\n]+)/i,
  );
  if (explicit?.[1]) {
    return {
      kind: "can_optimize",
      algorithm: cleanOptimizationPart(explicit[1], "optimized approach", 64),
      description: cleanOptimizationPart(
        explicit[2],
        "reduce the extra work while keeping the same result",
        96,
      ),
    };
  }
  const chinese = normalized.match(
    /(?:还可以|可以|值得|建议).{0,12}优化.{0,12}(?:采用|使用|用|换成)\s*([^，。；;()（）]+)(?:[（(]([^）)]*)[）)])?/,
  );
  if (chinese?.[1]) {
    return {
      kind: "can_optimize",
      algorithm: cleanOptimizationPart(chinese[1], "更优算法", 64),
      description: cleanOptimizationPart(
        chinese[2],
        "用更少重复计算达到同样结果",
        96,
      ),
    };
  }
  return undefined;
}

function cleanOptimizationPart(
  value: string | undefined,
  fallback: string,
  maxLength: number,
) {
  const cleaned = (value ?? "")
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[-–—。；;，,：:()（）]+$/g, "")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength).trim()}...`
    : cleaned;
}

function buildChinesePassedRunHandoff(
  problemTitle: string,
  next: CoachReviewPlannerContext["nextTodayItem"],
) {
  if (next) {
    return `请你先在 Today 自评里记录 ${problemTitle} 的体感，然后继续做今日列表里的下一题：${formatProblemLabel(next)}。`;
  }
  return "请你先在 Today 自评里记录这题的体感，然后回 Today 继续下一个 pending 项。";
}

function buildEnglishPassedRunHandoff(
  problemTitle: string,
  next: CoachReviewPlannerContext["nextTodayItem"],
) {
  if (next) {
    return `Record your Today self-rating for ${problemTitle}, then continue with the next Today item: ${formatProblemLabel(next)}.`;
  }
  return "Record your Today self-rating for this problem, then return to Today for the next pending item.";
}

function formatRunCounts(runResult: CodeRunResult) {
  const total = runResult.passedCount + runResult.failedCount;
  const countText = total > 0 ? `${runResult.passedCount}/${total} passed` : "passed";
  return runResult.durationMs !== undefined
    ? `${countText} in ${runResult.durationMs}ms`
    : countText;
}

export function formatProblemLabel(
  item: NonNullable<CoachReviewPlannerContext["nextTodayItem"]>,
) {
  return item.leetcodeNumber ? `LC ${item.leetcodeNumber} ${item.title}` : item.title;
}
