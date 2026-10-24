import type { WeaknessSlotView } from "@/mcp/memory-read-service";

export const MAX_DAILY_WEAKNESSES = 3;
const MAX_RECOMMENDATIONS = 3;

export type DailyPlanRecommendation = {
  problemId: string;
  title: string;
  reason: string;
};

export type DailyPlanInput = {
  userId: string;
  date: string;
  weaknesses: readonly WeaknessSlotView[];
  recommended: readonly DailyPlanRecommendation[];
};

export type DailyPlan = {
  userId: string;
  date: string;
  weaknesses: WeaknessSlotView[];
  recommended: DailyPlanRecommendation[];
};

export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const userId = requireText(input.userId, "userId");
  const date = requireIsoDate(input.date);
  const weaknesses = input.weaknesses.map(validateWeakness);
  const recommended = input.recommended.map(validateRecommendation);

  if (weaknesses.length === 0 && recommended.length === 0) {
    throw new Error("No learner signal: refuse to fabricate a daily plan.");
  }

  return {
    userId,
    date,
    weaknesses: weaknesses.slice(0, MAX_DAILY_WEAKNESSES),
    recommended: recommended.slice(0, MAX_RECOMMENDATIONS),
  };
}

function validateWeakness(
  weakness: WeaknessSlotView,
  index: number,
): WeaknessSlotView {
  if (!Number.isSafeInteger(weakness.evidenceCount) || weakness.evidenceCount < 0) {
    throw new Error(
      `weaknesses[${index}].evidenceCount must be a non-negative integer.`,
    );
  }
  return {
    slotKey: requireText(weakness.slotKey, `weaknesses[${index}].slotKey`),
    title: requireText(weakness.title, `weaknesses[${index}].title`),
    summary: requireText(weakness.summary, `weaknesses[${index}].summary`),
    evidenceCount: weakness.evidenceCount,
    ...(weakness.leetcodeNumber !== undefined
      ? {
          leetcodeNumber: requirePositiveInteger(
            weakness.leetcodeNumber,
            `weaknesses[${index}].leetcodeNumber`,
          ),
        }
      : {}),
    ...(weakness.focusTags && weakness.focusTags.length > 0
      ? {
          focusTags: [
            ...new Set(
              weakness.focusTags.map((tag) => requireText(tag, "focusTag")),
            ),
          ].slice(0, 8),
        }
      : {}),
  };
}

function validateRecommendation(
  recommendation: DailyPlanRecommendation,
  index: number,
): DailyPlanRecommendation {
  return {
    problemId: requireText(
      recommendation.problemId,
      `recommended[${index}].problemId`,
    ),
    title: requireText(recommendation.title, `recommended[${index}].title`),
    reason: requireText(recommendation.reason, `recommended[${index}].reason`),
  };
}

function requireIsoDate(value: string) {
  const date = requireText(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("date must be a valid calendar date.");
  }
  return date;
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be blank.`);
  return normalized;
}

function requirePositiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}
