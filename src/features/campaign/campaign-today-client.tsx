"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  ChevronUp,
  Circle,
  Flag,
  Flame,
  FlaskConical,
  Gauge,
  Gem,
  Leaf,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Trophy,
  Wrench,
} from "lucide-react";
import { getOrCreateBrowserInstanceId } from "@/features/workbench/browser-instance";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignTodayState, CampaignTodayView } from "@/server/campaign";
import { CampaignMiniMap } from "./campaign-mini-map";
import { CampaignProactiveDashboard } from "./campaign-proactive-dashboard";
import { CampaignStateCard } from "./campaign-state-card";
import { CampaignStrategistPanel } from "./campaign-strategist-panel";

type TodayResponse = { ok: true; view: CampaignTodayState } | { ok: false; error?: string };

export function CampaignTodayClient({ initialView }: { initialView: CampaignTodayState }) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [loading, setLoading] = useState(
    initialView.kind === "campaign" && initialView.taskStatus === "not_materialized" && !initialView.ended,
  );
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [advancingDay, setAdvancingDay] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const materialized = useRef(false);

  async function materialize() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/campaign/today", { method: "POST" });
      const data = await response.json() as TodayResponse;
      if (!response.ok || !data.ok) throw new Error(!data.ok ? data.error : undefined);
      setView(data.view);
    } catch {
      setError("Today's task could not be prepared. No duplicate task was created; please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!materialized.current && initialView.kind === "campaign" && initialView.taskStatus === "not_materialized" && !initialView.ended) {
      materialized.current = true;
      void materialize();
    }
  }, [initialView]);

  async function enterTask(taskItemId: string) {
    const browserInstanceId = getOrCreateBrowserInstanceId();
    if (!browserInstanceId) {
      setError("This browser tab could not be identified, so the Campaign task cannot be opened safely.");
      return;
    }
    setStartingId(taskItemId);
    setError(null);
    try {
      const response = await fetch(`/api/campaign/task-items/${encodeURIComponent(taskItemId)}/attempt`, {
        method: "POST",
        headers: { "x-patterncoach-browser-instance-id": browserInstanceId },
      });
      const data = await response.json() as { ok: boolean; workbenchUrl?: string; error?: string };
      if (!response.ok || !data.ok || !data.workbenchUrl) throw new Error(data.error);
      router.push(data.workbenchUrl);
    } catch {
      setError("This task could not be opened safely. Refresh Today and try again.");
      setStartingId(null);
    }
  }

  async function advanceToNextDay() {
    const carriedForward = view.kind === "campaign" && view.hasUnsettledItems;
    setAdvancingDay(true);
    setError(null);
    try {
      const response = await fetch("/api/campaign/next-day", { method: "POST" });
      const data = await response.json() as TodayResponse;
      if (!response.ok || !data.ok) throw new Error(!data.ok ? data.error : undefined);
      setView(data.view);
      setDecisionMessage(data.view.kind === "campaign"
        ? carriedForward
          ? `Unfinished work was carried into Campaign day ${data.view.campaignDate}.`
          : `Advanced to Campaign day ${data.view.campaignDate}.`
        : null);
    } catch (error) {
      setError(error instanceof Error
        ? englishSystemText(error.message, "The next Campaign day could not be prepared.")
        : "The next Campaign day could not be prepared.");
    } finally {
      setAdvancingDay(false);
    }
  }

  if (view.kind !== "campaign") return <CampaignStateCard kind={view.kind} />;
  const dashboardKey = `${view.proactiveDashboard.replan.status}:${view.proactiveDashboard.replan.proposals.map((proposal) => proposal.id).join(",")}:${view.proactiveDashboard.replan.overflowRepairs.map((repair) => repair.id).join(",")}:${view.proactiveDashboard.reviewFocus.status}:${view.proactiveDashboard.reviewFocus.board.cards.map((card) => card.problemId).join(",")}`;

  return (
    <main className="campaign-page campaign-today-page">
      <div className="campaign-content-frame">
        {decisionMessage ? <div aria-live="polite" className="campaign-inline-notice campaign-inline-notice--success">{decisionMessage}</div> : null}
        <TodayHeader view={view} />

        <div className="campaign-today-top-grid">
          <CampaignOverview view={view} />
          <CampaignMiniMap
            masteredCount={view.masteredTransferableCount}
            phaseLabel={view.phaseLabel}
            preview={view.routePreview}
            repairPool={view.repairPool}
            totalCount={view.totalTransferableCount}
          />
          <CampaignProactiveDashboard initialDashboard={view.proactiveDashboard} key={`replan-${dashboardKey}`} panel="replan" />
        </div>

        <div className="campaign-today-work-grid">
          <CampaignDailyTaskPanel advancingDay={advancingDay} advanceToNextDay={advanceToNextDay} enterTask={enterTask} error={error} loading={loading} materialize={materialize} startingId={startingId} view={view} />
          <CampaignProactiveDashboard initialDashboard={view.proactiveDashboard} key={`review-${dashboardKey}`} panel="reviewFocus" />
        </div>

        <CampaignStrategistPanel
          campaignDate={view.campaignDate}
          initialStrategist={view.strategist}
          onPatchDecision={(message) => {
            setDecisionMessage(message);
            setView((current) => current.kind === "campaign" ? { ...current, planning: { status: "idle", pendingPatch: null } } : current);
          }}
          planning={view.planning}
        />
      </div>
    </main>
  );
}

