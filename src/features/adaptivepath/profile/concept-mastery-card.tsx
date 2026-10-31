"use client";
import { useState } from "react";
import type { Concept } from "../concepts";
import { describeLedgerChange, levelLabel } from "../mastery-labels";
import type { ProfileData } from "./profile-types";

type Props = Readonly<{ concept: Concept; state: ProfileData["states"][number] | undefined; rows: ProfileData["rows"] }>;

export function ConceptMasteryCard({ concept, state, rows }: Props) {
  const [open, setOpen] = useState(false);
  const evidence = rows.filter((r) => r.effect !== "ineligible").length;
  return <article data-testid="concept-card" className="rounded-md border border-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{concept.name}</h3>
        <p className="text-xs text-muted-foreground">{concept.nameZh}</p>
      </div>
      <div className="text-right text-xs">
        <p className="font-semibold">{state ? levelLabel(state.level) : "Not assessed"}</p>
        <p className="text-muted-foreground">{state ? `Stability ${state.stability}` : "—"} · {evidence} evidence</p>
      </div>
    </div>
    <button type="button" onClick={() => setOpen((v) => !v)} disabled={rows.length === 0}
      className="mt-3 text-xs font-semibold text-primary underline disabled:no-underline disabled:opacity-50">
      {open ? "Hide ledger" : "Show ledger"}
    </button>
    {open && <ol className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
      {rows.map((r) => <li data-testid="ledger-row" key={r.l1EventId} className="flex flex-wrap gap-x-2">
        <span className="font-mono text-muted-foreground">{new Date(r.occurredAt).toLocaleString()}</span>
        <span className="font-mono text-muted-foreground">{r.questionId}</span>
        <span>{describeLedgerChange(r)}</span>
        <span className="font-mono text-muted-foreground">{r.ruleVersion}</span>
      </li>)}
    </ol>}
  </article>;
}
