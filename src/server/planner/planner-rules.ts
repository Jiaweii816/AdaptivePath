import type { Hot150Problem } from "@/data/hot150";
import { isBlockedDurableFactTag } from "@/server/memory/integrity/memory-integrity-policy";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import {
  PLANNER_MAX_DAILY_DOSE,
  PLANNER_MINUTES_PER_PROBLEM,
  type PlannerPlanItemSource,
  type PlannerSelfRating,
  type PlannerWhy,
} from "./planner.types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PLANNER_TIME_ZONE = "America/Chicago";
const PLANNER_COLLECTION_TAGS = new Set([
  "hot150",
  "interview_150",
  "top_interview_150",
]);

export function plannerTimeZone() {
  return process.env.PLANNER_TIME_ZONE?.trim() || DEFAULT_PLANNER_TIME_ZONE;
}

export function startOfPlannerDay(date: Date, timeZone = plannerTimeZone()) {
  const parts = zonedDateParts(date, timeZone);
  return zonedDateTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function addPlannerDays(
  date: Date,
  days: number,
  timeZone = plannerTimeZone(),
) {
  const parts = zonedDateParts(date, timeZone);
  return zonedDateTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + days,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function daysBetweenPlannerDates(
  start: Date,
  end: Date,
  timeZone = plannerTimeZone(),
) {
  return Math.max(
    0,
    Math.ceil(
      (startOfPlannerDay(end, timeZone).getTime() -
        startOfPlannerDay(start, timeZone).getTime()) /
        DAY_MS,
    ),
  );
}

export function toPlannerDateInput(
  date: Date,
  timeZone = plannerTimeZone(),
) {
  const parts = zonedDateParts(date, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function calculateDailyDose(weeklyHours: number) {
  const raw = Math.round(
    ((weeklyHours * 60) / 7) / PLANNER_MINUTES_PER_PROBLEM,
  );
  return clamp(raw, 1, PLANNER_MAX_DAILY_DOSE);
}

export function estimatePlanProblemCount(args: {
  weeklyHours: number;
  interviewDate: Date;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const daysRemaining = Math.max(
    1,
    daysBetweenPlannerDates(now, args.interviewDate) + 1,
  );
  const availableMinutes = (args.weeklyHours * 60 * daysRemaining) / 7;
  return clamp(Math.floor(availableMinutes / PLANNER_MINUTES_PER_PROBLEM), 1, 150);
}

export function interleaveHot150Problems(problems: Hot150Problem[]) {
  const bySection = new Map<string, Hot150Problem[]>();
  const sectionOrder: string[] = [];

  for (const problem of problems) {
    if (!bySection.has(problem.section)) {
      bySection.set(problem.section, []);
      sectionOrder.push(problem.section);
    }
    bySection.get(problem.section)?.push(problem);
  }

  const output: Hot150Problem[] = [];
  let added = true;

  while (added) {
    added = false;
    for (const section of sectionOrder) {
      const group = bySection.get(section);
      const next = group?.shift();
      if (next) {
        output.push(next);
        added = true;
      }
    }
  }

  return output;
}

export function intervalForRating(args: {
  rating: PlannerSelfRating;
  previousIntervalDays?: number;
  previousEase?: number;
}) {
  const previousInterval = args.previousIntervalDays ?? 0;
  const previousEase = args.previousEase ?? 2.5;

  if (args.rating === "easy") {
    return {
      intervalDays:
        previousInterval > 0
          ? Math.max(7, Math.ceil(previousInterval * previousEase))
          : 7,
      ease: Math.min(3.2, previousEase + 0.15),
    };
  }

  if (args.rating === "hesitated") {
    return {
      intervalDays:
        previousInterval > 0
          ? Math.max(3, Math.ceil(previousInterval * 1.4))
          : 3,
      ease: previousEase,
    };
  }

  if (args.rating === "struggled") {
    return {
      intervalDays: 2,
      ease: Math.max(1.3, previousEase - 0.2),
    };
  }

  return {
    intervalDays: 1,
    ease: Math.max(1.3, previousEase - 0.3),
  };
}

export function normalizePlannerTag(tag: string) {
  return normalizeMemoryTag(tag);
}

export function primaryPatternTag(tags: string[]) {
  return plannerPatternTags(tags)[0] ?? "general";
}

export function plannerPatternTags(tags: string[]) {
  return unique(
    tags
      .map(normalizePlannerTag)
      .filter(Boolean)
      .filter((tag) => !isBlockedDurableFactTag(tag))
      .filter((tag) => !PLANNER_COLLECTION_TAGS.has(tag)),
  );
}

export function formatPlannerTag(tag: string) {
  return normalizePlannerTag(tag).replace(/_/g, "-");
}

export function plannerDisplayTags(tags: string[]) {
  return plannerPatternTags(tags).map(formatPlannerTag);
}

export function mergeWhy(existing: PlannerWhy[], next: PlannerWhy) {
  if (
    existing.some(
      (why) => why.source === next.source && why.detail === next.detail,
    )
  ) {
    return existing;
  }
  return [...existing, next];
}

export function sourcePriority(source: PlannerPlanItemSource) {
  switch (source) {
    case "review":
      return 0;
    case "weakness":
      return 1;
    case "replan":
      return 2;
    case "plan":
      return 3;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedDateParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function zonedDateTimeToUtc(parts: ZonedParts, timeZone: string) {
  const utcGuess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  const offset = timeZoneOffsetMs(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offset);
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = zonedDateParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}