function TodayHeader({ view }: { view: CampaignTodayView }) {
  const streak = view.routePreview.currentPositiveStreak;
  return (
    <header className="campaign-page-header">
      <div className="campaign-page-header__identity">
        <p className="campaign-eyebrow campaign-eyebrow--with-icon"><span className="campaign-eyebrow__seal"><Gauge className="h-3 w-3" aria-hidden="true" /></span>{englishSystemText(view.campaignLabel, "Hot-150 Campaign")}</p>
        <h1 className="campaign-display">Campaign Today</h1>
        <p className="campaign-page-header__date"><CalendarDays className="h-4 w-4" aria-hidden="true" />{view.campaignDate}<span aria-hidden="true" />{view.timezone}</p>
      </div>
      <div className="campaign-stat-chips" aria-label="Campaign status">
        <TodayMetric icon={ShieldCheck} label="Phase" tone="mint" value={englishSystemText(view.phaseLabel, "Coverage")} />
        <TodayMetric icon={Trophy} label="Mastered" tone="gold" value={`${view.masteredTransferableCount} / ${view.totalTransferableCount}`} />
        <TodayMetric icon={CalendarDays} label="Days left" tone="mint" value={String(Math.max(0, view.remainingDays))} />
        <TodayMetric icon={Flame} label="Streak" tone="orange" value={String(streak)} />
      </div>
    </header>
  );
}

function TodayMetric({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  tone: "mint" | "gold" | "orange";
  value: string;
}) {
  return (
    <div className={`campaign-stat-chip campaign-stat-chip--${tone}`}>
      <span className="campaign-stat-chip__icon"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span><span className="campaign-stat-chip__label">{label}</span><strong>{value}</strong></span>
    </div>
  );
}

function CampaignOverview({ view }: { view: CampaignTodayView }) {
  const streak = view.routePreview.currentPositiveStreak;
  const repairCount = view.repairPool?.pendingNodeCount ?? view.routePreview.pendingRepairCount;
  const masteryPercent = view.totalTransferableCount > 0 ? (view.masteredTransferableCount / view.totalTransferableCount) * 100 : 0;
  return (
    <section aria-labelledby="campaign-overview-heading" className="campaign-overview">
      <header className="campaign-overview__header"><span className="campaign-overview__header-title" id="campaign-overview-heading"><Gem className="h-3.5 w-3.5" aria-hidden="true" />Campaign overview</span><ChevronUp className="h-4 w-4" aria-hidden="true" /></header>
      <dl className="campaign-overview__facts">
        <OverviewRow icon={CalendarDays} label="Days remaining" value={view.remainingDays >= 0 ? String(view.remainingDays) : "Complete"} />
        <OverviewRow icon={Check} label="Settled today" value={`${view.settledCount} / ${view.plannedCount}`} />
        <OverviewRow icon={Trophy} label="Mastered nodes" value={`${view.masteredTransferableCount} / ${view.totalTransferableCount}`} />
        <OverviewRow icon={Flag} label="Current phase" value={englishSystemText(view.phaseLabel, "Coverage")} />
      </dl>
      <div className="campaign-overview__streak-block">
        <CampaignStreakRing percent={Math.max(masteryPercent, streak > 0 ? 22 : 0)} streak={streak} />
        <div className="campaign-overview__streak-copy">
          <h3>Streak</h3>
          <p><Flame className="h-3.5 w-3.5" aria-hidden="true" />Positive streak: {streak}</p>
          <p className={repairCount > 0 ? "campaign-overview__recovery" : ""}><Wrench className="h-3.5 w-3.5" aria-hidden="true" />Recovery: {repairCount}</p>
        </div>
      </div>
      <footer className="campaign-overview__footer">
        <p><strong>Keep the momentum going!</strong></p>
        {view.repairPool ? <Link href={`/campaign/roadmap#node-${encodeURIComponent(view.repairPool.highestPriorityNode.nodeId)}`}>Review recovery node <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
      </footer>
    </section>
  );
}

function CampaignStreakRing({ percent, streak }: { percent: number; streak: number }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <div className="campaign-streak-ring" aria-label={`${streak} day positive streak`}>
      <svg aria-hidden="true" viewBox="0 0 96 96"><circle cx="48" cy="48" fill="none" r={radius} stroke="#d6dfde" strokeDasharray="4 4" strokeWidth="4" /><circle cx="48" cy="48" fill="none" r={radius} stroke="#79bcb2" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" strokeWidth="4" transform="rotate(-90 48 48)" /></svg>
      <span><Flame className="h-4 w-4" aria-hidden="true" /><strong>{streak}</strong></span>
    </div>
  );
}

