"use client";
/** Coach chat state: which thread is focused (current question or a submitted attempt) and the last turn's references. */
import { useState } from "react";
import type { PracticeAction, PracticeDraft, PracticeResponse } from "./practice-api";

export type ReviewTarget = Readonly<{ attemptId: string; objective: string }>;
export type ChatMessage = PracticeResponse["activity"]["messages"][number];
export type CoachTurnView = Readonly<{ provider: string; stopReason: string | null; citedChunkIds: readonly string[]; quotedSpans: readonly string[] }>;
type Send = (payload: PracticeAction) => Promise<PracticeResponse | null>;

export function useCoachChat(send: Send) {
  const [chat, setChat] = useState("");
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [reviewMessages, setReviewMessages] = useState<readonly ChatMessage[]>([]);
  const [turn, setTurn] = useState<CoachTurnView | null>(null);

  async function ask(questionId: string | undefined, draft: PracticeDraft) {
    const message = chat.trim();
    if (!message || (!review && !questionId)) return;
    const payload: PracticeAction = review
      ? { action: "chat", focus: { kind: "submitted_attempt", attemptId: review.attemptId }, message }
      : { action: "chat", focus: { kind: "current_question", questionId: questionId! }, message, draft };
    const result = await send(payload);
    if (!result?.provider) return;
    setTurn({ provider: result.provider, stopReason: result.stopReason ?? null, citedChunkIds: result.citedChunkIds ?? [], quotedSpans: result.quotedSpans ?? [] });
    if (result.review) setReviewMessages(result.review.messages);
    setChat("");
  }

  function startReview(target: ReviewTarget) {
    setReview(target);
    setReviewMessages([]);
    setTurn(null);
  }

  function backToCurrent() {
    setReview(null);
    setTurn(null);
  }

  return { chat, setChat, review, reviewMessages, turn, ask, startReview, backToCurrent };
}
