"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlashcardAnswer } from "@/features/review-problems/review-problem-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { englishSystemText, hasHanScript } from "@/lib/system-copy";
import type { CampaignProactiveDashboardView } from "@/server/campaign";
import type { ReviewProblemCard } from "@/server/planner/review-focus/review-focus.types";

type DashboardModule = keyof CampaignProactiveDashboardView;
type DashboardPanel = "all" | "replan" | "reviewFocus";
type DashboardResponse =
  | { ok: true; dashboard: CampaignProactiveDashboardView }
  | { ok: false; error?: string };

export function CampaignProactiveDashboard({
  initialDashboard,
  panel = "all",
}: {
  initialDashboard: CampaignProactiveDashboardView;
  panel?: DashboardPanel;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [loadingModule, setLoadingModule] = useState<DashboardModule | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [deferredProposalIds, setDeferredProposalIds] = useState<Set<string>>(() => new Set());
  const [replanMessage, setReplanMessage] = useState<string | null>(null);
  const [replanError, setReplanError] = useState<string | null>(null);

  async function retry(module: DashboardModule) {
    setLoadingModule(module);
    if (module === "replan") setReplanError(null);
    try {
      const response = await fetch("/api/campaign/dashboard", { method: "GET" });
      const data = await response.json() as DashboardResponse;
      if (!response.ok || !data.ok) throw new Error(!data.ok ? data.error : undefined);
      setDashboard((current) => ({ ...current, [module]: data.dashboard[module] }));
    } catch {
      if (module === "replan") setReplanError("Replan could not be refreshed. Try again shortly.");
    } finally {
      setLoadingModule(null);
    }
  }

  async function acceptProposal(proposalId: string) {
    setBusyProposalId(proposalId);
    setReplanError(null);
    setReplanMessage(null);
    try {
      const response = await fetch(`/api/planner/proposals/${encodeURIComponent(proposalId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accept" }),
      });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Unable to update proposal.");
      setDashboard((current) => {
        const proposals = current.replan.proposals.filter((proposal) => proposal.id !== proposalId);
        return {
          ...current,
          replan: {
            ...current.replan,
            status: proposals.length > 0 || current.replan.overflowRepairs.length > 0 ? "ready" : "empty",
            proposals,
          },
        };
      });
      setReplanMessage("This optional review was accepted. Today's required task and budget are unchanged.");
    } catch (error) {
      setReplanError(error instanceof Error
        ? englishSystemText(error.message, "This Replan proposal could not be updated.")
        : "This Replan proposal could not be updated.");
    } finally {
      setBusyProposalId(null);
    }
  }

  const visibleProposals = dashboard.replan.proposals.filter((proposal) => !deferredProposalIds.has(proposal.id));
  const visibleOverflowRepairs = dashboard.replan.overflowRepairs.filter((repair) => !deferredProposalIds.has(repair.id));
  const totalReplanItems = dashboard.replan.proposals.length + dashboard.replan.overflowRepairs.length;
  const allProposalsDeferred = totalReplanItems > 0 && visibleProposals.length + visibleOverflowRepairs.length === 0;
  const showReplan = panel !== "reviewFocus";
  const showReviewFocus = panel !== "replan";

  return (
    <aside aria-label="Campaign follow-up" className={panel === "all" ? "campaign-follow-up-stack" : "contents"}>
      {showReplan ? <ReplanPanel
        allProposalsDeferred={allProposalsDeferred}
        busyProposalId={busyProposalId}
        dashboard={dashboard}
        error={replanError}
        loading={loadingModule === "replan"}
        message={replanMessage}
        onAccept={(proposalId) => void acceptProposal(proposalId)}
        onDefer={(proposalId) => {
          setDeferredProposalIds((current) => new Set(current).add(proposalId));
          setReplanMessage("This suggestion is hidden for now and remains pending.");
        }}
        onRetry={() => void retry("replan")}
        onShowAgain={() => setDeferredProposalIds(new Set())}
        overflowRepairs={visibleOverflowRepairs}
        proposals={visibleProposals}
      /> : null}
      {showReviewFocus ? <ReviewFocusPanel dashboard={dashboard} loading={loadingModule === "reviewFocus"} onRetry={() => void retry("reviewFocus")} /> : null}
    </aside>
  );
}

function ReplanPanel({
  allProposalsDeferred,
  busyProposalId,
  dashboard,
  error,
  loading,
  message,
  onAccept,
  onDefer,
  onRetry,
  onShowAgain,
  overflowRepairs,
  proposals,
}: {
  allProposalsDeferred: boolean;
  busyProposalId: string | null;
  dashboard: CampaignProactiveDashboardView;
  error: string | null;
  loading: boolean;
  message: string | null;
  onAccept: (proposalId: string) => void;
  onDefer: (proposalId: string) => void;
  onRetry: () => void;
  onShowAgain: () => void;
  overflowRepairs: CampaignProactiveDashboardView["replan"]["overflowRepairs"];
  proposals: CampaignProactiveDashboardView["replan"]["proposals"];
}) {
  return (
    <section aria-labelledby="replan-heading" className="campaign-replan-panel">
      <header className="campaign-replan-panel__header">
        <div className="campaign-replan-panel__identity">
          <RefreshCw aria-hidden="true" />
          <h2 id="replan-heading">Replan</h2>
        </div>
        <button className="campaign-quiet-link" onClick={onRetry} type="button">
          Why replan?<ChevronRight aria-hidden="true" />
        </button>
        {loading ? <Loader2 aria-label="Refreshing Replan" className="campaign-panel-loader h-4 w-4 animate-spin" /> : null}
      </header>
      <div className="campaign-replan-panel__body">
        {message ? <p aria-live="polite" className="campaign-inline-notice campaign-inline-notice--success">{message}</p> : null}
        {error ? <ModuleError message={error} onRetry={onRetry} /> : null}
        {dashboard.replan.status === "unavailable" && !error ? <ModuleError message="Replan is unavailable. Today's required task is unaffected." onRetry={onRetry} /> : dashboard.replan.status === "empty" ? <EmptyState>No optional Replan recommendation is waiting.</EmptyState> : allProposalsDeferred ? <div className="campaign-replan-deferred">These suggestions are hidden for now and remain pending.<button onClick={onShowAgain} type="button">Show again</button></div> : <div className="campaign-side-quest-list">{overflowRepairs.map((repair) => <article className="campaign-side-quest" key={repair.id}>
          <div className="campaign-side-quest__title"><span className="campaign-side-quest__warning"><AlertTriangle aria-hidden="true" /></span><h3>{repair.targetLeetcodeNumber ? `LC ${repair.targetLeetcodeNumber} · ` : ""}{englishSystemText(repair.targetProblemTitle, `${repair.nodeName} recovery`)}</h3></div>
          <p>{repair.reason}</p>
          <span className="campaign-side-quest__optional"><i aria-hidden="true" />Recovery overflow · optional practice.</span>
          <div className="campaign-side-quest__actions">
            {repair.targetProblemSlug ? <Link className="campaign-side-quest__open" href={`/workbench?problem=${encodeURIComponent(repair.targetProblemSlug)}`}><ExternalLink aria-hidden="true" />Open</Link> : <Link className="campaign-side-quest__open" href={`/campaign/roadmap#node-${encodeURIComponent(repair.nodeId)}`}><ExternalLink aria-hidden="true" />View node</Link>}
            <button className="campaign-side-quest__later" onClick={() => onDefer(repair.id)} type="button">Later</button>
          </div>
        </article>)}{proposals.map((proposal) => <article className="campaign-side-quest" key={proposal.id}>
          <div className="campaign-side-quest__title"><span className="campaign-side-quest__warning"><AlertTriangle aria-hidden="true" /></span><h3>{proposal.targetLeetcodeNumber ? `LC ${proposal.targetLeetcodeNumber} · ` : ""}{englishSystemText(proposal.targetProblemTitle, "Targeted practice")}</h3></div>
          <p>{replanReasonForDisplay(englishSystemText(proposal.reason, "Recommended to reinforce a recent learning signal."))}</p>
          <span className="campaign-side-quest__optional"><i aria-hidden="true" />Optional review · not required task.</span>
          <div className="campaign-side-quest__actions">
            {proposal.targetProblemSlug ? <Link className="campaign-side-quest__open" href={`/workbench?problem=${encodeURIComponent(proposal.targetProblemSlug)}`}><ExternalLink aria-hidden="true" />Open</Link> : null}
            <button className="campaign-side-quest__accept" disabled={busyProposalId !== null} onClick={() => onAccept(proposal.id)} type="button">{busyProposalId === proposal.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 aria-hidden="true" />}Accept</button>
            <button className="campaign-side-quest__later" disabled={busyProposalId !== null} onClick={() => onDefer(proposal.id)} type="button">Later</button>
          </div>
        </article>)}</div>}
      </div>
    </section>
  );
}