function OverviewRow({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return <div><dt><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</dt><dd>{value}</dd></div>;
}

function CampaignDailyTaskPanel({
  advancingDay,
  advanceToNextDay,
  enterTask,
  error,
  loading,
  materialize,
  startingId,
  view,
}: {
  advancingDay: boolean;
  advanceToNextDay: () => Promise<void>;
  enterTask: (taskItemId: string) => Promise<void>;
  error: string | null;
  loading: boolean;
  materialize: () => Promise<void>;
  startingId: string | null;
  view: CampaignTodayView;
}) {
  return (
    <section aria-labelledby="daily-task-heading" className="campaign-mission-panel">
      <header className="campaign-panel-heading campaign-panel-heading--lean">
        <div><p className="campaign-eyebrow"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Today&apos;s tasks</p><h2 className="sr-only" id="daily-task-heading">Today&apos;s Tasks</h2><p>Complete today&apos;s required Campaign work. Progress settles after Review; unfinished work can continue tomorrow.</p></div>
        {view.canAdvanceToNextDay && view.nextCampaignDate ? (
          <button
            aria-label={`${view.hasUnsettledItems ? "Carry unfinished work into" : "Open"} next Campaign day ${view.nextCampaignDate}`}
            className="campaign-next-day-button"
            disabled={advancingDay}
            onClick={() => void advanceToNextDay()}
            title={`${view.hasUnsettledItems ? "Carry unfinished work into" : "Next"} Campaign day: ${view.nextCampaignDate}`}
            type="button"
          >
            {advancingDay ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{view.hasUnsettledItems ? "Carry forward" : "Next day"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span className="campaign-settled-chip"><Circle className="h-3.5 w-3.5" aria-hidden="true" />{view.settledCount} / {view.plannedCount} settled</span>
        )}
      </header>
      {error ? <div aria-live="assertive" className="campaign-inline-notice campaign-inline-notice--error">{error}<button onClick={() => void materialize()} type="button"><RefreshCw className="h-3.5 w-3.5" />Try again</button></div> : null}
      {view.ended && view.items.length === 0 ? <p className="campaign-panel-empty">This Campaign is complete, so no new daily task will be generated.</p> : view.taskStatus === "no_task" ? <p className="campaign-panel-empty">No task meets today&apos;s availability and cooldown rules.</p> : view.items.length === 0 ? <p aria-live="polite" className="campaign-panel-empty">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Preparing today&apos;s task…</p> : <ol className="campaign-mission-list">{view.items.map((item, index) => <CampaignTaskRow enterTask={enterTask} item={item} key={item.taskItemId} startingId={startingId} showConnector={index < view.items.length - 1} />)}</ol>}
      {view.shortfall ? <div className="campaign-shortfall">Scheduled {view.shortfall.selected} of {view.shortfall.requested} tasks. The system did not repeat problems or bypass cooldowns.</div> : null}
    </section>
  );
}

function CampaignTaskRow({
  enterTask,
  item,
  showConnector,
  startingId,
}: {
  enterTask: (taskItemId: string) => Promise<void>;
  item: CampaignTodayView["items"][number];
  showConnector: boolean;
  startingId: string | null;
}) {
  const Icon = item.slotRole === "remedial" ? Wrench : item.slotRole === "probe" ? FlaskConical : item.slotRole === "mixed" ? Shuffle : item.isCarryover ? RefreshCw : Leaf;
  const baseStatus = item.slotRole === "remedial" ? "Recover" : item.slotRole === "probe" ? "Baseline check" : item.slotRole === "mixed" ? "Mixed" : "New";
  const status = item.isCarryover ? `Continue ${baseStatus}` : baseStatus;
  return (
    <li className="campaign-mission-row">
      <div className="campaign-mission-row__index"><span>{String(item.order).padStart(2, "0")}</span>{showConnector ? <i aria-hidden="true" /> : null}</div>
      <span className={`campaign-mission-row__icon campaign-mission-row__icon--${item.slotRole}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="campaign-mission-row__copy">
        <div><h3>{item.problemTitle}</h3><span className={`campaign-task-badge campaign-task-badge--${item.slotRole}`}>{status}</span></div>
        <p>{item.slotRole === "mixed" ? "Pattern reveals after settlement" : item.visibleNode ? `Learning node: ${englishSystemText(item.visibleNode.nodeName, "Current route")}` : item.problemSlug}</p>
      </div>
      <div className="campaign-mission-row__actions">
        <Bookmark className="campaign-mission-row__bookmark" aria-label="Task reference" />
        {item.status === "settled" ? <>
          {item.reviewUrl ? <Link aria-label={`Redo Review for ${item.problemTitle}`} className="campaign-review-button" href={item.reviewUrl}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /><span>Redo Review</span></Link> : null}
          <span className="campaign-mission-row__done"><Check className="h-3.5 w-3.5" aria-hidden="true" />Done</span>
        </> : <button aria-label={`${item.canResume ? "Continue" : "Start"} ${item.problemTitle}`} className={`campaign-start-button${item.canResume ? " campaign-start-button--continue" : ""}`} disabled={startingId !== null} onClick={() => void enterTask(item.taskItemId)} type="button">{startingId === item.taskItemId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{item.canResume ? "Continue" : "Start"}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}
      </div>
    </li>
  );
}
