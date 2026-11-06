"use client";
/** Coach chat state: which thread is focused (current question or a submitted attempt) and the last turn's references. */
import { useState } from "react";
import type { PracticeAction, PracticeDraft, PracticeResponse } from "./practice-api";
import { appendPrompt, type PromptId, type ReferenceRef, type SuggestedPrompt } from "./suggested-prompts";

export type ReviewTarget = Readonly<{ attemptId: string; objective: string; conceptIds: readonly string[] }>;
export type ChatMessage = PracticeResponse["activity"]["messages"][number];
export type CoachTurnView = Readonly<{ provider: string; stopReason: string | null; citedChunkIds: readonly string[]; quotedSpans: readonly string[] }>;
type Send = (payload: PracticeAction) => Promise<PracticeResponse | null>;

/** Prompts clicked into the box since the last send, and the passage attached to it. */
function usePromptComposer() {
  const [chat, setChatText] = useState("");
  const [promptIds, setPromptIds] = useState<readonly PromptId[]>([]);
  const [attachment, setAttachment] = useState<ReferenceRef | null>(null);

  /** An emptied box no longer carries any clicked prompt. */
  function setChat(value: string) {
    setChatText(value);
    if (!value.trim()) setPromptIds([]);
  }

  function applyPrompt(prompt: SuggestedPrompt, reference: ReferenceRef | null) {
    setChatText((current) => appendPrompt(current, prompt.text));
    setPromptIds((ids) => (ids.includes(prompt.id) ? ids : [...ids, prompt.id]));
    if (prompt.id === "explain_reference") setAttachment(reference);
  }

  function resetPrompts() {
    setPromptIds([]);
    setAttachment(null);
  }

  return { chat, setChat, setChatText, promptIds, attachment, applyPrompt, clearAttachment: () => setAttachment(null), resetPrompts };
}

export function useCoachChat(send: Send) {
  const composer = usePromptComposer();
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [reviewMessages, setReviewMessages] = useState<readonly ChatMessage[]>([]);
  const [turn, setTurn] = useState<CoachTurnView | null>(null);

  async function ask(questionId: string | undefined, draft: PracticeDraft) {
    const message = composer.chat.trim();
    if (!message || (!review && !questionId)) return;
    const extra = { promptIds: composer.promptIds, referenceChunkId: composer.attachment?.chunkId };
    const payload: PracticeAction = review
      ? { action: "chat", focus: { kind: "submitted_attempt", attemptId: review.attemptId }, message, ...extra }
      : { action: "chat", focus: { kind: "current_question", questionId: questionId! }, message, draft, ...extra };
    const result = await send(payload);
    if (!result?.provider) return;
    setTurn({ provider: result.provider, stopReason: result.stopReason ?? null, citedChunkIds: result.citedChunkIds ?? [], quotedSpans: result.quotedSpans ?? [] });
    if (result.review) setReviewMessages(result.review.messages);
    composer.setChatText("");
    composer.resetPrompts();
  }

  function startReview(target: ReviewTarget) {
    setReview(target);
    setReviewMessages([]);
    setTurn(null);
    composer.resetPrompts();
  }

  function backToCurrent() {
    setReview(null);
    setTurn(null);
    composer.resetPrompts();
  }

  return {
    chat: composer.chat, setChat: composer.setChat, attachment: composer.attachment, applyPrompt: composer.applyPrompt,
    clearAttachment: composer.clearAttachment, review, reviewMessages, turn, ask, startReview, backToCurrent,
  };
}
