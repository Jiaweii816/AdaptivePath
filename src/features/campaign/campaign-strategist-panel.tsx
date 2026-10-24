"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Circle,
  FlaskConical,
  Loader2,
  Minus,
  Send,
  Wand2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { englishSystemText } from "@/lib/system-copy";
import type {
  CampaignPlanningReviewView,
  CampaignStrategistCandidateView,
  CampaignStrategistProductView,
} from "@/server/campaign";
import { CampaignPatchApproval } from "./campaign-patch-approval";
import { campaignDecorativeAssets } from "./campaign-decorative-assets";

type ApiFailure = { ok: false; code?: string; message?: string; error?: string };
type StatusResponse = { ok: true; strategist: CampaignStrategistProductView; planning?: CampaignPlanningReviewView } | ApiFailure;
type RunResponse = { ok: true; result: { kind: string; runId: string | null; status: string | null; runMode?: "proposal" | "simulation" } } | ApiFailure;
type VisibleError = Readonly<{ httpStatus: number; code: string; message: string }>;
type RetryAction =
  | Readonly<{ kind: "create"; runMode: "proposal" | "simulation"; text: string }>
  | Readonly<{ kind: "status"; runId?: string }>
  | Readonly<{ kind: "resume"; answer: string; calendarAuthorization?: { decision: "allow"; rangeStart: string; rangeEnd: string } | { decision: "deny" } }>;

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function visibleError(response: Response, failure: ApiFailure | null, fallback: string): VisibleError {
  return {
    httpStatus: response.status,
    code: failure?.code ?? `http_${response.status}`,
    message: englishSystemText(failure?.message ?? failure?.error, fallback),
  };
}

const branchLabels = {
  optimistic: "Optimistic path",
  observed_supported: "Recent-evidence path",
  conservative: "Conservative path",
} as const;

const reachabilityLabels = {
  reachable: "Reached",
  partially_reachable: "Partially reached",
  unreachable: "Not reached",
  unknown: "Insufficient evidence",
} as const;

function initialVisibleStrategist(view: CampaignStrategistProductView): CampaignStrategistProductView {
  if (view.latestRun?.resultKind !== "failed") return view;
  return {
    ...view,
    routeRisk: {
      level: "clear",
      label: "No blocking risk found",
      detail: "The active roadmap is unchanged. Start a new check when needed.",
    },
    latestRun: null,
  };
}

