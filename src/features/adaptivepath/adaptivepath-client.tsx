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
import { useCoachChat, type ReviewTarget } from "./practice/use-coach-chat";
import { planCitation } from "./practice/citation-plan";

type Feedback = NonNullable<PracticeResponse["feedback"]>;

export function AdaptivePathClient() {
  const [view, setView] = useState<PracticeResponse | null>(null);
  const [option, setOption] = useState("");
  const [explanation, setExplanation] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [highlight, setHighlight] = useState<readonly string[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<ReviewTarget | null>(null);
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
  const coach = useCoachChat(send);

  async function submit() {
    if (!question || pending) return;
    const attemptId = crypto.randomUUID();
    const result = await send({ action: "submit", questionId: question.id, selectedOption: option, explanation, attemptId });
    if (!result) return;
    setFeedback(result.feedback ?? null);
    setLastSubmitted({ attemptId, objective: question.objective });
    setOption(""); setExplanation(""); setReferenceOpen(false); setHighlight(null);
    coach.backToCurrent();
  }

  async function ask() {
    if (pending) return;
    await coach.ask(question?.id, { selectedOption: (option || null) as "A" | "B" | "C" | "D" | null, reasoning: explanation });
  }

  async function openReference() {
    if (!question || pending) return false;
    if (view?.activity.referenceUsed) return true;
    return Boolean(await send({ action: "reference", questionId: question.id }));
  }

  async function toggleReference() {
    if (referenceOpen) { setReferenceOpen(false); setHighlight(null); return; }
    if (await openReference()) setReferenceOpen(true);
  }

  async function cite(chunkId: string) {
    if (!question || pending) return;
    const plan = planCitation({ reviewing: Boolean(coach.review), referenceUsed: Boolean(view?.activity.referenceUsed) });
    if (plan.recordReference && !(await send({ action: "reference", questionId: question.id }))) return;
    setHighlight([chunkId]);
    setReferenceOpen(true);
  }

  const quotedSpans = coach.review ? [] : coach.turn?.quotedSpans ?? [];

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
          <Link href="/adaptivepath/onboarding" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Onboarding</Link>
          <Link href="/adaptivepath/textbook" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Full textbook §12.2</Link>
          <Link href="/adaptivepath/profile" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Learner Profile</Link>
        </div>}
      >
        {error && <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <BiologyWorkbenchGrid
          left={<PracticeQuestionPanel view={view} referenceOpen={referenceOpen} highlightChunkIds={highlight} pending={pending} onToggleReference={() => void toggleReference()} />}
          middle={<PracticeAnswerPanel view={view} option={option} explanation={explanation} pending={pending} feedback={feedback} quotedSpans={quotedSpans}
            onReview={view?.modelReady && lastSubmitted ? () => coach.startReview(lastSubmitted) : null}
            onOption={setOption} onExplanation={setExplanation} onSubmit={() => void submit()} />}
          right={<PracticeTutorPanel view={view} coach={coach} pending={pending} onSend={() => void ask()} onCite={(id) => void cite(id)}
            citationCountsAsReference={!coach.review && !view?.activity.referenceUsed} />}
        />
      </AppShell>
    </div>
  );
}
