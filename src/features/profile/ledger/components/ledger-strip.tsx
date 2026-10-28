import { cn } from "@/lib/utils";
import type { LedgerTotals } from "../ledger-types";

export type LedgerStripCell = {
  label: string;
  value: number;
  note: string;
  tone?: "primary" | "warn";
};

function buildCells(totals: LedgerTotals): LedgerStripCell[] {
  return [
    {
      label: "L3 synthesis",
      value: totals.activeSlots,
      note: "active slots",
      tone: "primary",
    },
    {
      label: "L2 established",
      value: totals.activeFacts,
      note: "active facts",
      tone: "primary",
    },
    {
      label: "L2 candidate",
      value: totals.candidateFacts,
      note: "awaiting 2nd sighting",
      tone: "warn",
    },
    {
      label: "Evidence rows",
      value: totals.evidenceRows,
      note: `${totals.verifiedEvidenceRows} verified / ${
        totals.evidenceRows - totals.verifiedEvidenceRows
      } stated`,
    },
    {
      label: "Episodes",
      value: totals.episodes,
      note: `${totals.reviewEpisodes} review / ${totals.chatEpisodes} chat`,
    },
    {
      label: "Problems cited",
      value: totals.citedProblems,
      note: "in the evidence ledger",
    },
    { label: "L1 trace", value: totals.traceEvents, note: "raw events" },
  ];
}

/** Biology and programming profiles share this visual; their evidence counts do not share a data model. */
export function LedgerStrip({ totals, cells }: { totals?: LedgerTotals; cells?: LedgerStripCell[] }) {
  const displayCells = cells ?? (totals ? buildCells(totals) : []);
  return (
    <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-md border border-border bg-card sm:grid-cols-4 lg:grid-cols-7">
      {displayCells.map((cell) => (
        <div
          className="border-b border-r border-border/60 px-4 py-3.5 last:border-r-0"
          key={cell.label}
        >
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {cell.label}
          </dt>
          <dd
            className={cn(
              "mt-1.5 font-mono text-[23px] font-semibold leading-none tabular-nums tracking-tight",
              cell.tone === "primary" && "text-primary",
              cell.tone === "warn" && "text-amber-700",
            )}
          >
            {cell.value.toLocaleString("en")}
          </dd>
          <span className="mt-1.5 block text-[11px] text-muted-foreground">
            {cell.note}
          </span>
        </div>
      ))}
    </dl>
  );
}
