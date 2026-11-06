/** The student's unsubmitted work, sent with every chat turn so they never have to repeat it. */
import { createHash } from "node:crypto";

export type Draft = Readonly<{ selectedOption: string | null; reasoning: string }>;
export type DraftDiff = Readonly<{ optionChanged: Readonly<{ from: string | null; to: string | null }> | null; reasoningChanged: boolean }>;

export function draftHash(questionId: string, draft: Draft): string {
  return createHash("sha256").update(JSON.stringify([questionId, draft.selectedOption, draft.reasoning])).digest("hex");
}

/** `null` when there is no earlier draft on this question to compare with. */
export function diffDraft(previous: Draft | null, current: Draft): DraftDiff | null {
  if (!previous) return null;
  const optionChanged = previous.selectedOption === current.selectedOption ? null : { from: previous.selectedOption, to: current.selectedOption };
  return { optionChanged, reasoningChanged: previous.reasoning !== current.reasoning };
}
