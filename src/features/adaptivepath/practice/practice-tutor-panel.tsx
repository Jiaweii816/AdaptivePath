"use client";
import { useRef } from "react";
import { MessageCircle, Paperclip, Send, Sparkles, X } from "lucide-react";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { AssistantBubble, UserBubble } from "@/components/workbench/coach-bubbles";
import type { PracticeResponse } from "./practice-api";
import type { ReferenceRef, SuggestedPrompt } from "./suggested-prompts";
import { TYPE } from "./typography";
import type { useCoachChat } from "./use-coach-chat";

type Coach = ReturnType<typeof useCoachChat>;

function providerLabel(view: PracticeResponse | null, coach: Coach): string {
  const provider = coach.turn?.provider ?? (view?.modelReady ? "live_llm" : "offline_rules");
  return provider === "live_llm" ? "Live model" : "Offline rules";
}

function Citations({ coach, onCite, countsAsReference }: { coach: Coach; onCite: (chunkId: string) => void; countsAsReference: boolean }) {
  const ids = coach.turn?.citedChunkIds ?? [];
  if (ids.length === 0) return null;
  return <div data-testid="coach-citations" className="flex flex-wrap items-center gap-2">
    {countsAsReference && <span className={TYPE.secondary}>Opening a passage counts as reference use:</span>}
    {ids.map((id) => <button key={id} type="button" onClick={() => onCite(id)}
      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-amber-300 hover:bg-amber-50">Textbook · {id.replace("b2e-12-2-", "")}</button>)}
  </div>;
}

function PromptPills({ prompts, disabled, onPick }: { prompts: readonly SuggestedPrompt[]; disabled: boolean; onPick: (prompt: SuggestedPrompt) => void }) {
  return <div data-testid="suggested-prompts" className="flex flex-col items-stretch gap-1.5 px-4 pt-3">
    {prompts.map((p) => <button key={p.id} type="button" disabled={disabled} onClick={() => onPick(p)} data-prompt-id={p.id}
      className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-[13px] text-slate-700 hover:border-teal-300 hover:bg-teal-50/50 disabled:opacity-50">
      <Sparkles size={13} className="shrink-0 text-teal-600" />{p.text}</button>)}
  </div>;
}

function AttachmentChip({ reference, onRemove }: { reference: ReferenceRef; onRemove: () => void }) {
  return <div data-testid="prompt-attachment" className="px-4 pt-2">
    <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
      <Paperclip size={11} />Reference {reference.number} · p. {reference.printedPage}
      <button type="button" onClick={onRemove} aria-label="Remove attached reference" className="ml-1 rounded hover:bg-amber-100"><X size={11} /></button>
    </span>
  </div>;
}

export function PracticeTutorPanel(props: {
  view: PracticeResponse | null; coach: Coach; pending: boolean; onSend: () => void; onCite: (chunkId: string) => void; citationCountsAsReference: boolean;
  prompts: readonly SuggestedPrompt[]; reference: ReferenceRef | null;
}) {
  const { view, coach, pending } = props;
  const input = useRef<HTMLInputElement>(null);
  /** Put the cursor after the appended text so the student can keep typing. */
  function pick(prompt: SuggestedPrompt) {
    coach.applyPrompt(prompt, props.reference);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }
  const messages = coach.review ? coach.reviewMessages : view?.activity.messages ?? [];
  const canChat = Boolean(coach.review || view?.question);
  return <section aria-label="Coach Panel" className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
    <div className="border-b border-slate-200 p-5"><div className={`flex items-center gap-2 ${TYPE.eyebrow}`}><MessageCircle size={15} /> AI Tutor Workspace</div>
      <h2 className={`mt-2 ${TYPE.heading}`}>Adaptive guidance</h2>
      {coach.review && <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-teal-50 px-3 py-2 text-[13px] text-teal-900">
        <span>Reviewing: {coach.review.objective}</span>
        <button type="button" onClick={coach.backToCurrent} className="font-semibold underline">Back to current question</button>
      </div>}
      <p className={`mt-1 ${TYPE.secondary}`}>Provider: {providerLabel(view, coach)}
        {coach.turn?.stopReason === "tool_budget" && <span> · Tool budget reached this turn</span>}</p></div>
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <div className={`rounded-lg bg-slate-50 p-3 text-slate-700 ${TYPE.support}`}>{coach.review
        ? "Ask me why your submitted answer was right or wrong."
        : "Hi! Ask me when you are stuck. I can see your selected option and reasoning, so you don't need to repeat them. I will guide you, but I will not give you the answer. Asking me is recorded as tutor help for this question."}</div>
      {messages.map((m, i) => m.role === "student"
        ? <UserBubble key={i}>{m.content}</UserBubble>
        : <AssistantBubble key={i}><CoachMarkdown markdown={m.content} /></AssistantBubble>)}
      <Citations coach={coach} onCite={props.onCite} countsAsReference={props.citationCountsAsReference} />
    </div>
    <div className="border-t border-slate-200">
    {canChat && props.prompts.length > 0 && <PromptPills prompts={props.prompts} disabled={pending} onPick={pick} />}
    {coach.attachment && <AttachmentChip reference={coach.attachment} onRemove={coach.clearAttachment} />}
    <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); props.onSend(); }}>
      <input ref={input} value={coach.chat} onChange={(e) => coach.setChat(e.target.value)} aria-label="Message to tutor" placeholder="Ask your tutor a question…"
        disabled={!canChat}
        className={`min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-teal-600 ${TYPE.support}`} />
      <button type="submit" disabled={!coach.chat.trim() || pending || !canChat} aria-label="Send" className="rounded-lg bg-teal-700 px-3 text-white disabled:opacity-50"><Send size={17} /></button>
    </form>
    </div>
  </section>;
}
