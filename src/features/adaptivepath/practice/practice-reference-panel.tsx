"use client";
/** Left column, shown only while the textbook reference is open; the PDF fills its height. */
import { BookOpen, X } from "lucide-react";
import { OPENSTAX_URL } from "../concepts";
import { TextbookViewer } from "../textbook-viewer";
import type { PracticeResponse } from "./practice-api";
import { TYPE } from "./typography";

type Question = NonNullable<PracticeResponse["question"]>;

export function PracticeReferencePanel(props: {
  question: Question; highlight: readonly string[] | null; onClose: () => void; onFocusReference: (chunkId: string) => void;
}) {
  const { question, highlight } = props;
  return <section id="adaptivepath-reference-panel" aria-label="Textbook Reference Panel"
    className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
    <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className={`flex items-center gap-2 ${TYPE.heading}`}><BookOpen size={17} className="text-teal-700" /> Textbook Reference</h2>
        {highlight && <p className="text-[13px] text-teal-700">Showing the passage the coach cited</p>}
      </div>
      <button type="button" onClick={props.onClose} aria-label="Hide reference" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <TextbookViewer key={`${question.id}:${highlight?.join(",") ?? ""}`} chunkIds={highlight ?? question.chunkIds} onFocusChange={props.onFocusReference} />
    </div>
    <p className={`border-t border-slate-200 px-4 py-2 ${TYPE.control} text-slate-500`}>Source: OpenStax Biology 2e, Section 12.2. Access for free at <a href={OPENSTAX_URL} target="_blank" rel="noreferrer" className="text-teal-700 underline">openstax.org</a>. CC BY-NC-SA 4.0.</p>
  </section>;
}
