import { cn } from "@/lib/utils";
import { ReviewFlag } from "./ledger-atoms";
import type { LedgerFact } from "../ledger-types";
import { formatLedgerDay } from "../format-day";

const ROLE_MARK: Record<string, string> = {
  execution_success: "✓",
  execution_failure: "✕",
  learner_statement: "”",
  assisted_repair: "↺",
};

const ROLE_CLASS: Record<string, string> = {
  execution_success: "bg-emerald-600 text-white",
  execution_failure: "bg-rose-600 text-white",
  learner_statement: "bg-amber-500 text-white",
  assisted_repair: "bg-emerald-700 text-white",
};

const AUTHORITY_CLASS: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  observed: "bg-amber-50 text-amber-800 ring-amber-200/70",
  explicit: "bg-white text-emerald-800 ring-emerald-300",
};

function EvidenceHead({ fact }: { fact: LedgerFact }) {
  const stated = fact.evidence.length - fact.verifiedCount;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 py-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.11em] text-muted-foreground">
      <span>Evidence · {fact.evidence.length} rows</span>
      <span>{fact.verifiedCount} verified</span>
      <span>{stated} stated</span>
      <span>{fact.distinctProblemCount} problems</span>
      <span className="font-sans text-[11px] font-medium normal-case tracking-normal text-muted-foreground/80">
        raw factType: {fact.factType}
      </span>
    </div>
  );
}

/**
 * The contribution rows behind one fact. Rows are the traceable truth; when the
 * stored `evidenceCount` exceeds them the gap is stated rather than papered over
 * by printing only the larger number.
 */
export function EvidenceTable({ fact }: { fact: LedgerFact }) {
  return (
    <>
      <EvidenceHead fact={fact} />
      {fact.evidence.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Role", "Authority", "Problem", "When"].map((label) => (
                  <th
                    className="whitespace-nowrap border-b border-border pb-1.5 pr-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground"
                    key={label}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fact.evidence.map((row, index) => (
                <tr key={`${row.role}-${row.problemTitle}-${index}`}>
                  <td className="border-b border-border/50 py-2 pr-2.5 align-top">
                    <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[11.5px] text-foreground/80">
                      <span
                        className={cn(
                          "grid h-[18px] w-[18px] place-items-center rounded-sm font-mono text-[11px] font-bold leading-none",
                          ROLE_CLASS[row.role] ?? "bg-muted text-foreground",
                        )}
                      >
                        {ROLE_MARK[row.role] ?? "·"}
                      </span>
                      {row.role}
                    </span>
                  </td>
                  <td className="border-b border-border/50 py-2 pr-2.5 align-top">
                    <span
                      className={cn(
                        "whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.05em] ring-1",
                        AUTHORITY_CLASS[row.authority] ??
                          "bg-muted text-foreground ring-border",
                      )}
                    >
                      {row.authority}
                    </span>
                  </td>
                  <td className="border-b border-border/50 py-2 pr-2.5 align-top">
                    {row.problemTitle ?? "Cross-problem"}
                  </td>
                  <td className="whitespace-nowrap border-b border-border/50 py-2 pr-2.5 align-top font-mono text-[11.5px] text-muted-foreground">
                    {formatLedgerDay(row.observedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          No contribution rows can be traced for this fact.
        </p>
      )}
      {fact.untraceableCount > 0 ? (
        <ReviewFlag label="gap">
          <code className="font-mono text-[11.5px]">
            evidenceCount = {fact.evidenceCount}
          </code>{" "}
          but the contribution ledger holds{" "}
          <code className="font-mono text-[11.5px]">{fact.evidence.length}</code>{" "}
          rows. The ladder follows the stored count; this table shows what can
          actually be traced.
        </ReviewFlag>
      ) : null}
    </>
  );
}
