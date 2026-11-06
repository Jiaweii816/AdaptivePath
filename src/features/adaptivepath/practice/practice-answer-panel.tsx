"use client";
import { ChevronRight } from "lucide-react";
import { describeLedgerChange } from "../mastery-labels";
import type { PracticeResponse } from "./practice-api";
import { PracticeQuestionHeader } from "./practice-question-header";
import { TYPE } from "./typography";

type Feedback = NonNullable<PracticeResponse["feedback"]>;

function FeedbackCard({ feedback, onReview }: { feedback: Feedback; onReview: (() => void) | null }) {
  return <div data-testid="submit-feedback" className={`rounded-lg border p-4 ${TYPE.body} ` + (feedback.correct ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50")}>
    <p className="font-semibold">{feedback.correct ? "Correct" : `Not quite — the answer was ${feedback.correctAnswer}`}</p>
    <p className="mt-2">{feedback.explanation}</p>
    {feedback.changes.length > 0 && <ul className="mt-3 space-y-1 border-t border-black/10 pt-2 text-[13px] text-slate-600">
      {feedback.changes.map((c) => <li key={c.conceptId + c.l1EventId}>{describeLedgerChange(c)}</li>)}
    </ul>}
    {feedback.changes.length === 0 && <p className={`mt-3 ${TYPE.secondary}`}>Integrated answer recorded as evidence only; no sub-topic judgment changed.</p>}
    {onReview && <button type="button" onClick={onReview} className="mt-3 rounded-md border border-teal-700 px-3 py-1.5 text-[13px] font-semibold text-teal-800 hover:bg-teal-100">Review this question with the coach</button>}
  </div>;
}

export function PracticeAnswerPanel(props: {
  view: PracticeResponse | null; option: string; explanation: string; pending: boolean; feedback: Feedback | null;
  quotedSpans: readonly string[]; onReview: (() => void) | null;
  onOption: (id: string) => void; onExplanation: (text: string) => void; onSubmit: () => void;
  referenceOpen: boolean; onToggleReference: () => void;
}) {
  const { view, option, explanation, pending } = props;
  const question = view?.question;
  return <section aria-label="Student Workspace Panel" className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:mx-1 lg:min-h-0">
    <div className="flex-1 space-y-6 overflow-y-auto p-6">
      {view && <PracticeQuestionHeader view={view} referenceOpen={props.referenceOpen} pending={pending} onToggleReference={props.onToggleReference} />}
      {!view ? <p className={TYPE.body}>Loading…</p> : question ? <>
        <fieldset className="space-y-2.5 border-t border-slate-200 pt-5"><legend className="contents"><span className={`block ${TYPE.heading}`}>Choose an answer</span></legend>
          <p className={`!mt-1 mb-3 ${TYPE.secondary}`}>Asking the tutor or opening the textbook is recorded with your answer.</p>
          {question.options.map((o) => <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 ${TYPE.option} ` + (option === o.id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50")}>
            <input type="radio" name="biology-answer" checked={option === o.id} onChange={() => props.onOption(o.id)} /><span><span className="font-semibold">{o.id}.</span> {o.text}</span></label>)}
        </fieldset>
        <label className={`block ${TYPE.heading}`} htmlFor="reasoning">Explain your reasoning (Claim · Evidence · Reasoning) <span className="text-[13px] font-normal text-slate-500">— optional</span></label>
        <textarea id="reasoning" value={explanation} onChange={(e) => props.onExplanation(e.target.value)} rows={6}
          placeholder="State your claim, use evidence about the alleles, and explain the mechanism…"
          className={`w-full resize-y rounded-lg border border-slate-300 p-3 outline-none focus:border-teal-600 ${TYPE.body}`} />
        {props.quotedSpans.length > 0 && <ul data-testid="coach-quotes" className="space-y-1 text-[13px] text-teal-800">
          {props.quotedSpans.map((span) => <li key={span}>Coach quoted: “{span}”</li>)}
        </ul>}
        <button onClick={props.onSubmit} disabled={!option || pending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          Submit Answer <ChevronRight size={17} /></button>
      </> : <div className="rounded-xl bg-teal-50 p-5 text-teal-900"><h3 className={TYPE.heading}>All questions completed</h3><p className={`mt-2 ${TYPE.body}`}>Open the Learner Profile to review your mastery ledger.</p></div>}
      {props.feedback && <FeedbackCard feedback={props.feedback} onReview={props.onReview} />}
    </div>
  </section>;
}
