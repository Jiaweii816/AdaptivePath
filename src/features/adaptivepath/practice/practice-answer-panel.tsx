"use client";
import { ChevronRight } from "lucide-react";
import { describeLedgerChange } from "../mastery-labels";
import type { PracticeResponse } from "./practice-api";

export const MIN_EXPLANATION_CHARS = 12;
type Feedback = NonNullable<PracticeResponse["feedback"]>;

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  return <div data-testid="submit-feedback" className={"rounded-lg border p-4 text-sm " + (feedback.correct ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50")}>
    <p className="font-semibold">{feedback.correct ? "Correct" : `Not quite — the answer was ${feedback.correctAnswer}`}</p>
    <p className="mt-2 leading-6">{feedback.explanation}</p>
    {feedback.changes.length > 0 && <ul className="mt-3 space-y-1 border-t border-black/10 pt-2 text-xs text-slate-600">
      {feedback.changes.map((c) => <li key={c.conceptId + c.l1EventId}>{describeLedgerChange(c)}</li>)}
    </ul>}
    {feedback.changes.length === 0 && <p className="mt-3 text-xs text-slate-500">Integrated answer recorded as evidence only; no sub-topic judgment changed.</p>}
  </div>;
}

export function PracticeAnswerPanel(props: {
  view: PracticeResponse | null; option: string; explanation: string; pending: boolean; feedback: Feedback | null;
  onOption: (id: string) => void; onExplanation: (text: string) => void; onSubmit: () => void;
}) {
  const { view, option, explanation, pending } = props;
  const question = view?.question;
  return <section aria-label="Student Workspace Panel" className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:mx-1 lg:min-h-0">
    <div className="border-b border-slate-200 p-5"><p className="text-xs font-bold uppercase tracking-wider text-teal-700">Student Workspace</p>
      <h2 className="mt-2 text-xl font-semibold">Think, select, and explain</h2>
      <p className="mt-1 text-sm text-slate-500">Asking the tutor or opening the textbook is recorded with your answer.</p></div>
    <div className="flex-1 space-y-5 overflow-y-auto p-5">
      {!view ? <p className="text-sm">Loading…</p> : question ? <>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Choose an answer</legend>
          {question.options.map((o) => <label key={o.id} className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm " + (option === o.id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50")}>
            <input type="radio" name="biology-answer" checked={option === o.id} onChange={() => props.onOption(o.id)} />{o.id}. {o.text}</label>)}
        </fieldset>
        <label className="block text-sm font-semibold" htmlFor="reasoning">Explain your reasoning (Claim · Evidence · Reasoning)</label>
        <textarea id="reasoning" value={explanation} onChange={(e) => props.onExplanation(e.target.value)} rows={6}
          placeholder="State your claim, use evidence about the alleles, and explain the mechanism…"
          className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-teal-600" />
        <button onClick={props.onSubmit} disabled={!option || explanation.trim().length < MIN_EXPLANATION_CHARS || pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          Submit Answer <ChevronRight size={17} /></button>
      </> : <div className="rounded-xl bg-teal-50 p-5 text-teal-900"><h3 className="font-semibold">All questions completed</h3><p className="mt-2 text-sm">Open the Learner Profile to review your mastery ledger.</p></div>}
      {props.feedback && <FeedbackCard feedback={props.feedback} />}
    </div>
  </section>;
}