/** Keeps deterministic proposal data intact while giving repeated-failure cards the concise learner-facing sentence from the Replan design. */
function replanReasonForDisplay(reason: string) {
  const repeatedFailure = /^You marked .+? as struggled\/unsolved (\d+) times in the last (\d+) days\.$/i.exec(reason.trim());
  if (!repeatedFailure) return reason;

  const [, count] = repeatedFailure;
  return `Struggled/unsolved ${count} ${count === "1" ? "time" : "times"} · pass 2 week`;
}

function ReviewFocusPanel({
  dashboard,
  loading,
  onRetry,
}: {
  dashboard: CampaignProactiveDashboardView;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="review-focus-heading" className="campaign-review-panel">
      <header className="campaign-panel-heading campaign-panel-heading--compact campaign-panel-heading--lean">
        <div><p className="campaign-eyebrow"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Mistake book</p><h2 className="sr-only" id="review-focus-heading">Review Focus Mistake Book</h2><p>Concrete mistakes and self-checks from Review evidence.</p></div>
        <span>{loading ? <Loader2 aria-label="Refreshing Review Focus" className="campaign-panel-loader h-4 w-4 animate-spin" /> : null}<Link href="/notebook">View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></span>
      </header>
      <div className="campaign-review-panel__body">
        {dashboard.reviewFocus.status === "unavailable" ? <ModuleError message="Review Focus is unavailable. Today's task and learning state are unaffected." onRetry={onRetry} /> : dashboard.reviewFocus.status === "empty" ? <EmptyState>No Review evidence needs priority attention.</EmptyState> : <div className="campaign-review-list">{dashboard.reviewFocus.board.cards.map((card) => <CampaignReviewFocusCard card={reviewFocusCardForCampaign(card)} key={card.problemId} />)}</div>}
      </div>
      {dashboard.reviewFocus.status === "ready" ? <footer className="campaign-review-panel__footer"><Link href="/notebook">Open Review Center <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></footer> : null}
    </section>
  );
}

