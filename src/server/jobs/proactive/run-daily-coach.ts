import {
  createReadOnlyMcpRuntime,
  type ReadOnlyMcpRuntime,
} from "@/mcp/read-runtime";
import type { WeaknessSlotView } from "@/mcp/memory-read-service";
import { extractKnownConcepts } from "@/server/memory/retrieval/concepts";
import {
  buildDailyPlan,
  MAX_DAILY_WEAKNESSES,
  type DailyPlan,
} from "./build-daily-plan";
import { renderEmail } from "./render-email";
import { sendEmail } from "./email-transport";

export type RunDailyCoachInput = {
  /** External learner handle. It is resolved to an internal User.id read-only. */
  handle: string;
  databaseUrl?: string;
  to: string;
  from: string;
  date?: Date;
  timezone?: string;
};

export type DailyCoachSendResult = Awaited<ReturnType<typeof sendEmail>>;

type DailyCoachRuntime = Pick<
  ReadOnlyMcpRuntime,
  "resolveLearner" | "recommendPractice" | "close"
> & {
  memoryReadService: Pick<
    ReadOnlyMcpRuntime["memoryReadService"],
    "getLearnerWeaknessSignals"
  >;
};

export type RunDailyCoachDependencies = {
  createRuntime(options: { databaseUrl?: string }): DailyCoachRuntime;
  buildPlan(input: DailyPlan): DailyPlan;
  render(plan: DailyPlan): ReturnType<typeof renderEmail>;
  send(message: Parameters<typeof sendEmail>[0]): Promise<DailyCoachSendResult>;
  now(): Date;
};

const defaultDependencies: RunDailyCoachDependencies = {
  createRuntime: (options) => createReadOnlyMcpRuntime(options),
  buildPlan: buildDailyPlan,
  render: renderEmail,
  send: sendEmail,
  now: () => new Date(),
};

/**
 * Deterministic read -> plan -> render -> send workflow. This is a scheduled
 * job, not a fourth lifecycle Agent: it makes no LLM call and writes no memory.
 */
export async function runDailyCoach(
  input: RunDailyCoachInput,
  dependencies: RunDailyCoachDependencies = defaultDependencies,
): Promise<DailyCoachSendResult> {
  const handle = requireNonBlank(input.handle, "handle");
  const to = requireNonBlank(input.to, "to");
  const from = requireNonBlank(input.from, "from");
  const runtime = dependencies.createRuntime({
    databaseUrl: input.databaseUrl,
  });

  try {
    const learner = await runtime.resolveLearner(handle);
    const weaknessSignals =
      await runtime.memoryReadService.getLearnerWeaknessSignals(learner.userId);
    const weaknesses = weaknessSignals.items.slice(0, MAX_DAILY_WEAKNESSES);
    const practiceTags = derivePracticeTags(weaknesses);
    const recommendation =
      practiceTags.length > 0
        ? await runtime.recommendPractice({
            handle: learner.handle,
            mode: "reinforce",
            tags: practiceTags,
          })
        : undefined;
    const recommended =
      recommendation?.suggestions.map((suggestion) => ({
        problemId: String(suggestion.leetcodeNumber),
        title: suggestion.title,
        reason: suggestion.reason,
      })) ?? [];
    if (weaknesses.length === 0 && recommended.length === 0) {
      throw new Error(
        "No learner signal: refusing to fabricate a daily coach plan.",
      );
    }

    const plan = dependencies.buildPlan({
      userId: learner.userId,
      date: formatCalendarDate(
        input.date ?? dependencies.now(),
        input.timezone,
      ),
      weaknesses,
      recommended,
    });
    const email = dependencies.render(plan);
    return await dependencies.send({ to, from, ...email });
  } finally {
    await runtime.close();
  }
}

export function derivePracticeTags(
  weaknesses: readonly WeaknessSlotView[],
): string[] {
  return [
    ...new Set(
      weaknesses.flatMap((weakness) =>
        (weakness.focusTags && weakness.focusTags.length > 0
          ? weakness.focusTags
          : extractKnownConcepts(`${weakness.title} ${weakness.summary}`)
        ).map((concept) => concept.replaceAll("_", "-")),
      ),
    ),
  ].slice(0, 8);
}

export function formatCalendarDate(date: Date, timezone?: string): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Daily coach date must be valid.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error("Unable to format the daily coach calendar date.");
  }
  return `${year}-${month}-${day}`;
}

function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be blank.`);
  return normalized;
}
