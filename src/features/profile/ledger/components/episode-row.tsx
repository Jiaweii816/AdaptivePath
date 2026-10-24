import { cn } from "@/lib/utils";
import type { LedgerCandidate, LedgerEpisode } from "../ledger-types";
import { formatLedgerDay } from "../format-day";

const OUTCOME_CLASS: Record<string, string> = {
  passed: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  resolved: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  failed: "bg-rose-50 text-rose-800 ring-rose-200/70",
  unresolved: "bg-amber-50 text-amber-800 ring-amber-200/70",
};

export function EpisodeRow({ episode }: { episode: LedgerEpisode }) {
  return (
    <div className="grid items-baseline gap-x-3.5 gap-y-1.5 rounded-md border border-border bg-card px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)_auto]">
      <span className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">
        {episode.kind}
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] leading-normal">{episode.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {episode.tags.map((tag) => (
            <span
              className="rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] ring-1",
            OUTCOME_CLASS[episode.outcome] ??
              "bg-muted text-foreground ring-border",
          )}
        >
          {episode.outcome}
        </span>
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatLedgerDay(episode.createdAt)}
        </span>
      </div>
    </div>
  );
}

export function CandidateRow({ candidate }: { candidate: LedgerCandidate }) {
  return (
    <div className="grid items-baseline gap-x-3 gap-y-1 border-t border-amber-200/70 py-2 sm:grid-cols-[86px_minmax(0,1fr)_auto]">
      <span className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-amber-700">
        {candidate.factType}
      </span>
      <p className="min-w-0 text-[12.5px] text-foreground/80">
        {candidate.problemTitle ? (
          <span className="font-medium text-foreground">
            {candidate.problemTitle}
            {" — "}
          </span>
        ) : null}
        {candidate.statement}
      </p>
      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatLedgerDay(candidate.lastSeenAt)}
      </span>
    </div>
  );
}
