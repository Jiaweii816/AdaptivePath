"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AppShell } from "@/components/layout/app-shell";
import { BiologyWorkbenchGrid } from "@/components/workbench/workbench-grid";
import { getPractice, postPractice, type PracticeAction, type PracticeResponse } from "./practice/practice-api";
import { PracticeAnswerPanel } from "./practice/practice-answer-panel";
import { PracticeQuestionPanel } from "./practice/practice-question-panel";
import { PracticeTutorPanel } from "./practice/practice-tutor-panel";

type Feedback = NonNullable<PracticeResponse["feedback"]>;

export function AdaptivePathClient() {
  const [view, setView] = useState<PracticeResponse | null>(null);
  const [option, setOption] = useState("");
  const [explanation, setExplanation] = useState("");
  const [chat, setChat] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastTurn, setLastTurn] = useState<{ provider: string; tool: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPractice().then((result) => { if (active) setView(result); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, []);

  const send = useCallback(async (payload: PracticeAction) => {
    setPending(true); setError("");
    try {
      const result = await postPractice(payload);
      setView(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  const question = view?.question;

  async function submit() {
    if (!question || pending) return;
    const result = await send({ action: "submit", questionId: question.id, selectedOption: option, explanation, attemptId: crypto.randomUUID() });
    if (!result) return;
    setFeedback(result.feedback ?? null);
    setOption(""); setExplanation(""); setReferenceOpen(false); setLastTurn(null);
  }

  async function ask() {
    if (!chat.trim() || pending) return;
    const result = await send({ action: "chat", message: chat.trim() });
    if (!result) return;
    if (result.provider && result.tool) setLastTurn({ provider: result.provider, tool: result.tool });
    setChat("");
  }

  async function toggleReference() {
    if (!question || pending) return;
    if (referenceOpen) { setReferenceOpen(false); return; }
    if (view?.activity.referenceUsed) { setReferenceOpen(true); return; }
    if (await send({ action: "reference", questionId: question.id })) setReferenceOpen(true);
  }

  return (
    <div className="pl-14">
      <Sidebar displayName="AdaptivePath" mode="overlay" />
      <AppShell
        mode="biology"
        currentProblemLabel={question?.objective ?? "Characteristics and Traits"}
        headerActions={<div className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            {view?.modelReady ? "Live tutor configured" : "Offline tutor · model key not configured"}
          </span>
          <Link href="/adaptivepath/textbook" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Full textbook §12.2</Link>
          <Link href="/adaptivepath/profile" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Learner Profile</Link>
        </div>}
      >
        {error && <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <BiologyWorkbenchGrid
          left={<PracticeQuestionPanel view={view} referenceOpen={referenceOpen} pending={pending} onToggleReference={() => void toggleReference()} />}
          middle={<PracticeAnswerPanel view={view} option={option} explanation={explanation} pending={pending} feedback={feedback}
            onOption={setOption} onExplanation={setExplanation} onSubmit={() => void submit()} />}
          right={<PracticeTutorPanel view={view} lastTurn={lastTurn} chat={chat} pending={pending} onChat={setChat} onSend={() => void ask()} />}
        />
      </AppShell>
    </div>
  );
}
