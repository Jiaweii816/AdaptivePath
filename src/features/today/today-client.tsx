"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CornerDownRight,
  Flame,
  ListChecks,
  Loader2,
  type LucideIcon,
  Play,
  RefreshCw,
  SkipForward,
  Target,
  Trophy,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReviewProblemCardView } from "@/features/review-problems/review-problem-card";
import {
  HandbookHomeCard,
  type HandbookHomeNote,
} from "@/features/today/handbook-home-card";
import { cn } from "@/lib/utils";
import { englishSystemText } from "@/lib/system-copy";
import type {
  PlannerCoverage,
  PlannerProposalDto,
  PlannerWhy,
  TodayDoseItem,
  TodayPlannerData,
} from "@/server/planner/planner.types";
import type {
  ReviewFocusBoard,
  ReviewProblemCard,
} from "@/server/planner/review-focus/review-focus.types";

type TodayClientProps = {
  initialData: TodayPlannerData;
  handbookNotes: HandbookHomeNote[];
};

const sourceLabel: Record<TodayDoseItem["source"], string> = {
  plan: "New",
  review: "Review",
  weakness: "Weakness",
  replan: "Re-plan",
};

const sourceBadgeClass: Record<TodayDoseItem["source"], string> = {
  plan: "border-sky-200/80 bg-sky-50/70 text-sky-700",
  review: "border-violet-200/80 bg-violet-50/70 text-violet-700",
  weakness: "border-amber-200/80 bg-amber-50/70 text-amber-700",
  replan: "border-emerald-200/80 bg-emerald-50/70 text-emerald-700",
};

const doseRailClass: Record<TodayDoseItem["status"], string> = {
  pending: "border-l-accent",
  in_progress: "border-l-accent",
  completed: "border-l-primary",
};

const doseActionButtonClass: Record<TodayDoseItem["status"], string> = {
  pending:
    "bg-accent text-accent-foreground hover:bg-accent/90 active:bg-accent/85 focus-visible:ring-accent/70",
  in_progress:
    "bg-accent text-accent-foreground hover:bg-accent/90 active:bg-accent/85 focus-visible:ring-accent/70",
  completed:
    "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85 focus-visible:ring-primary/70",
};

type ReasonKind = "carryover" | "replan" | "weakness" | "new";

const reasonAccent: Record<
  ReasonKind,
  { box: string; icon: LucideIcon }
> = {
  carryover: {
    box: "border-sky-100 bg-sky-50/35 text-sky-800",
    icon: CornerDownRight,
  },
  replan: {
    box: "border-emerald-100 bg-emerald-50/40 text-emerald-800",
    icon: RefreshCw,
  },
  weakness: {
    box: "border-amber-100 bg-amber-50/45 text-amber-800",
    icon: AlertTriangle,
  },
  new: {
    box: "border-sky-100 bg-sky-50/35 text-sky-800",
    icon: CornerDownRight,
  },
};

