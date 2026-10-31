"use client";
import { getConcept } from "../concepts";
import type { ProfileData } from "./profile-types";

const names = (ids: readonly string[]) => (ids.length ? ids.map((id) => getConcept(id).name).join(", ") : "None yet");

export function ProfileSummaryCard({ profile }: { profile: ProfileData["latestProfile"] }) {
  if (!profile) {
    return <section className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground">
      No answers yet. Your profile appears after the first submitted question.
      <p className="mt-2 text-xs">Tutor note: pending LLM generation</p>
    </section>;
  }
  const { card } = profile;
  const d = card.levelDistribution;
  return <section aria-label="Section profile" className="rounded-md border border-border bg-card p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold">Section {card.sectionId} profile</h2>
      <span className="font-mono text-[11px] text-muted-foreground">version {profile.version} · rules {card.basedOnRuleVersion}</span>
    </div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
      {([["Not assessed", d.unassessed], ["Not yet", d.level0], ["With tutor", d.level1], ["With reference", d.level2], ["Independent", d.level3]] as const)
        .map(([label, value]) => <div key={label} className="rounded-md bg-muted p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold">{value}</dd></div>)}
    </dl>
    <div className="mt-4 space-y-2 text-sm">
      <p><span className="font-semibold">Strengths:</span> {names(card.strengths)}</p>
      <p><span className="font-semibold">Gaps:</span> {names(card.gaps)}</p>
      <p><span className="font-semibold">Prerequisite gaps:</span> {card.prerequisiteGaps.length
        ? card.prerequisiteGaps.map((g) => `${getConcept(g.conceptId).name} ← ${getConcept(g.prerequisiteId).name}`).join("; ")
        : "None"}</p>
    </div>
    <p className="mt-4 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
      {profile.noteText ? profile.noteText : "Tutor note: pending LLM generation"}
    </p>
  </section>;
}
