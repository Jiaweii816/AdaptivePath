"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Loader2, Route, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignPlanningReviewView } from "@/server/campaign";

type DecisionResponse =
  | { ok: true; result: { kind: string; message: string } }
  | { ok: false; code?: string; error?: string };

export function CampaignPatchApproval({
  planning,
  onDecision,
}: {
  planning: CampaignPlanningReviewView;
  onDecision: (message: string) => void;
}) {
  const router = useRouter();
  const patch = planning.pendingPatch;
  const [reviewIndividually, setReviewIndividually] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [acceptBudget, setAcceptBudget] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(patch?.operations.map((operation) => operation.operationId) ?? []),
  );

  const selectedCount = selectedIds.size;
  const operationCount = patch?.operations.length ?? 0;
  const hasBudgetSuggestion = Boolean(
    patch?.dailyBudgetSuggestion || (patch?.dateBudgetSuggestions?.length ?? 0) > 0,
  );
  const budgetFresh = !patch?.externalDataStale
    && !patch?.dateBudgetSuggestions?.some((suggestion) => suggestion.stale);
  const patchLegal = Boolean(patch?.canAccept && !patch.isStale);
  const rationaleSummary = useMemo(() => {
    if (!patch) return "";
    return patch.rationale.length > 220 ? `${patch.rationale.slice(0, 217)}…` : patch.rationale;
  }, [patch]);

  async function submitDecision(
    decision:
      | { action: "accept_all"; acceptDailyBudgetSuggestion: boolean }
      | { action: "partial_accept"; acceptedOperationIds: string[]; acceptDailyBudgetSuggestion: boolean }
      | { action: "reject"; rejectionReason?: string },
  ) {
    if (!patch) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaign/patches/${encodeURIComponent(patch.patchId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decision),
      });
      const data = await response.json() as DecisionResponse;
      if (!response.ok || !data.ok) {
        throw new Error(!data.ok ? data.error : undefined);
      }
      onDecision(englishSystemText(data.result.message, decision.action === "reject"
        ? "The proposal was rejected. Today remains unchanged."
        : "The approved future-route changes were applied. Today remains unchanged."));
      router.refresh();
    } catch (decisionError) {
      setError(decisionError instanceof Error
        ? englishSystemText(decisionError.message, "This route proposal could not be processed. Refresh and try again.")
        : "This route proposal could not be processed. Refresh and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function submitPartialSelection() {
    if (!patch) return;
    if (selectedCount === 0) {
      setError("Select at least one route change, or reject the proposal.");
      return;
    }
    if (selectedCount === operationCount) {
      void submitDecision({ action: "accept_all", acceptDailyBudgetSuggestion: acceptBudget });
      return;
    }
    void submitDecision({
      action: "partial_accept",
      acceptedOperationIds: patch.operations
        .map((operation) => operation.operationId)
        .filter((operationId) => selectedIds.has(operationId)),
      acceptDailyBudgetSuggestion: acceptBudget,
    });
  }

  function rejectPatch() {
    const trimmed = rejectionReason.trim();
    void submitDecision({ action: "reject", ...(trimmed ? { rejectionReason: trimmed } : {}) });
  }

  if (!patch) return null;

  return (
    <section
      aria-labelledby="proposal-review-heading"
      className="scroll-mt-6 overflow-hidden rounded-xl border border-primary/30 border-l-4 border-l-primary bg-background shadow-md shadow-primary/5"
      id="proposal-review"
    >
      <div className="border-b border-border bg-primary/[0.045] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Proposal review</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight" id="proposal-review-heading">A future-route proposal is awaiting review</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {englishSystemText(rationaleSummary, "Review the proposed future-route changes before anything is applied.")}
            </p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-primary/20 bg-background px-3 py-2">
              <dt className="text-muted-foreground">Approval status</dt>
              <dd className="mt-1 font-semibold text-primary">Awaiting review</dd>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2">
              <dt className="text-muted-foreground">Patch legality</dt>
              <dd className={`mt-1 font-semibold ${patchLegal ? "text-emerald-700" : "text-red-700"}`}>{patchLegal ? "Valid" : "Invalid"}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Valid means deterministic route validation passed. It does not mean you accepted the proposal.</p>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {patch.isStale ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            This proposal is based on an earlier route version. It can be rejected, but it cannot be applied.
          </div>
        ) : null}

        <section aria-labelledby="proposal-route-diff-heading">
          <h4 className="text-sm font-semibold" id="proposal-route-diff-heading">Route diff</h4>
          <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
            {patch.operations.map((operation) => (
              <label className={`flex items-start gap-3 p-3 ${reviewIndividually ? "cursor-pointer" : ""}`} key={operation.operationId}>
                {reviewIndividually ? (
                  <input
                    aria-label={`Select change: ${englishSystemText(operation.readableDescription, "Route change")}`}
                    checked={selectedIds.has(operation.operationId)}
                    className="mt-1 h-4 w-4 accent-primary"
                    disabled={submitting || patch.isStale || !operation.selectable}
                    onChange={(event) => {
                      const next = new Set(selectedIds);
                      if (event.target.checked) next.add(operation.operationId);
                      else next.delete(operation.operationId);
                      setSelectedIds(next);
                      setError(null);
                    }}
                    type="checkbox"
                  />
                ) : <Route className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{englishSystemText(operation.readableDescription, operation.title)}</span>
                  <span className="mt-2 grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <span className="rounded bg-muted/50 px-2 py-1.5"><span className="text-muted-foreground">Before: </span>{englishSystemText(operation.beforeValue, "Not set")}</span>
                    <span className="hidden text-muted-foreground sm:inline">→</span>
                    <span className="rounded bg-primary/[0.07] px-2 py-1.5"><span className="text-muted-foreground">After: </span>{englishSystemText(operation.afterValue, "Not set")}</span>
                  </span>
                  {operation.warnings.map((warning) => <span className="mt-2 block text-xs text-amber-700" key={warning}>{englishSystemText(warning, "This change needs attention.")}</span>)}
                </span>
              </label>
            ))}
          </div>
        </section>

        {hasBudgetSuggestion ? (
          <section aria-labelledby="proposal-budget-heading">
            <h4 className="text-sm font-semibold" id="proposal-budget-heading">Daily budget suggestions</h4>
            <div className="mt-2 space-y-2">
              {patch.dailyBudgetSuggestion ? (
                <BudgetSuggestion
                  currentBudget={patch.dailyBudgetSuggestion.currentBudget}
                  label="Future dates"
                  proposedBudget={patch.dailyBudgetSuggestion.proposedBudget}
                  rationale={patch.dailyBudgetSuggestion.rationale}
                />
              ) : null}
              {patch.dateBudgetSuggestions?.map((suggestion) => (
                <BudgetSuggestion
                  currentBudget={suggestion.currentBudget}
                  key={suggestion.campaignDate}
                  label={suggestion.campaignDate}
                  proposedBudget={suggestion.maxQuestions}
                  rationale={suggestion.rationale}
                />
              ))}
            </div>
            <p className="mt-2 text-xs font-medium text-amber-800">Pending suggestion — not applied</p>
            {reviewIndividually ? (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  checked={acceptBudget}
                  className="h-4 w-4 accent-primary"
                  disabled={submitting || patch.isStale || !budgetFresh}
                  onChange={(event) => setAcceptBudget(event.target.checked)}
                  type="checkbox"
                />
                Apply the daily budget suggestions
              </label>
            ) : null}
          </section>
        ) : null}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/25 p-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          Today&apos;s materialized DailyTask is unchanged.
        </div>

        {reviewIndividually ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">{selectedCount} of {operationCount} route changes selected</p>
              <Button disabled={submitting || !patch.canPartiallyAccept || selectedCount === 0} onClick={submitPartialSelection} size="sm" type="button">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                Apply selected changes
              </Button>
            </div>
            <label className="mt-3 block text-xs text-muted-foreground" htmlFor="patch-rejection-reason">Optional rejection reason</label>
            <textarea
              className="mt-1 min-h-16 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              disabled={submitting}
              id="patch-rejection-reason"
              maxLength={500}
              onChange={(event) => setRejectionReason(event.target.value)}
              value={rejectionReason}
            />
          </div>
        ) : null}

        {error ? <p aria-live="assertive" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            disabled={submitting || !patch.canAccept}
            onClick={() => void submitDecision({ action: "accept_all", acceptDailyBudgetSuggestion: hasBudgetSuggestion && budgetFresh })}
            type="button"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            Accept all
          </Button>
          <Button aria-expanded={reviewIndividually} onClick={() => setReviewIndividually((current) => !current)} type="button" variant="outline">
            Review individually / Partial accept <ChevronDown className={`h-4 w-4 transition-transform ${reviewIndividually ? "rotate-180" : ""}`} />
          </Button>
          <Button disabled={submitting || !patch.canReject} onClick={rejectPatch} type="button" variant="destructive">
            <X className="h-4 w-4" aria-hidden="true" /> Reject
          </Button>
        </div>
      </div>
    </section>
  );
}

function BudgetSuggestion({
  currentBudget,
  label,
  proposedBudget,
  rationale,
}: {
  currentBudget: number;
  label: string;
  proposedBudget: number;
  rationale: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <span className="min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <span className="mt-1 block text-sm">Current/default: {currentBudget} → Suggested: {proposedBudget}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{englishSystemText(rationale, "A future-date task cap was suggested.")}</span>
      </span>
    </div>
  );
}