export function CampaignStrategistPanel({
  campaignDate,
  initialStrategist,
  onPatchDecision,
  planning,
}: {
  campaignDate: string;
  initialStrategist: CampaignStrategistProductView;
  onPatchDecision: (message: string) => void;
  planning: CampaignPlanningReviewView;
}) {
  // A failed run remains visible when it finishes in this mounted session, but
  // it does not return as a persistent dashboard warning after a page reload.
  const [strategist, setStrategist] = useState(() => initialVisibleStrategist(initialStrategist));
  const [planningView, setPlanningView] = useState(planning);
  // A completed run is history, not a draft. New visits always start from an
  // empty proposal composer; the learner must explicitly choose to reuse an
  // earlier request or switch to What-if mode.
  const [mode, setMode] = useState<"proposal" | "simulation">("proposal");
  const [requestText, setRequestText] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<VisibleError | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);
  const [trackedRunId, setTrackedRunId] = useState<string | null>(() =>
    initialStrategist.latestRun && ["queued", "running"].includes(initialStrategist.latestRun.status)
      ? initialStrategist.latestRun.runId
      : null,
  );
  const inFlight = useRef(false);
  const latest = strategist.latestRun;
  const active = latest?.status === "queued" || latest?.status === "running";
  const hasPendingProposal = Boolean(planningView.pendingPatch);

  function scrollToProposalReview() {
    document.getElementById("proposal-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const refreshStatus = useCallback(async (runId?: string) => {
    try {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
      const response = await fetch(`/api/campaign/strategist/runs${query}`, { method: "GET", cache: "no-store" });
      const data = await responseJson<StatusResponse>(response);
      if (!response.ok || !data?.ok) {
        setError(visibleError(response, data && !data.ok ? data : null, "Strategist could not be refreshed. Today is unaffected."));
        setRetryAction({ kind: "status", ...(runId ? { runId } : {}) });
        if (runId) setTrackedRunId(null);
        return false;
      }
      setStrategist(data.strategist);
      if (data.planning) setPlanningView(data.planning);
      setError(null);
      setRetryAction(null);
      const refreshedRun = data.strategist.latestRun;
      if (runId && refreshedRun && !["queued", "running"].includes(refreshedRun.status)) setTrackedRunId(null);
      return true;
    } catch {
      setError({ httpStatus: 0, code: "network_error", message: "Strategist could not be reached. Today is unaffected." });
      setRetryAction({ kind: "status", ...(runId ? { runId } : {}) });
      if (runId) setTrackedRunId(null);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!trackedRunId || latest?.runId !== trackedRunId || !active) return;
    const timer = window.setInterval(() => void refreshStatus(trackedRunId), 1_500);
    return () => window.clearInterval(timer);
  }, [active, latest?.runId, refreshStatus, trackedRunId]);

  async function createRun(runMode: "proposal" | "simulation", text = requestText) {
    if (inFlight.current) return;
    if (hasPendingProposal) {
      setError({ httpStatus: 409, code: "pending_patch", message: "A proposal is already awaiting review." });
      setRetryAction(null);
      scrollToProposalReview();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      setError({ httpStatus: 0, code: "request_required", message: "Describe the future route adjustment or simulation you want." });
      setRetryAction(null);
      return;
    }
    setMode(runMode);
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setRetryAction(null);
    try {
      const response = await fetch("/api/campaign/strategist/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignDate, requestText: trimmed, runMode }),
      });
      const data = await responseJson<RunResponse>(response);
      if (!response.ok || !data?.ok) {
        const visible = visibleError(response, data && !data.ok ? data : null, "Strategist could not start.");
        if (visible.code === "pending_patch" || visible.code === "pending_patch_exists") {
          setError({ ...visible, message: "A proposal is already awaiting review." });
          setRetryAction(null);
          await refreshStatus();
        } else {
          setError(visible);
          setRetryAction({ kind: "create", runMode, text: trimmed });
        }
        return;
      }
      if (!data.result.runId) {
        setError({ httpStatus: response.status, code: "missing_run_id", message: "Strategist responded without a trackable run." });
        setRetryAction({ kind: "create", runMode, text: trimmed });
        return;
      }
      setTrackedRunId(data.result.runId);
      await refreshStatus(data.result.runId);
    } catch {
      setError({ httpStatus: 0, code: "network_error", message: "Strategist could not be reached. Try again." });
      setRetryAction({ kind: "create", runMode, text: trimmed });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function resumeRun(
    resumeAnswer: string,
    calendarAuthorization?: { decision: "allow"; rangeStart: string; rangeEnd: string } | { decision: "deny" },
  ) {
    if (!latest || inFlight.current) return;
    const trimmed = resumeAnswer.trim();
    if (!trimmed) {
      setError({ httpStatus: 0, code: "answer_required", message: "Answer this decision question before continuing." });
      setRetryAction(null);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setRetryAction(null);
    try {
      const response = await fetch(`/api/campaign/strategist/runs/${encodeURIComponent(latest.runId)}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: trimmed, ...(calendarAuthorization ? { calendarAuthorization } : {}) }),
      });
      const data = await responseJson<RunResponse>(response);
      if (!response.ok || !data?.ok) {
        setError(visibleError(response, data && !data.ok ? data : null, "This route run could not be resumed."));
        setRetryAction({ kind: "resume", answer: trimmed, ...(calendarAuthorization ? { calendarAuthorization } : {}) });
        return;
      }
      setAnswer("");
      setTrackedRunId(latest.runId);
      await refreshStatus(latest.runId);
    } catch {
      setError({ httpStatus: 0, code: "network_error", message: "Strategist could not be reached. Try again." });
      setRetryAction({ kind: "resume", answer: trimmed, ...(calendarAuthorization ? { calendarAuthorization } : {}) });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function retry() {
    if (!retryAction) return;
    if (retryAction.kind === "create") void createRun(retryAction.runMode, retryAction.text);
    else if (retryAction.kind === "resume") void resumeRun(retryAction.answer, retryAction.calendarAuthorization);
    else {
      if (retryAction.runId) setTrackedRunId(retryAction.runId);
      void refreshStatus(retryAction.runId);
    }
  }

  const riskTone = strategist.routeRisk.level === "attention"
    ? "border-amber-200 bg-amber-50/70 text-amber-950"
    : strategist.routeRisk.level === "checking"
      ? "border-sky-200 bg-sky-50/70 text-sky-950"
      : "border-emerald-200 bg-emerald-50/60 text-emerald-950";

  return (
    <section aria-labelledby="strategist-heading" className="campaign-strategist">
      <div className="campaign-strategist__content">
      <div className="campaign-strategist__header">
        <div className="campaign-strategist__identity">
          <span><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
          <div>
            <p className="campaign-eyebrow" style={{ margin: 0 }}>Strategist</p>
            <h2 className="sr-only" id="strategist-heading">Strategist</h2>
            <p>Plan ahead with smart adjustments and what-if scenarios.</p>
          </div>
        </div>
        <div className="campaign-strategist__segments" role="group" aria-label="Strategist mode">
          <Button aria-pressed={mode === "proposal"} className="shadow-none" disabled={submitting} onClick={() => setMode("proposal")} size="sm" type="button" variant={mode === "proposal" ? "default" : "ghost"}>
            <Wand2 className="h-3.5 w-3.5" /> Adjust future route
          </Button>
          <Button aria-pressed={mode === "simulation"} className="shadow-none" disabled={submitting} onClick={() => setMode("simulation")} size="sm" type="button" variant={mode === "simulation" ? "default" : "ghost"}>
            <FlaskConical className="h-3.5 w-3.5" /> Run what-if
          </Button>
        </div>
      </div>

      <div className="campaign-strategist__body">
        <div className="campaign-strategist__composer-grid">
          <aside className="campaign-strategist__intro">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
            <div><h3>How can I help you plan?</h3><p>Describe your goals or constraints and I&apos;ll suggest the best adjustments.</p></div>
          </aside>
          <div className="campaign-strategist__composer">
            <label className="sr-only" htmlFor="strategist-request">Your planning request</label>
            <p className="sr-only" id="strategist-request-help">Include deadlines, priorities, daily caps, and target depth.</p>
            {latest?.requestSummary ? (
              <button className="campaign-strategist__loaded" onClick={() => setRequestText(latest.requestSummary ?? "")} type="button">
                Reuse previous request
              </button>
            ) : null}
            <textarea
              aria-describedby="strategist-request-help"
              id="strategist-request"
              maxLength={2_000}
              onChange={(event) => setRequestText(event.target.value)}
              placeholder={mode === "proposal" ? "Example: Prioritize graph problems next week, cap Monday and Tuesday at 3 tasks." : "Example: Would an exposure goal for Graphs be more feasible over the next two weeks?"}
              value={requestText}
            />
            <div className="campaign-strategist__composer-footer">
              <div className="campaign-strategist__quick-prompts" aria-label="Quick planning prompts">
                {["Focus more on graphs", "Ease off math this week", "Add recovery time", "Shorten daily load"].map((prompt) => <button key={prompt} onClick={() => setRequestText(prompt)} type="button">{prompt}</button>)}
              </div>
              {hasPendingProposal ? (
                <Button onClick={scrollToProposalReview} size="sm" type="button" variant="outline">Review proposal</Button>
              ) : (
                <Button aria-label={mode === "proposal" ? "Generate route proposal" : "Run what-if simulation"} className="campaign-strategist__send" disabled={submitting || requestText.trim().length === 0} onClick={() => void createRun(mode)} size="icon" type="button">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>
          <div aria-hidden="true" className="campaign-strategist__orb"><Image alt="" className="object-contain" fill loading="eager" sizes="210px" src={campaignDecorativeAssets.strategistOrb} unoptimized /></div>
        </div>

        <div className="campaign-strategist__secondary">
        {!hasPendingProposal && strategist.routeRisk.level !== "clear" ? <div className={`campaign-strategist__risk ${riskTone}`}><p>{strategist.routeRisk.label}</p><span>{strategist.routeRisk.detail}</span></div> : null}
        {hasPendingProposal ? <div className="campaign-strategist__proposal-callout"><div><span><Check className="h-4 w-4" /></span><div><p>Latest proposal</p><strong>Your proposal is ready for a decision</strong><small>You can inspect its details without exposing internal planning traces.</small></div></div><Button onClick={scrollToProposalReview} size="sm" type="button">View details</Button></div> : null}
        {error ? (
          <div aria-live="assertive" className="campaign-strategist__error" role="alert">
            <p>{error.message}</p>
            <small>HTTP {error.httpStatus || "network"} · {error.code}</small>
            {error.code === "pending_patch" || error.code === "pending_patch_exists" ? (
              <Button className="mt-3" onClick={scrollToProposalReview} size="sm" type="button" variant="outline">Review proposal</Button>
            ) : retryAction ? <Button className="mt-3" disabled={submitting} onClick={retry} size="sm" type="button" variant="outline">Try again</Button> : null}
          </div>
        ) : null}

        {latest ? (
          <details className="campaign-strategist__previous">
            <summary>Previous planning attempt <ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
          <div className="campaign-strategist__latest">
            <div className="campaign-strategist__latest-card">
              <div>
                <p>Latest {latest.runMode === "simulation" ? "simulation" : "proposal"}</p>
                <h3>{latest.resultKind === "simulation_complete" ? "Simulation complete" : englishSystemText(latest.statusLabel, "Status updated")}</h3>
                {latest.publicSummary ? <p>{englishSystemText(latest.publicSummary, "Strategist completed this route assessment.")}</p> : null}
              </div>
              <div className="campaign-strategist__latest-status">
                {active ? <Loader2 aria-label="Strategist is running" className="h-5 w-5 animate-spin text-primary" /> : (
                  <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${latest.resultKind === "proposal_pending" ? "bg-primary/10 text-primary" : latest.resultKind === "failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {latest.resultKind === "proposal_pending" ? "Decision needed" : latest.resultKind === "failed" ? "Incomplete" : "Complete"}
                  </span>
                )}
              </div>
            </div>

            {latest.resultKind === "failed" ? (
              <div className="rounded-lg border border-red-200 bg-red-50/70 p-4 text-sm text-red-950">
                <p className="font-medium">This planning attempt did not complete.</p>
                <p className="mt-1 text-xs">{englishSystemText(latest.errorMessage, "The active roadmap was left unchanged. Try a new request when you are ready.")}</p>
              </div>
            ) : null}

            <details className="campaign-strategist__trace">
              <summary>View planning details <ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
              <ol aria-label="Strategist planning progress">
                {latest.progress.map((step) => (
                  <li className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${step.state === "complete" ? "border-emerald-200 bg-emerald-50/60" : step.state === "current" ? "border-primary/30 bg-primary/[0.04]" : "border-border text-muted-foreground"}`} key={step.key}>
                    {step.state === "complete" ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : step.state === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : step.state === "not_needed" || step.state === "not_applicable" ? <Minus className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                    {englishSystemText(step.label, "Planning step")}
                  </li>
                ))}
              </ol>
            </details>

            {latest.clarification ? (
              <ClarificationCard
                answer={answer}
                calendarConfigured={strategist.calendarConfigured}
                clarification={latest.clarification}
                onAnswerChange={setAnswer}
                onResume={(value, authorization) => void resumeRun(value, authorization)}
                submitting={submitting}
              />
            ) : null}

            {latest.externalDataStale ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-medium"><CalendarClock className="h-4 w-4" /> Calendar evidence is stale</div>
                <p className="mt-1 text-xs">A daily-cap suggestion based on this data cannot be accepted directly. Run Strategist again.</p>
              </div>
            ) : null}

            {latest.candidates.length > 0 ? (
              <details className="campaign-strategist__simulation group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 marker:content-none">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/[0.08] text-primary"><FlaskConical className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold" id="candidate-comparison-heading">{latest.candidates.length === 1 ? "Simulation result" : "Candidate comparison"}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{latest.candidates.length} {latest.candidates.length === 1 ? "candidate" : "candidates"} · Expand to inspect route changes and three simulation paths</span>
                    </span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className={`grid gap-3 border-t border-border p-4 ${latest.candidates.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
                  {latest.candidates.map((candidate) => <CandidateCard candidate={candidate} key={candidate.candidateId} selected={latest.selectedCandidateId === candidate.candidateId} />)}
                </div>
              </details>
            ) : null}

            {latest.rejectedCandidates.length > 0 ? (
              <details className="campaign-strategist__rejected">
                <summary className="cursor-pointer text-sm font-medium">Rejected candidates and reasons</summary>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {latest.rejectedCandidates.map((candidate) => <li key={candidate.candidateId}>{englishSystemText(candidate.reasons.join("; "), "Did not pass deterministic validation")}</li>)}
                </ul>
              </details>
            ) : null}

            {latest.resultKind === "simulation_complete" ? (
              <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-medium">What-if complete — your active roadmap was not changed.</p><p className="mt-1 text-xs text-muted-foreground">Creating a formal proposal starts a new proposal run, checks route freshness again, and still requires your approval before it can change future tasks.</p></div>
                <Button disabled={submitting} onClick={() => void createRun("proposal", `Create a future-route proposal based on the latest what-if result: ${englishSystemText(latest.requestSummary, "keep the simulated goals and constraints")}`)} size="sm" type="button">Create proposal</Button>
              </div>
            ) : null}

            <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Today unchanged · This planning run never rewrites a materialized task.</p>
          </div>
          </details>
        ) : null}

            {planningView.pendingPatch ? (
              <CampaignPatchApproval
                onDecision={(message) => {
                  setPlanningView({ status: "idle", pendingPatch: null });
                  onPatchDecision(message);
                  void refreshStatus();
                }}
                planning={planningView}
              />
        ) : null}
        </div>
      </div>
      </div>
    </section>
  );
}

function ClarificationCard({
  answer,
  calendarConfigured,
  clarification,
  onAnswerChange,
  onResume,
  submitting,
}: {
  answer: string;
  calendarConfigured: boolean;
  clarification: NonNullable<NonNullable<CampaignStrategistProductView["latestRun"]>["clarification"]>;
  onAnswerChange: (value: string) => void;
  onResume: (value: string, authorization?: { decision: "allow"; rangeStart: string; rangeEnd: string } | { decision: "deny" }) => void;
  submitting: boolean;
}) {
  const range = clarification.queryRange;
  return (
    <section aria-labelledby="clarification-heading" className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <h3 className="text-sm font-semibold text-amber-950" id="clarification-heading">Your decision is needed</h3>
      <p className="mt-2 text-sm text-amber-950">{englishSystemText(clarification.question, "Choose the next route-planning option.")}</p>
      {clarification.knownFacts.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-900">{clarification.knownFacts.map((fact) => <li key={fact}>{englishSystemText(fact, "A relevant route fact is available.")}</li>)}</ul> : null}
      <p className="mt-3 text-xs text-amber-900">Trade-off: {englishSystemText(clarification.tradeoff, "This choice changes the future route.")}</p>
      {clarification.calendarAuthorizationRequested ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-background/70 p-3">
          <div className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4" /> Calendar free/busy permission</div>
          <p className="mt-1 text-xs text-muted-foreground">{range ? `Query range: ${range.start} to ${range.end}.` : "Runtime did not provide a specific date range for permission."} Only free/busy intervals are read; event details are not read.</p>
          {!calendarConfigured ? <p className="mt-2 text-xs font-medium text-amber-800">Calendar MCP is not configured. You can still decline the query and continue with a target-depth adjustment or another clarification.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={submitting || !calendarConfigured || !range}
              onClick={() => range && onResume(
                `I explicitly allow a read-only Calendar free/busy query from ${range.start} to ${range.end}; do not read event details.`,
                { decision: "allow", rangeStart: `${range.start}T00:00:00.000Z`, rangeEnd: `${range.end}T00:00:00.000Z` },
              )}
              size="sm"
              type="button"
            >Allow</Button>
            <Button disabled={submitting} onClick={() => onResume("I decline the Calendar query. Use a target-depth adjustment or continue clarifying.", { decision: "deny" })} size="sm" type="button" variant="outline">Decline</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <textarea className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" maxLength={1_000} onChange={(event) => onAnswerChange(event.target.value)} placeholder="Enter your decision" value={answer} />
          <Button className="mt-2" disabled={submitting} onClick={() => onResume(answer)} size="sm" type="button">Submit and resume this run</Button>
        </div>
      )}
    </section>
  );
}

function CandidateCard({ candidate, selected }: { candidate: CampaignStrategistCandidateView; selected: boolean }) {
  return (
    <article className={`overflow-hidden rounded-lg border bg-background ${selected ? "border-primary/40" : "border-border"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Selected plan</p>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6">{englishSystemText(candidate.summary, "Route candidate")}</p>
          </div>
          <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${candidate.patchLegal ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{candidate.patchLegal ? "Patch valid" : "Patch invalid"}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {candidate.nodeChanges.length ? <List title="Route changes" items={candidate.nodeChanges.map((item) => englishSystemText(item, "Route node changed"))} /> : null}
          {candidate.goalDepthChanges.length ? <List title="Target depth" items={candidate.goalDepthChanges.map((entry) => `${englishSystemText(entry.nodeName, "Learning node")} → ${entry.goalDepth === "mastery" ? "Mastery" : "Exposure"}`)} /> : null}
          {candidate.targetByDateChanges.length ? <List title="Target date" items={candidate.targetByDateChanges.map((entry) => `${englishSystemText(entry.nodeName, "Learning node")} → ${entry.targetByDate ?? "Not set"}`)} /> : null}
          {candidate.dateBudgetSuggestions.length ? <List title="Pending caps" items={candidate.dateBudgetSuggestions.map((entry) => `${entry.campaignDate} · ${entry.maxQuestions} tasks`)} /> : null}
        </div>
      </div>
      {candidate.branches.length ? (
        <section aria-label="Three-path simulation" className="border-t border-border bg-muted/[0.12] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Three-path simulation</p>
            <p className="text-[11px] text-muted-foreground">Same plan · three evidence assumptions</p>
          </div>
          <div className="mt-3 grid items-stretch gap-3 lg:grid-cols-3">
            {candidate.branches.map((branch) => (
              <div className="h-full rounded-lg border border-border bg-background p-3.5 text-xs" key={branch.branch}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{branchLabels[branch.branch]}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${reachabilityTone(branch.horizonReachability)}`}>{reachabilityLabels[branch.horizonReachability]}</span>
                </div>
                <dl className="mt-2 space-y-2 text-muted-foreground">
                  <div>
                    <dt className="font-medium text-foreground">Earliest reachable</dt>
                    <dd className="mt-0.5">{branch.earliestReachable.length > 0
                      ? branch.earliestReachable.map((entry) => `${entry.nodeName}: ${entry.firstSelectedDate ?? entry.earliestEligibleDate ?? "Not reached"}`).join("; ")
                      : "Insufficient evidence"}</dd>
                  </div>
                  <div><dt className="font-medium text-foreground">Constraint / dependency risks</dt><dd className="mt-0.5">{riskText(branch.violations, "dependency")}</dd></div>
                  <div><dt className="font-medium text-foreground">Supply / cooldown issues</dt><dd className="mt-0.5">{riskText(branch.violations, "supply")}</dd></div>
                  <div><dt className="font-medium text-foreground">Unknowns</dt><dd className="mt-0.5">{branch.unknowns.length > 0 ? branch.unknowns.join("; ") : "None"}</dd></div>
                </dl>
                {branch.dayProjections.length > 0 ? (
                  <details className="mt-3 border-t border-border pt-2">
                    <summary className="flex cursor-pointer items-center gap-1 font-medium text-muted-foreground">Daily projection <ChevronDown className="h-3.5 w-3.5" /></summary>
                    <ul className="mt-2 space-y-2">
                      {branch.dayProjections.map((day) => (
                        <li className="rounded bg-background p-2" key={day.campaignDate}>
                          <p className="font-medium">{day.campaignDate}{day.budget === null ? "" : ` · cap ${day.budget}`}</p>
                          <p className="mt-0.5 text-muted-foreground">Nodes: {day.selectedNodeNames.length > 0 ? day.selectedNodeNames.join(", ") : "None"}</p>
                          <p className="mt-0.5 text-muted-foreground">Risks: {day.risks.length > 0 ? day.risks.join("; ") : "None"}</p>
                          <p className="mt-0.5 text-muted-foreground">Unknowns: {day.unknowns.length > 0 ? day.unknowns.join("; ") : "None"}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : <p className="mt-3 border-t border-border pt-2 text-muted-foreground">Daily projection: Insufficient evidence</p>}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function riskText(reasons: readonly string[], kind: "dependency" | "supply") {
  const matches = reasons.filter((reason) => {
    const supply = /supply|eligible problem|cooldown/i.test(reason);
    return kind === "supply" ? supply : !supply;
  });
  return matches.length > 0 ? matches.join("; ") : "None";
}

function reachabilityTone(value: CampaignStrategistCandidateView["branches"][number]["horizonReachability"]) {
  if (value === "reachable") return "bg-emerald-50 text-emerald-700";
  if (value === "partially_reachable") return "bg-amber-50 text-amber-800";
  if (value === "unreachable") return "bg-red-50 text-red-700";
  return "bg-muted text-muted-foreground";
}

function List({ items, title }: { items: readonly string[]; title: string }) {
  return <div className="rounded-md border border-border bg-muted/[0.1] p-3"><p className="text-xs font-semibold text-muted-foreground">{title}</p><ul className="mt-1.5 space-y-1 text-xs leading-5">{items.map((item) => <li key={item}>· {englishSystemText(item, "Route detail")}</li>)}</ul></div>;
}
