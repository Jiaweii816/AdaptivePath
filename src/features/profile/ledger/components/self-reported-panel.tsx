import { ArrowRight } from "lucide-react";
import { TagChip } from "@/components/shared/tag-chip";
import { cn } from "@/lib/utils";
import type {
  LedgerFact,
  SelfReportedAudit,
  SelfReportedVerdict,
} from "../ledger-types";

const VERDICT_CLASS: Record<SelfReportedVerdict, string> = {
  contradicted: "bg-rose-600 text-white",
  split: "bg-amber-500 text-white",
  confirmed: "bg-emerald-600 text-white",
  unobserved: "bg-muted text-muted-foreground",
};

const VERDICT_LABEL: Record<SelfReportedVerdict, string> = {
  contradicted: "contradicted",
  split: "both true",
  confirmed: "confirmed",
  unobserved: "no evidence yet",
};

function summarize(facts: LedgerFact[]) {
  const lead = facts[0];
  if (!lead) return null;
  const extra = facts.length - 1;
  return `${lead.mechanismKey} at ${lead.confidence.toFixed(2)} (×${lead.evidenceCount})${
    extra > 0 ? ` and ${extra} more` : ""
  }`;
}

function AuditRow({ audit }: { audit: SelfReportedAudit }) {
  const positive = summarize(audit.positiveFacts);
  const negative = summarize(audit.negativeFacts);

  return (
    <div className="grid items-center gap-x-3.5 gap-y-2 rounded-md border border-border bg-card px-4 py-3 sm:grid-cols-[minmax(140px,190px)_24px_minmax(0,1fr)]">
      <div className="font-mono text-xs">
        <span className="mb-1 block font-sans text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          you said · {audit.claimedAs}
        </span>
        {audit.label}
      </div>
      <ArrowRight
        aria-hidden="true"
        className="hidden h-3.5 w-3.5 justify-self-center text-muted-foreground sm:block"
      />
      <div className="min-w-0 text-[13px] leading-normal text-foreground/80">
        <span
          className={cn(
            "mb-1 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.07em]",
            VERDICT_CLASS[audit.verdict],
          )}
        >
          {VERDICT_LABEL[audit.verdict]}
        </span>
        {audit.verdict === "unobserved" ? (
          <p>
            No established fact maps to this pattern yet, so the ledger has
            nothing to agree or disagree with.
          </p>
        ) : (
          <ul className="grid gap-0.5">
            {positive ? (
              <li>
                <span className="font-semibold text-emerald-800">Can do:</span>{" "}
                {positive}
              </li>
            ) : null}
            {negative ? (
              <li>
                <span className="font-semibold text-rose-800">Gets wrong:</span>{" "}
                {negative}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Onboarding self-assessment set against the ledger. It sits off the spine
 * because it carries no evidence rows and cannot gain confidence — it is not a
 * memory layer. It earns its place by showing where the learner's self-image and
 * the recorded evidence disagree.
 */
export function SelfReportedPanel({
  audits,
  preferences,
}: {
  audits: SelfReportedAudit[];
  preferences: string[];
}) {
  const disagreements = audits.filter(
    (audit) => audit.verdict === "contradicted" || audit.verdict === "split",
  ).length;

  return (
    <section className="mt-2 border-t-2 border-dashed border-border pt-7">
      <span className="mb-2.5 inline-block rounded border border-dashed border-border bg-muted/50 px-2.5 py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
        off the spine · not a memory layer
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight">
          Self-reported
        </h2>
        <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {audits.length} onboarding patterns · 0 evidence rows
        </span>
      </div>
      <p className="mt-1.5 max-w-[76ch] text-[12.5px] leading-relaxed text-muted-foreground">
        What you chose during onboarding. It never enters the evidence ledger and
        cannot gain confidence, so it hangs beside the tiers rather than on them.
        {disagreements > 0
          ? ` The ledger currently disagrees with ${disagreements} of ${audits.length}.`
          : ""}
      </p>

      <div className="mt-4 grid gap-2">
        {audits.map((audit) => (
          <AuditRow audit={audit} key={`${audit.claimedAs}-${audit.label}`} />
        ))}
      </div>

      {preferences.length > 0 ? (
        <>
          <p className="mt-5 max-w-[76ch] text-[12.5px] leading-relaxed text-muted-foreground">
            Preferences carried forward unchanged — these steer the coach&apos;s
            output shape, not its beliefs.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {preferences.map((preference) => (
              <TagChip key={preference} label={preference} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
