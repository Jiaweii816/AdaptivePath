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
import { focusedReference, suggestPrompts } from "./practice/suggested-prompts";
import { draftState } from "./coach/draft-state";

type Feedback = NonNullable<PracticeResponse["feedback"]>;

export function AdaptivePathClient() {
  const [view, setView] = useState<PracticeResponse | null>(null);
  const [option, setOption] = useState("");
  const [explanation, setExplanation] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [highlight, setHighlight] = useState<readonly string[] | null>(null);
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /**
   * Preserve the submitted question for feedback and post-submit review.
   * The server has already advanced its adaptive picker, but the learner must
   * explicitly choose Next Question before we render the newly selected item.
   * Do not cache free-text reasoning in browser storage.
   */
  const [submittedSnapshot, setSubmittedSnapshot] = useState<{
    view: PracticeResponse; option: string; explanation: string;
  } | null>(null);
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

  const displayedView = submittedSnapshot?.view ?? view;
  const question = displayedView?.question;
  const coach = useCoachChat(send);

  async function submit() {
    if (!question || !displayedView || pending || submittedSnapshot) return;
    const submittedView = displayedView;
    const submittedOption = option;
    const submittedExplanation = explanation;
    const attemptId = crypto.randomUUID();
    const result = await send({ action: "submit", questionId: question.id, selectedOption: option, explanation, attemptId });
    if (!result) return;
    setSubmittedSnapshot({ view: submittedView, option: submittedOption, explanation: submittedExplanation });
    setFeedback(result.feedback ?? null);
    setLastSubmitted({ attemptId, objective: question.objective, conceptIds: question.conceptIds });
    // Keep the student's original work and the matching textbook visible.
    // The next server-selected question is rendered only after an explicit click.
    coach.backToCurrent();
  }

  function nextQuestion() {
    if (!submittedSnapshot || pending) return;
    setSubmittedSnapshot(null);
    setFeedback(null);
    setLastSubmitted(null);
    setOption("");
    setExplanation("");
    setReferenceOpen(false);
    setHighlight(null);
    setFocusedChunkId(null);
    coach.backToCurrent();
  }

  async function ask() {
    if (pending || (submittedSnapshot && !coach.review)) return;
    await coach.ask(question?.id, { selectedOption: (option || null) as "A" | "B" | "C" | "D" | null, reasoning: explanation });
  }

  async function openReference() {
    if (!question || pending) return false;
    if (submittedSnapshot) return true; // Read-only access after submission; do not alter its recorded condition.
    if (displayedView?.activity.referenceUsed) return true;
    return Boolean(await send({ action: "reference", questionId: question.id }));
  }

  async function toggleReference() {
    if (referenceOpen) { setReferenceOpen(false); setHighlight(null); return; }
    if (await openReference()) setReferenceOpen(true);
  }

  async function cite(chunkId: string) {
    if (!question || pending) return;
    if (submittedSnapshot) { setHighlight([chunkId]); setReferenceOpen(true); return; }
    const plan = planCitation({ reviewing: Boolean(coach.review), referenceUsed: Boolean(displayedView?.activity.referenceUsed) });
    if (plan.recordReference && !(await send({ action: "reference", questionId: question.id }))) return;
    setHighlight([chunkId]);
    setReferenceOpen(true);
  }

  const quotedSpans = coach.review ? [] : coach.turn?.quotedSpans ?? [];
  const reference = question ? focusedReference({
    open: referenceOpen, liveModel: Boolean(displayedView?.modelReady), reviewing: Boolean(coach.review), highlight,
    questionChunkIds: question.chunkIds, focusedChunkId,
  }) : null;
  const conceptIds = coach.review?.conceptIds ?? question?.conceptIds ?? [];
  const prompts = conceptIds.length && (!submittedSnapshot || coach.review) ? suggestPrompts({
    phase: coach.review ? "submitted_attempt" : "current_question",
    draftState: draftState({ selectedOption: option || null, reasoning: explanation }), conceptIds, reference,
  }) : [];

  return (
    <div className="pl-14">
      <Sidebar displayName="AdaptivePath" mode="overlay" />
      <AppShell
        mode="biology"
        currentProblemLabel={question?.objective ?? "Characteristics and Traits"}
        headerActions={<div className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
            {displayedView?.modelReady ? "Live tutor configured" : "Offline tutor · model key not configured"}
          </span>
          <Link href="/adaptivepath/onboarding" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Onboarding</Link>
          <Link href="/adaptivepath/textbook" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Full textbook §12.2</Link>
          <Link href="/adaptivepath/profile" className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Learner Profile</Link>
        </div>}
      >
        {error && <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        <BiologyWorkbenchGrid
          left={<PracticeQuestionPanel view={displayedView} referenceOpen={referenceOpen} highlightChunkIds={highlight} pending={pending} onToggleReference={() => void toggleReference()} onFocusReference={setFocusedChunkId} />}
          middle={<PracticeAnswerPanel view={displayedView} option={option} explanation={explanation} pending={pending} submitted={Boolean(submittedSnapshot)} feedback={feedback} quotedSpans={quotedSpans}
            onReview={view?.modelReady && lastSubmitted ? () => coach.startReview(lastSubmitted) : null}
            onOption={setOption} onExplanation={setExplanation} onSubmit={() => void submit()} onNext={nextQuestion} />}
          right={<PracticeTutorPanel view={displayedView} coach={coach} submitted={Boolean(submittedSnapshot)} pending={pending} onSend={() => void ask()} onCite={(id) => void cite(id)} prompts={prompts} reference={reference}
            citationCountsAsReference={!coach.review && !submittedSnapshot && !displayedView?.activity.referenceUsed} />}
        />
      </AppShell>
    </div>
  );
}
