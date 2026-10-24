import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FactRow } from "./fact-row";
import { GateReadout, ReviewFlag, SlotKindPill } from "./ledger-atoms";
import type { LedgerSynthesisSlot } from "../ledger-types";
import { formatLedgerDay } from "../format-day";

/** Below this, a slot cleared the cross-problem gate by its bare minimum. */
const TIGHT_GATE_THRESHOLD = 3;

/**
 * One cross-problem synthesis slot. The card shows the gate the memory system
 * enforces; the model's proposed confidence sits in the drawer because nothing
 * recomputes it and it must not read as a measured score.
 */
export function SlotCard({
  slot,
  twinNotes,
}: {
  slot: LedgerSynthesisSlot;
  twinNotes: Map<string, string>;
}) {
  const tight =
    slot.clusterCount < TIGHT_GATE_THRESHOLD ||
    slot.problemCount < TIGHT_GATE_THRESHOLD;

  return (
    <details
      className={cn(
        "group rounded-md border border-l-[3px] border-border bg-card",
        slot.polarity === "negative"
          ? "border-l-rose-600"
          : slot.polarity === "positive"
            ? "border-l-emerald-600"
            : "border-l-amber-500",
      )}
    >
      <summary className="cursor-pointer list-none rounded-md px-4 py-3 hover:bg-muted/40">
        <div className="flex items-start gap-3.5">
          <p className="min-w-0 flex-1 text-pretty text-base font-medium leading-snug">
            {slot.text}
          </p>
          <GateReadout
            clusterCount={slot.clusterCount}
            problemCount={slot.problemCount}
            tight={tight}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          <SlotKindPill polarity={slot.polarity} slot={slot.slot} />
          <span>
            {slot.facts.length} cited L2{" "}
            {slot.facts.length === 1 ? "fact" : "facts"}
          </span>
          <span>{formatLedgerDay(slot.updatedAt)}</span>
          <ChevronRight
            aria-hidden="true"
            className="h-3 w-3 text-primary transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
        </div>
      </summary>
      <div className="-mt-px border-t border-border/60 px-4 pb-4">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 py-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
          <span>Descends to L2 · {slot.facts.length}</span>
          <span className="font-sans text-[11px] font-medium normal-case tracking-normal text-muted-foreground/80">
            model proposed {slot.proposedConfidence.toFixed(2)} · not computed
          </span>
        </div>
        <div className="grid gap-2">
          {slot.facts.map((fact) => (
            <FactRow fact={fact} key={fact.id} twin={twinNotes.get(fact.id)} />
          ))}
        </div>
        {tight ? (
          <ReviewFlag label="gate">
            Cleared the cross-problem gate by its minimum: {slot.clusterCount}{" "}
            independent {slot.clusterCount === 1 ? "cluster" : "clusters"} across{" "}
            {slot.problemCount}{" "}
            {slot.problemCount === 1 ? "problem" : "problems"}. Treat it as a
            weaker generalization than the wide slots above.
          </ReviewFlag>
        ) : null}
      </div>
    </details>
  );
}
