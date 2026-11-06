/** Client-safe: how far the student's unsubmitted work has got. */
import type { Draft } from "./draft";
import type { DraftState } from "./teaching-policy";

export function draftState(draft: Draft | null): DraftState {
  if (draft?.reasoning.trim()) return "reasoning";
  return draft?.selectedOption ? "option_only" : "empty";
}
