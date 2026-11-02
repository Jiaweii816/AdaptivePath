/** What the student wants this turn; the allowed kinds depend on what the chat is focused on (spec §7.1). */
import { z } from "zod";
import { CONCEPTS } from "../concepts";

export type CoachPhase = "current_question" | "submitted_attempt";

export const CURRENT_INTENTS = [
  "explain_concept", "question_hint", "check_reasoning", "locate_textbook",
  "request_answer", "learner_status", "why_this_question", "off_topic",
] as const;
export const REVIEW_INTENTS = ["review_attempt", "explain_concept", "locate_textbook", "learner_status", "off_topic"] as const;
export type IntentKind = (typeof CURRENT_INTENTS)[number] | (typeof REVIEW_INTENTS)[number];
export type Affect = "none" | "anxious_stuck";

export const MAX_INTENTS = 3;
const MAX_QUERY_WORDS = 12;
const CONCEPT_IDS = CONCEPTS.map((c) => c.id) as [string, ...string[]];

export type ClassifiedTurn = Readonly<{
  intents: readonly Readonly<{ kind: IntentKind; conceptId?: string }>[];
  affect: Affect;
  /** Keywords in the textbook's vocabulary for textbook search. */
  textbookQuery: string;
}>;

export function classifiedTurnSchema(phase: CoachPhase) {
  const kinds = phase === "current_question" ? CURRENT_INTENTS : REVIEW_INTENTS;
  return z.object({
    intents: z.array(z.object({ kind: z.enum(kinds), conceptId: z.enum(CONCEPT_IDS).optional() }).strict()).min(1).max(MAX_INTENTS),
    affect: z.enum(["none", "anxious_stuck"]),
    textbookQuery: z.string().trim().min(1).refine((q) => q.split(/\s+/).length <= MAX_QUERY_WORDS, "textbookQuery has too many words"),
  }).strict();
}