function CampaignReviewFocusCard({ card }: { card: ReviewProblemCard }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const href = `/workbench?${new URLSearchParams({ problem: card.slug, ...(card.planItemId ? { planItemId: card.planItemId } : {}) }).toString()}`;
  return (
    <article className="campaign-review-item">
      <Link className="campaign-review-item__link" href={href}>
        <span aria-hidden="true" className="campaign-review-item__icon-placeholder" />
        <div className="campaign-review-item__body">
          <div className="campaign-review-item__meta"><span className="campaign-severity-chip">{card.difficulty ?? "Medium"}</span>{card.primaryPatternTag ? <span className="campaign-topic-chip">{card.primaryPatternTag}</span> : null}</div>
          <h3>{card.leetcodeNumber ? `${card.leetcodeNumber}. ` : ""}{card.title}</h3>
          <p><AlertTriangle className="h-3 w-3" aria-hidden="true" />Common trap: {card.trapSummary}</p>
        </div>
      </Link>
      <div className="campaign-review-item__actions">
        <Link className="campaign-review-item__redo" href={href}><RefreshCw aria-hidden="true" />Redo Review</Link>
        <Dialog onOpenChange={(open) => { if (!open) setShowAnswer(false); }}>
          <DialogTrigger asChild>
            <Button aria-label={`Open flashcard for ${card.title}`} className="campaign-review-item__flashcard" disabled={!card.hasFlashcard} title={card.hasFlashcard ? "Open flashcard" : "This diagnosis is incomplete, so no flashcard is available."} type="button" variant="outline"><BookOpenCheck aria-hidden="true" />Flashcard</Button>
          </DialogTrigger>
          {card.flashcard ? <DialogContent><DialogHeader><DialogTitle>{card.leetcodeNumber ? `${card.leetcodeNumber}. ` : ""}{card.title}</DialogTitle><DialogDescription>Answer the prompt first, then reveal the back of the card.</DialogDescription></DialogHeader><div className="rounded-md border border-border bg-muted/30 p-3"><p className="text-xs font-medium text-muted-foreground">Self-check prompt</p><p className="mt-2 text-sm leading-6 text-foreground">{card.flashcard.question}</p></div>{showAnswer ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><p className="text-xs font-semibold">Answer</p><FlashcardAnswer answer={card.flashcard.answer} /></div> : null}<div className="flex justify-end"><Button onClick={() => setShowAnswer((value) => !value)} size="sm" type="button" variant={showAnswer ? "outline" : "default"}>{showAnswer ? "Back to Prompt" : "Show Answer"}</Button></div></DialogContent> : null}
        </Dialog>
      </div>
    </article>
  );
}

function ModuleError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="campaign-inline-notice campaign-inline-notice--error" role="status"><p>{message}</p><button onClick={onRetry} type="button"><RefreshCw className="h-3.5 w-3.5" />Try again</button></div>;
}

function EmptyState({ children }: { children: string }) {
  return <div className="campaign-panel-empty"><Clock3 className="h-4 w-4" aria-hidden="true" />{children}</div>;
}

function reviewFocusCardForCampaign(card: ReviewProblemCard): ReviewProblemCard {
  const flashcard = card.flashcard && !hasHanScript(card.flashcard.question) && !hasHanScript(card.flashcard.answer) ? card.flashcard : null;
  const pattern = englishSystemText(card.primaryPatternTag, "");
  const fallback = pattern ? `Review the latest ${pattern} issue before retrying.` : "Review the latest diagnosed issue before retrying.";
  return {
    ...card,
    title: englishSystemText(card.title, "Review problem"),
    primaryPatternTag: pattern || null,
    trapSummary: englishSystemText(card.trapSummary, fallback),
    hasFlashcard: Boolean(flashcard),
    flashcardStatus: flashcard ? "available" : "diagnosis_unavailable",
    flashcard,
    manualEntry: undefined,
  };
}
