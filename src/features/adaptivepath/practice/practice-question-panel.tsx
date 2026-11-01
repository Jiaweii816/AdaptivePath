"use client";
import { BookOpen } from "lucide-react";
import { ProblemStatement } from "@/components/workbench/problem-statement";
import { getConcept, OPENSTAX_URL } from "../concepts";
import { TextbookViewer } from "../textbook-viewer";
import type { PracticeResponse } from "./practice-api";

const REASON_LABELS = {
  frontier_concept: "Next sub-topic on your learning path",
  integrated_review: "Integrated review across three sub-topics",
} as const;

function PickSummary({ view }: { view: PracticeResponse }) {
  const { question, pick } = view;
  const exhausted = pick.exhaustedConceptIds.map((id) => getConcept(id).name);
  return <div className="mb-3 space-y-1 text-xs text-slate-500">
    {question && pick.kind === "question" && <>
      <p><span data-testid="current-concept-name" className="font-semibold text-slate-700">{question.conceptIds.map((id) => getConcept(id).name).join(" · ")}</span>
        {" "}<span>({question.conceptIds.map((id) => getConcept(id).nameZh).join(" · ")})</span></p>
      <p>Difficulty: <span data-testid="current-difficulty">{question.difficulty}</span> · {REASON_LABELS[pick.reason]}</p>
    </>}
    {exhausted.length > 0 && <p className="text-amber-700">Question pool exhausted for: {exhausted.join(", ")}</p>}
  </div>;
}

type ReferenceProps = { view: PracticeResponse; open: boolean; highlight: readonly string[] | null; pending: boolean; onToggle: () => void };

function ReferenceSection({ view, open, highlight, pending, onToggle }: ReferenceProps) {
  const { question, activity } = view;
  if (!question) return null;
  const label = open ? "Hide reference" : activity.referenceUsed ? "Show reference" : "Reveal reference (counts as reference use)";
  return <>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-bold">Textbook Reference</h3>
      <button type="button" onClick={onToggle} disabled={pending} aria-expanded={open} aria-controls="adaptivepath-reference-content"
        className="text-xs font-semibold text-teal-700 underline disabled:opacity-50">{label}</button>
    </div>
    <div id="adaptivepath-reference-content">
      {activity.referenceUsed && <p className="mb-3 text-xs font-medium text-amber-700">Reference used for this question</p>}
      {highlight && open && <p className="mb-2 text-xs text-teal-700">Showing the passage the coach cited</p>}
      {open ? <TextbookViewer key={`${question.id}:${highlight?.join(",") ?? ""}`} chunkIds={highlight ?? question.chunkIds} /> :
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Reference hidden. Opening it records this attempt as completed with the textbook.</p>}
    </div>
  </>;
}

export function PracticeQuestionPanel(props: {
  view: PracticeResponse | null; referenceOpen: boolean; highlightChunkIds: readonly string[] | null; pending: boolean; onToggleReference: () => void;
}) {
  const { view } = props;
  const question = view?.question;
  return <section aria-label="Problem Panel" className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
    <div className="border-b border-slate-200 p-5">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><BookOpen size={15} /> Question</div>
      {view && <PickSummary view={view} />}
      <ProblemStatement dense problem={{
        slug: question?.id ?? "biology-complete", title: question?.objective ?? "Completed",
        statementMarkdown: question?.prompt ?? "All available activities completed.", tags: [], examples: [], constraints: [],
      }} />
      {question && question.assumptions.length > 0 && <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <p className="font-semibold">Assumptions</p>
        <ul className="mt-1 list-disc pl-4">{question.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>}
    </div>
    <div className="flex-1 overflow-y-auto p-5">
      {view && <ReferenceSection view={view} open={props.referenceOpen} highlight={props.highlightChunkIds} pending={props.pending} onToggle={props.onToggleReference} />}
      <p className="mt-3 text-xs text-slate-500">Source: OpenStax Biology 2e, Section 12.2. Access for free at <a href={OPENSTAX_URL} target="_blank" rel="noreferrer" className="text-teal-700 underline">openstax.org</a>. CC BY-NC-SA 4.0.</p>
    </div>
  </section>;
}
