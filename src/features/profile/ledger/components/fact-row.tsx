import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EvidenceTable } from "./evidence-table";
import {
  ConfidenceLadder,
  GroupPill,
  MechanismChip,
  ReviewFlag,
} from "./ledger-atoms";
import type { LedgerFact, LedgerFactGroup } from "../ledger-types";
import { formatLedgerDay } from "../format-day";

const EDGE_CLASS: Record<LedgerFactGroup, string> = {
  can: "border-l-emerald-600",
  wrong: "border-l-rose-600",
  work: "border-l-amber-500",
};

/**
 * One established fact. Collapsed it answers "what and how strongly"; opened it
 * answers "on what evidence" — the number is the door to its own receipts.
 */
export function FactRow({
  fact,
  twin,
}: {
  fact: LedgerFact;
  twin?: string;
}) {
  return (
    <details
      className={cn(
        "group rounded-md border border-l-[3px] border-border bg-card",
        EDGE_CLASS[fact.group],
      )}
    >
      <summary className="cursor-pointer list-none rounded-md px-4 py-3 hover:bg-muted/40">
        <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <MechanismChip>{fact.mechanismKey}</MechanismChip>
            <p className="mt-2 line-clamp-2 text-[13.5px] leading-normal text-foreground/80 group-open:line-clamp-none">
              {fact.statement}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
              <GroupPill group={fact.group} />
              <span className="font-bold text-foreground/70">
                ×{fact.evidenceCount}
              </span>
              <span>{formatLedgerDay(fact.lastSeenAt)}</span>
              <span className="inline-flex items-center gap-1 text-primary">
                <ChevronRight
                  aria-hidden="true"
                  className="h-3 w-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                />
                evidence
              </span>
            </div>
          </div>
          <ConfidenceLadder
            confidence={fact.confidence}
            group={fact.group}
            ladder={fact.ladder}
          />
        </div>
      </summary>
      <div className="-mt-px border-t border-border/60 px-4 pb-4">
        <EvidenceTable fact={fact} />
        {twin ? <ReviewFlag label="two-sided">{twin}</ReviewFlag> : null}
      </div>
    </details>
  );
}
