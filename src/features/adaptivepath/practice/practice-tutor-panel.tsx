"use client";
import { MessageCircle, Send } from "lucide-react";
import { CoachMarkdown } from "@/components/coach/coach-markdown";
import { AssistantBubble, UserBubble } from "@/components/workbench/coach-bubbles";
import type { PracticeResponse } from "./practice-api";

export function PracticeTutorPanel(props: {
  view: PracticeResponse | null; lastTurn: { provider: string; tool: string } | null; chat: string; pending: boolean;
  onChat: (text: string) => void; onSend: () => void;
}) {
  const { view, lastTurn, chat, pending } = props;
  return <section aria-label="Coach Panel" className="flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card lg:min-h-0">
    <div className="border-b border-slate-200 p-5"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700"><MessageCircle size={16} /> AI Tutor Workspace</div>
      <h2 className="mt-2 text-lg font-semibold">Adaptive guidance</h2>
      <p className="mt-1 text-xs text-slate-500">
        Provider: {lastTurn ? (lastTurn.provider === "live_llm" ? "Live model" : "Offline rules") : view?.modelReady ? "Live model" : "Offline rules"}
        {" "}· Teaching tool: {lastTurn ? lastTurn.tool.replaceAll("_", " ") : "chosen from your mastery level"}</p></div>
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <div className="rounded-lg bg-slate-100 p-3 text-sm leading-6">Hi! Ask me when you are stuck. I will guide you, but I will not give you the answer. Asking me is recorded as tutor help for this question.</div>
      {view?.activity.messages.map((m, i) => m.role === "student"
        ? <UserBubble key={i}>{m.content}</UserBubble>
        : <AssistantBubble key={i}><CoachMarkdown markdown={m.content} /></AssistantBubble>)}
    </div>
    <form className="flex gap-2 border-t border-slate-200 p-4" onSubmit={(e) => { e.preventDefault(); props.onSend(); }}>
      <input value={chat} onChange={(e) => props.onChat(e.target.value)} aria-label="Message to tutor" placeholder="Ask your tutor a question…"
        disabled={!view?.question}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600" />
      <button type="submit" disabled={!chat.trim() || pending || !view?.question} aria-label="Send" className="rounded-lg bg-teal-700 px-3 text-white disabled:opacity-50"><Send size={17} /></button>
    </form>
  </section>;
}
