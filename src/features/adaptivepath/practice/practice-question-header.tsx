"use client";
/** The question at the top of the workspace, right above the answer options. */
import { BookOpen, HelpCircle } from "lucide-react";
import { getConcept } from "../concepts";
import type { PracticeResponse } from "./practice-api";
import { ACTION_LINK, TYPE } from "./typography";

const REASON_LABELS = {
  frontier_concept: "Next sub-topic on your learning path",
  integrated_review: "Integrated review across three sub-topics",
} as const;

type Question = NonNullable<PracticeResponse["question"]>;

function MetaLine({ view, question }: { view: PracticeResponse; question: Question }) {
  const { pick } = view;
  return <p className={TYPE.secondary}>
    <span data-testid="current-concept-name" className="font-semibold text-slate-700">{question.conceptIds.map((id) => getConcept(id).name).join(" · ")}</span>
    {" · "}Difficulty: <span data-testid="current-difficulty">{question.difficulty}</span>
    {pick.kind === "question" && <> · {REASON_LABELS[pick.reason]}</>}
  </p>;
}

function referenceLabel(open: boolean, used: boolean): string {
  if (open) return "Hide textbook reference";
  return used ? "Show textbook reference" : "Show textbook reference (counts as reference use)";
}

export function PracticeQuestionHeader(props: { view: PracticeResponse; referenceOpen: boolean; pending: boolean; onToggleReference: () => void }) {
  const { view } = props;
  const question = view.question;
  const exhausted = view.pick.exhaustedConceptIds.map((id) => getConcept(id).name);
  return <div className="space-y-3">
    <p className={`flex items-center gap-2 ${TYPE.eyebrow}`}><HelpCircle size={15} /> Question</p>
    {question && <>
      <MetaLine view={view} question={question} />
      <p data-testid="question-prompt" className={`whitespace-pre-line ${TYPE.question}`}>{question.prompt}</p>
      {question.assumptions.length > 0 && <div className={`rounded-md bg-slate-50 p-3 text-slate-600 ${TYPE.support}`}>
        <p className="font-semibold text-slate-700">Assumptions</p>
        <ul className="mt-1 list-disc pl-5">{question.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
      </div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={props.onToggleReference} disabled={props.pending} aria-expanded={props.referenceOpen} aria-controls="adaptivepath-reference-panel"
          className={`inline-flex items-center gap-1.5 ${ACTION_LINK}`}><BookOpen size={14} />{referenceLabel(props.referenceOpen, view.activity.referenceUsed)}</button>
        {view.activity.referenceUsed && <span className="text-[13px] text-amber-700">Reference used for this question</span>}
      </div>
    </>}
    {exhausted.length > 0 && <p className="text-[13px] text-amber-700">Question pool exhausted for: {exhausted.join(", ")}</p>}
  </div>;
}
