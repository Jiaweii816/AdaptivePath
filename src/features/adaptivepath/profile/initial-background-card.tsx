import Link from "next/link";
import { BIOLOGY_UNITS } from "../onboarding/catalog";
import type { BiologyOnboardingMetadata } from "../onboarding/types";
import { CONCEPTS } from "../concepts";

export function InitialBackgroundCard({onboarding}:{onboarding:BiologyOnboardingMetadata|null}){
  if(!onboarding)return <section className="rounded-md border border-border bg-card p-5">
    <h2 className="font-semibold">Initial Learning Background</h2>
    <p className="mt-2 text-sm text-muted-foreground">Not yet collected. A short optional onboarding gives the Coach a useful starting point.</p>
    <Link className="mt-2 inline-block text-sm text-primary underline" href="/adaptivepath/onboarding">Start onboarding</Link>
  </section>;
  const topic=(id:string)=>CONCEPTS.find(c=>c.id===id)?.name??id;
  return <section aria-label="Initial Learning Background" className="rounded-md border border-border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">Initial Learning Background</h2>
      <span className="text-xs text-muted-foreground">Local metadata · preliminary (not L2 mastery)</span>
    </div>
    {onboarding.status==="skipped"?<p className="mt-3 text-sm text-muted-foreground">Skipped. The Coach will learn from future independent practice.</p>:<>
      <p className="mt-3 text-sm"><strong>Studied areas:</strong> {onboarding.studiedUnits.length?
        BIOLOGY_UNITS.filter(u=>onboarding.studiedUnits.includes(u.id)).map(u=>u.title).join(", "):
        "None selected / unsure"}</p>
      <p className="mt-2 text-sm"><strong>Reported genetics familiarity:</strong> {onboarding.geneticsFamiliarity}</p>
      <p className="mt-2 text-sm"><strong>Teaching preference:</strong> {onboarding.supportPreference.replaceAll("_"," ")}</p>
      <p className="mt-2 text-sm"><strong>Prerequisite checks:</strong> {onboarding.diagnosticCorrect}/{onboarding.diagnosticCount}; not a mastery score</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {onboarding.conceptSignals.map(signal=><div key={signal.conceptId} className="rounded-md bg-muted p-3 text-sm">
          <strong className="block">{topic(signal.conceptId)}</strong>
          <span className="text-muted-foreground">{signal.status.replaceAll("_"," ")} · {signal.confidence} confidence</span>
        </div>)}
      </div>
    </>}
    <p className="mt-4 text-xs text-muted-foreground">This starting context influences the local Coach policy. It never replaces evidence-based L2 judgments. Only approved, non-identifying teaching instructions reach an external model.</p>
    <Link className="mt-3 inline-block text-sm text-primary underline" href="/adaptivepath/onboarding">Update learning background</Link>
  </section>;
}