export function TodayClient({ handbookNotes, initialData }: TodayClientProps) {
  const router = useRouter();
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [busyPlanItemId, setBusyPlanItemId] = useState<string | null>(null);
  const [busySkipPlanItemId, setBusySkipPlanItemId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [isContinuingDose, setIsContinuingDose] = useState(false);
  const [continueDoseError, setContinueDoseError] = useState<string | null>(null);

  const submitGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSavingGoal(true);
    setGoalError(null);

    try {
      const response = await fetch("/api/planner/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetLabel: form.get("targetLabel"),
          interviewDate: form.get("interviewDate"),
          weeklyHours: form.get("weeklyHours"),
        }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to save readiness goal.");
      }

      router.refresh();
    } catch (error) {
      setGoalError(
        error instanceof Error ? error.message : "Unable to save readiness goal.",
      );
    } finally {
      setIsSavingGoal(false);
    }
  };

  const decideProposal = async (
    proposalId: string,
    decision: "accept" | "reject",
  ) => {
    setBusyProposalId(proposalId);
    setProposalError(null);

    try {
      const response = await fetch(`/api/planner/proposals/${proposalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to update proposal.");
      }

      router.refresh();
    } catch (error) {
      setProposalError(
        error instanceof Error ? error.message : "Unable to update proposal.",
      );
    } finally {
      setBusyProposalId(null);
    }
  };

  const continueDoseBatch = async () => {
    setIsContinuingDose(true);
    setContinueDoseError(null);

    try {
      const response = await fetch("/api/planner/advance-dose", {
        method: "POST",
      });
      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to continue the next dose.");
      }

      router.refresh();
    } catch (error) {
      setContinueDoseError(
        error instanceof Error
          ? error.message
          : "Unable to continue the next dose.",
      );
    } finally {
      setIsContinuingDose(false);
    }
  };

  const openDoseItem = async (item: TodayDoseItem) => {
    const href = workbenchHrefFor(item);

    if (!item.planItemId || item.status === "completed") {
      router.push(href);
      return;
    }

    setBusyPlanItemId(item.planItemId);
    setStartError(null);

    try {
      const response = await fetch("/api/planner/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.planItemId }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to open this planner item.");
      }

      router.push(href);
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "Unable to open this planner item.",
      );
    } finally {
      setBusyPlanItemId(null);
    }
  };

  const skipDoseItem = async (item: TodayDoseItem) => {
    if (!item.planItemId || item.status === "completed") {
      return;
    }

    setBusySkipPlanItemId(item.planItemId);
    setSkipError(null);

    try {
      const response = await fetch("/api/planner/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.planItemId }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Unable to skip this planner item.");
      }

      router.refresh();
    } catch (error) {
      setSkipError(
        error instanceof Error
          ? error.message
          : "Unable to skip this planner item.",
      );
    } finally {
      setBusySkipPlanItemId(null);
    }
  };

  if (!initialData.hasGoal) {
    return (
      <>
        <PageHeader
          title="Today"
          description="Set a readiness target and PatternCoach will turn Hot 150 into a daily queue."
        />
        <section className="mt-6 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-primary">
            <Target className="h-4 w-4" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Readiness Target</h2>
          </div>
          <form className="mt-5 grid gap-4 md:grid-cols-[1fr_180px_160px_auto]" onSubmit={submitGoal}>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Target company</span>
              <Input
                defaultValue={initialData.defaultTargetLabel}
                name="targetLabel"
                placeholder="General FAANG"
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Interview date</span>
              <Input
                defaultValue={initialData.defaultInterviewDate}
                name="interviewDate"
                required
                type="date"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Hours / week</span>
              <Input
                defaultValue={initialData.defaultWeeklyHours}
                min={1}
                name="weeklyHours"
                required
                step="0.5"
                type="number"
              />
            </label>
            <div className="flex items-end">
              <Button disabled={isSavingGoal} type="submit">
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                Build Plan
              </Button>
            </div>
          </form>
          {goalError ? (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {goalError}
            </p>
          ) : null}
        </section>
      </>
    );
  }

  const isDoseComplete =
    initialData.dose.length > 0 &&
    initialData.dose.every((item) => item.status === "completed");

  return (
    <>
      <PageHeader
        title="Today"
        description="Your readiness plan owns the next problem, review loop, and re-plan proposals."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/mock-interview">Start Mock Interview</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/workbench">Open Workbench</Link>
            </Button>
          </>
        }
      />

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.55fr)_minmax(360px,1fr)]">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Target className="h-4 w-4" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Readiness Target</h2>
              </div>
              <p className="mt-4 text-2xl font-semibold leading-none">
                {initialData.goal.targetLabel}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {initialData.goal.weeklyHours}h/week · {initialData.goal.dailyDoseTarget} problem
                {initialData.goal.dailyDoseTarget === 1 ? "" : "s"} today
              </p>
            </div>
            <div className="grid gap-1 rounded-md border border-border bg-muted/25 px-4 py-3 text-right">
              <span className="inline-flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Interview
              </span>
              <span className="text-base font-semibold">
                {initialData.goal.interviewDate}
              </span>
              <span className="text-xs text-muted-foreground">
                {initialData.goal.daysRemaining} day
                {initialData.goal.daysRemaining === 1 ? "" : "s"} left
              </span>
            </div>
          </div>
        </div>

        <PaceRuleCard />
        <PatternCoverageCard patterns={initialData.coverage.patternCoverage} />
      </section>

      <section className="mt-4 grid items-start gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(360px,1fr)]">
        <div className="grid content-start gap-6">
          <div className="grid content-start gap-4 md:grid-cols-3">
            <TodayMetricTile
              icon={<Flame className="h-11 w-11 text-orange-500" aria-hidden="true" />}
              label="Study Streak"
              sub="days with Review activity"
              value={initialData.growth.streakDays}
            />
            <TodayMetricTile
              icon={<CalendarDays className="h-11 w-11 text-blue-500" aria-hidden="true" />}
              label="This Week"
              sub="distinct problems in 7 days"
              value={initialData.growth.weeklyProblemCount}
            />
            <TodayMetricTile
              icon={<Trophy className="h-11 w-11 text-amber-500" aria-hidden="true" />}
              label="Solved / Top150"
              sub="passed at least once"
              value={`${initialData.growth.solvedCount} / ${initialData.growth.top150Total}`}
            />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
                  <h2 className="text-base font-semibold">Today Dose</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  This queue stays capped to your daily capacity; unfinished items keep their slots.
                </p>
              </div>
              {isDoseComplete ? (
                <Button
                  disabled={isContinuingDose}
                  onClick={continueDoseBatch}
                  size="sm"
                  type="button"
                >
                  {isContinuingDose ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  )}
                  Next Dose
                </Button>
              ) : (
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            {continueDoseError ? (
              <p className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {continueDoseError}
              </p>
            ) : null}
            {startError ? (
              <p className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {startError}
              </p>
            ) : null}
            {skipError ? (
              <p className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {skipError}
              </p>
            ) : null}
            <div className="divide-y divide-border">
              {initialData.dose.length > 0 ? (
                initialData.dose.map((item) => (
                  <DoseRow
                    busyPlanItemId={busyPlanItemId}
                    busySkipPlanItemId={busySkipPlanItemId}
                    item={item}
                    key={`${item.problemId}-${item.source}`}
                    onOpen={openDoseItem}
                    onSkip={skipDoseItem}
                  />
                ))
              ) : (
                <p className="px-5 py-8 text-sm text-muted-foreground">
                  No items due today. You can still open Workbench for free practice.
                </p>
              )}
            </div>
          </div>
        </div>
        <aside className="grid content-start gap-4">
          <ProposalPanel
            busyProposalId={busyProposalId}
            error={proposalError}
            onDecide={decideProposal}
            proposals={initialData.proposals}
          />
          <ReviewFocusPanel board={initialData.reviewFocus} />
          <HandbookHomeCard notes={handbookNotes} />
        </aside>
      </section>
    </>
  );
}

function PaceRuleCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-primary">
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Pace Rule</h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Planner converts weekly time into a capped daily dose with a simple
        45-minute/problem estimate.
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Progress only moves after your self-rating.
      </p>
    </div>
  );
}

function TodayMetricTile({
  icon,
  label,
  sub,
  value,
}: {
  icon: ReactNode;
  label: string;
  sub: string;
  value: string | number;
}) {
  return (
    <div className="flex min-h-[104px] items-center gap-4 rounded-lg border border-border bg-card px-5 py-4">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
          {value}
        </p>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function PatternCoverageCard({
  patterns,
}: {
  patterns: PlannerCoverage["patternCoverage"];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Pattern Coverage</h2>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/profile">View all</Link>
        </Button>
      </div>
      <div className="mt-4 grid gap-x-7 gap-y-3 sm:grid-cols-2">
        {patterns.map((pattern) => {
          const percentage = Math.round(
            (pattern.completed / Math.max(pattern.total, 1)) * 100,
          );

          return (
            <div key={pattern.tag}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium">{pattern.tag}</span>
                <span className="shrink-0 text-muted-foreground">
                  {pattern.completed}/{pattern.total}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function workbenchHrefFor(item: TodayDoseItem) {
  return `/workbench?problem=${item.slug}${
    item.planItemId ? `&planItemId=${item.planItemId}` : ""
  }`;
}

function DoseRow({
  busyPlanItemId,
  busySkipPlanItemId,
  item,
  onOpen,
  onSkip,
}: {
  busyPlanItemId: string | null;
  busySkipPlanItemId: string | null;
  item: TodayDoseItem;
  onOpen: (item: TodayDoseItem) => void;
  onSkip: (item: TodayDoseItem) => void;
}) {
  const interviewHref = `/mock-interview?problem=${item.slug}${
    item.planItemId ? `&planItemId=${item.planItemId}` : ""
  }`;
  const isBusy = Boolean(item.planItemId && busyPlanItemId === item.planItemId);
  const isSkipping = Boolean(
    item.planItemId && busySkipPlanItemId === item.planItemId,
  );
  const canSkip = Boolean(item.planItemId && item.status !== "completed");
  const actionLabel =
    item.status === "completed"
      ? "Review Again"
      : item.status === "in_progress"
        ? "Continue"
        : "Start";
  const reasons = item.why.length > 0 ? item.why : [fallbackReasonFor(item)];

  return (
    <article
      className={cn(
        "grid gap-3 border-l-4 bg-card px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-stretch",
        doseRailClass[item.status],
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium",
              sourceBadgeClass[item.source],
            )}
          >
            {sourceLabel[item.source]}
          </span>
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium",
              doseDifficultyClass(item.difficulty),
            )}
          >
            {item.difficulty ?? "Practice"}
          </span>
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-muted/25 px-2 text-[11px] font-medium text-muted-foreground">
            {item.leetcodeNumber ? `LC ${item.leetcodeNumber}` : "Local"}
          </span>
        </div>
        <h3
          className="mt-2 truncate text-[15px] font-semibold leading-5 text-foreground"
          style={{ fontSize: 15, lineHeight: "20px" }}
        >
          {item.title}
        </h3>
        <div className="mt-2 grid max-w-[480px] gap-1.5">
          {reasons.map((why) => (
            <ReasonLine key={`${why.source}-${why.label}-${why.detail}`} why={why} />
          ))}
        </div>
        <TagList tags={item.tags} />
      </div>
      <div className="flex flex-col gap-3 md:min-w-[260px] md:items-end md:justify-between">
        <DoseStatus status={item.status} />
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button
            asChild
            className="h-9 px-4 text-sm font-medium"
            style={{ fontSize: 14, lineHeight: "20px" }}
            variant="outline"
          >
            <Link href={interviewHref}>Mock Interview</Link>
          </Button>
          {canSkip ? (
            <Button
              className="h-9 px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
              disabled={isBusy || isSkipping}
              onClick={() => onSkip(item)}
              style={{ fontSize: 14, lineHeight: "20px" }}
              title="Move this item to the end of the plan"
              type="button"
              variant="ghost"
            >
              {isSkipping ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SkipForward className="h-4 w-4" aria-hidden="true" />
              )}
              Skip
            </Button>
          ) : null}
          <Button
            className={cn(
              "h-9 min-w-[118px] px-4 text-sm font-semibold shadow-sm",
              doseActionButtonClass[item.status],
            )}
            disabled={isBusy || isSkipping}
            onClick={() => onOpen(item)}
            style={{ fontSize: 14, lineHeight: "20px" }}
            type="button"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : item.status === "completed" ? null : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {actionLabel}
          </Button>
        </div>
      </div>
    </article>
  );
}

function doseDifficultyClass(difficulty: string | null) {
  if (difficulty === "Easy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (difficulty === "Medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (difficulty === "Hard") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-border bg-muted/25 text-muted-foreground";
}

function DoseStatus({
  className,
  status,
}: {
  className?: string;
  status: TodayDoseItem["status"];
}) {
  if (status === "completed") {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium leading-6 text-emerald-600", className)}>
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        Done
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium leading-6 text-amber-600", className)}>
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
        In progress
      </span>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium leading-6 text-amber-600", className)}>
      <Target className="h-3.5 w-3.5" aria-hidden="true" />
      Ready
    </span>
  );
}

function ReasonLine({ why }: { why: PlannerWhy }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const accent = reasonAccent[reasonKindFor(why)];
  const Icon = accent.icon;
  const label = reasonLabelFor(why);
  const fullText = `${label} · ${why.detail}`;

  return (
    <button
      aria-expanded={isExpanded}
      className={cn(
        "flex w-full min-w-0 max-w-full items-start gap-1.5 rounded-md border border-l-2 px-2 py-[3px] text-left text-[12px] font-normal leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        accent.box,
      )}
      data-ui="today-dose-reason-line"
      onClick={() => setIsExpanded((expanded) => !expanded)}
      style={{ fontSize: 12, lineHeight: "16px" }}
      title={fullText}
      type="button"
    >
      <Icon className="mt-[3px] h-3 w-3 shrink-0 opacity-80" aria-hidden="true" />
      <span
        className={cn(
          "block min-w-0",
          isExpanded ? "whitespace-normal break-words" : "truncate",
        )}
      >
        <span className="font-medium">{label}</span>
        <span className="font-normal opacity-70"> · {why.detail}</span>
      </span>
    </button>
  );
}

function reasonLabelFor(why: PlannerWhy) {
  if (why.label.trim()) {
    return why.label;
  }
  if (why.source === "replan") return "Re-plan";
  if (why.source === "weakness") return "Weakness";
  return "New";
}

function reasonKindFor(why: PlannerWhy): ReasonKind {
  const label = why.label.toLowerCase();
  if (label.includes("carryover") || label.includes("continue")) {
    return "carryover";
  }
  if (why.source === "replan" || label.includes("re-plan")) return "replan";
  if (why.source === "weakness" || label.includes("weakness")) return "weakness";
  return "new";
}

function fallbackReasonFor(item: TodayDoseItem): PlannerWhy {
  if (item.source === "weakness") {
    return {
      source: "weakness",
      label: "Weakness",
      detail: "Targets a pattern that needs reinforcement.",
    };
  }
  if (item.source === "replan") {
    return {
      source: "replan",
      label: "Re-plan",
      detail: "Added after recent self-ratings changed the plan.",
    };
  }
  if (item.source === "review") {
    return {
      source: "review",
      label: "Carryover",
      detail: "Kept here because this review loop is still open.",
    };
  }
  return {
    source: "plan",
    label: "New",
    detail: "Next Hot 150 problem in your readiness plan.",
  };
}

function TagList({ tags }: { tags: string[] }) {
  const visibleTags = tags.slice(0, 4);
  const hiddenCount = Math.max(tags.length - visibleTags.length, 0);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
      {visibleTags.map((tag) => (
        <span
          className="max-w-32 truncate rounded-full border border-border/70 bg-muted/20 px-2 py-0.5 text-xs leading-4 text-muted-foreground"
          key={tag}
          style={{ fontSize: 11, lineHeight: "16px" }}
          title={tag}
        >
          {tag}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span
          className="rounded-full border border-border/70 bg-muted/20 px-2 py-0.5 text-xs leading-4 text-muted-foreground"
          style={{ fontSize: 11, lineHeight: "16px" }}
        >
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function ReviewFocusPanel({ board }: { board: ReviewFocusBoard }) {
  const cards = board.cards;
  const visibleCards = cards.slice(0, 3);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Review Focus</h2>
        </div>
        {cards.length > 0 ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/notebook">See All</Link>
          </Button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2">
        {visibleCards.length > 0 ? (
          visibleCards.map((card, index) => (
            <ReviewProblemCardView
              card={reviewFocusCardForSystem(card)}
              key={`${card.problemId}-${index}`}
            />
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
            No priority review cards today.
          </p>
        )}
      </div>
    </div>
  );
}

function reviewFocusCardForSystem(card: ReviewProblemCard): ReviewProblemCard {
  const pattern = englishSystemText(card.primaryPatternTag, "");
  const fallback = pattern
    ? `Review the latest ${pattern} issue before retrying.`
    : "Review the latest diagnosed issue before retrying.";

  return {
    ...card,
    trapSummary: englishSystemText(card.trapSummary, fallback),
  };
}

function ProposalPanel({
  busyProposalId,
  error,
  onDecide,
  proposals,
}: {
  busyProposalId: string | null;
  error: string | null;
  onDecide: (proposalId: string, decision: "accept" | "reject") => void;
  proposals: PlannerProposalDto[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Re-plan Proposals</h2>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3">
        {proposals.length > 0 ? (
          proposals.map((proposal) => (
            <article
              className="rounded-md border border-amber-200 bg-amber-50 p-3"
              key={proposal.id}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-amber-950">
                    Re-plan with{" "}
                    {proposal.targetLeetcodeNumber
                      ? `LC ${proposal.targetLeetcodeNumber} · `
                      : ""}
                    {proposal.targetProblemTitle ?? "reinforcement problem"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    {proposal.reason}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={busyProposalId === proposal.id}
                  onClick={() => onDecide(proposal.id, "accept")}
                  size="sm"
                  type="button"
                >
                  Accept
                </Button>
                <Button
                  disabled={busyProposalId === proposal.id}
                  onClick={() => onDecide(proposal.id, "reject")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Reject
                </Button>
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
            No pending changes. Planner will propose a visible adjustment when repeated struggle appears.
          </p>
        )}
      </div>
    </div>
  );
}
