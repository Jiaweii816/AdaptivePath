"use client";
import { MessageCircle, Send } from "lucide-react";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { AssistantBubble, UserBubble } from "@/components/workbench/coach-bubbles";
import type { PracticeResponse } from "./practice-api";
import type { useCoachChat } from "./use-coach-chat";

type Coach = ReturnType<typeof useCoachChat>;

function providerLabel(view: PracticeResponse | null, coach: Coach): string {
  const provider = coach.turn?.provider ?? (view?.modelReady ? "live_llm" : "offline_rules");
  return provider === "live_llm" ? "Live model" : "Offline rules";
}

function Citations({ coach, onCite }: { coach: Coach; onCite: (chunkId: string) => void }) {
  const ids = coach.turn?.citedChunkIds ?? [];
  if (ids.length === 0) return null;
  return <div data-testid="coach-citations" className="flex flex-wrap gap-2">
    {ids.map((id) => <button key={id} type="button" onClick={() => onCite(id)}
      className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100">Textbook · {id.replace("b2e-12-2-", "")}</button>)}
  </div>;
}

export function PracticeTutorPanel(props: {
  view: PracticeResponse | null; coach: Coach; pending: boolean; onSend: () => void; onCite: (chunkId: string) => void;
}) {
  const { view, coach, pending } = props;
  const messages = coach.review ? coach.reviewMessages : view?.activity.messages ?? [];
  const canChat = Boolean(coach.review || view?.question);
  return <section aria-label="Coach Panel" className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
    <div className="border-b border-slate-200 p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><MessageCircle size={16} /> AI Tutor Workspace</div>
      <h2 className="mt-2 text-lg font-semibold">Adaptive guidance</h2>
      {coach.review && <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-teal-50 px-3 py-2 text-xs text-teal-900">
        <span>复盘：{coach.review.objective}</span>
        <button type="button" onClick={coach.backToCurrent} className="font-semibold underline">回到当前题</button>
      </div>}
      <p className="mt-1 text-xs text-slate-500">Provider: {providerLabel(view, coach)}
        {coach.turn?.stopReason === "tool_budget" && <span> · Tool budget reached this turn</span>}</p></div>
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <div className="rounded-lg bg-slate-100 p-3 text-sm leading-6">{coach.review
        ? "Ask me why your submitted answer was right or wrong."
        : "Hi! Ask me when you are stuck. I can see your selected option and reasoning, so you don't need to repeat them. I will guide you, but I will not give you the answer. Asking me is recorded as tutor help for this question."}</div>
      {messages.map((m, i) => m.role === "student"
        ? <UserBubble key={i}>{m.content}</UserBubble>
        : <AssistantBubble key={i}><CoachMarkdown markdown={m.content} /></AssistantBubble>)}
      <Citations coach={coach} onCite={props.onCite} />
    </div>
    <form className="flex gap-2 border-t border-slate-200 p-4" onSubmit={(e) => { e.preventDefault(); props.onSend(); }}>
      <input value={coach.chat} onChange={(e) => coach.setChat(e.target.value)} aria-label="Message to tutor" placeholder="Ask your tutor a question…"
        disabled={!canChat}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600" />
      <button type="submit" disabled={!coach.chat.trim() || pending || !canChat} aria-label="Send" className="rounded-lg bg-teal-700 px-3 text-white disabled:opacity-50"><Send size={17} /></button>
    </form>
  </section>;
}
