import { CandidateRow } from "./episode-row";
import { ladderConfidence } from "../fact-display";
import type { LedgerCandidate } from "../ledger-types";

/**
 * Pending candidates: one sighting each, so they hold a single rung and are not
 * yet facts. Stating the promotion rule makes the mechanism predictable rather
 * than magical — the learner can see what a second sighting would do.
 */
export function CandidateBand({
  candidates,
  total,
}: {
  candidates: LedgerCandidate[];
  total: number;
}) {
  if (candidates.length === 0) return null;

  return (
    <details className="mt-5 rounded-md border border-l-[3px] border-amber-200 border-l-amber-500 bg-amber-50/60">
      <summary className="cursor-pointer list-none px-4 py-3">
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <strong className="text-sm font-semibold">
            {total} candidates waiting on a second sighting
          </strong>
          <span className="font-mono text-[11px] tabular-nums text-amber-700">
            all at {ladderConfidence(1).toFixed(2)} · ×1 · one rung
          </span>
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="mb-2 max-w-[76ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Seen once, so not yet a fact. Meet the same mechanism again and it
          promotes to {ladderConfidence(2).toFixed(2)} — that promotion is the
          growth this page records. Showing the {candidates.length} most recent.
        </p>
        {candidates.map((candidate) => (
          <CandidateRow candidate={candidate} key={candidate.id} />
        ))}
      </div>
    </details>
  );
}
