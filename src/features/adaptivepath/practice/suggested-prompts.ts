/**
 * One-click question starters above the tutor input. They depend only on how far
 * the student has got, never on which option is selected or which one is correct,
 * so a prompt can never hint at the answer.
 */
import { getConcept } from "../concepts";
import type { CoachPhase } from "../coach/intents";
import type { DraftState } from "../coach/teaching-policy";
import { referenceLocations } from "../reference-locations";

export const MAX_PROMPTS = 3;
export const PROMPT_IDS = [
  "explain_concept", "connect_concepts", "start_hint", "pre_commit_check", "check_reasoning", "review_attempt", "explain_reference",
] as const;
export type PromptId = (typeof PROMPT_IDS)[number];
export type SuggestedPrompt = Readonly<{ id: PromptId; text: string }>;
/** The textbook passage the student is looking at, numbered as the viewer numbers it. */
export type ReferenceRef = Readonly<{ chunkId: string; number: number; printedPage: number }>;
export type PromptState = Readonly<{ phase: CoachPhase; draftState: DraftState; conceptIds: readonly string[]; reference: ReferenceRef | null }>;

function conceptPrompt(conceptIds: readonly string[]): SuggestedPrompt {
  if (conceptIds.length === 1) return { id: "explain_concept", text: `Explain ${getConcept(conceptIds[0]).name}` };
  return { id: "connect_concepts", text: "How do the ideas in this question connect?" };
}

const START_HINT: SuggestedPrompt = { id: "start_hint", text: "Give me a hint to start" };
const PRE_COMMIT: SuggestedPrompt = { id: "pre_commit_check", text: "What should I check before I commit?" };
const CHECK_REASONING: SuggestedPrompt = { id: "check_reasoning", text: "Check my reasoning" };
const REVIEW_ATTEMPT: SuggestedPrompt = { id: "review_attempt", text: "Why was my answer right or wrong?" };

function statePrompts(state: PromptState): SuggestedPrompt[] {
  const concept = conceptPrompt(state.conceptIds);
  if (state.phase === "submitted_attempt") return [REVIEW_ATTEMPT, concept];
  if (state.draftState === "reasoning") return [CHECK_REASONING, concept];
  return [concept, state.draftState === "option_only" ? PRE_COMMIT : START_HINT];
}

export function suggestPrompts(state: PromptState): readonly SuggestedPrompt[] {
  const reference: SuggestedPrompt[] = state.reference
    ? [{ id: "explain_reference", text: `Explain Reference ${state.reference.number} (p. ${state.reference.printedPage})` }]
    : [];
  return [...statePrompts(state), ...reference].slice(0, MAX_PROMPTS);
}

/** Keeps what the student already typed and adds the prompt after one space. */
export function appendPrompt(current: string, text: string): string {
  if (!current) return text;
  return /\s$/.test(current) ? `${current}${text}` : `${current} ${text}`;
}

export type ReferenceView = Readonly<{
  open: boolean;
  liveModel: boolean;
  reviewing: boolean;
  /** Passages the coach cited and the viewer now shows instead of the question's own. */
  highlight: readonly string[] | null;
  questionChunkIds: readonly string[];
  /** Last reference the student located; null or not shown means Reference 1, as in the viewer. */
  focusedChunkId: string | null;
}>;

/**
 * Offline replies cannot read a passage, so the prompt needs the live model. In review
 * the viewer may still show the next question's passages; only a passage the coach
 * cited in the review belongs to the reviewed question.
 */
export function focusedReference(view: ReferenceView): ReferenceRef | null {
  if (!view.open || !view.liveModel) return null;
  if (view.reviewing && !view.highlight) return null;
  const shown = referenceLocations(view.highlight ?? view.questionChunkIds);
  const index = Math.max(0, shown.findIndex((ref) => ref.id === view.focusedChunkId));
  const ref = shown[index];
  if (!ref) return null;
  return { chunkId: ref.id, number: index + 1, printedPage: ref.printed_page };
}
