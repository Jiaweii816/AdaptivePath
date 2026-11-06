/**
 * Background memory signals (spec §4.1): derived deterministically each turn from
 * L1/L2/L3. They steer how the coach teaches; the coach never states them.
 */
import type { Concept } from "../concepts";
import type { BankQuestion } from "../question-bank";
import type { ProfileCard } from "../memory/profile-card";
import { EXCERPT_CHARS, type TutorEvidence } from "../memory/tutor-context";
import type { JudgmentState, MasteryLevel } from "../memory/types";
import { selectBiologyCoachTool } from "../onboarding/coach-policy";
import type { BiologyOnboardingMetadata } from "../onboarding/types";
import type { BiologyCoachTool } from "../memory/coach-policy";

export const MAX_PAST_MISSES = 3;
export const FADING_WINDOW = 3;
const UNJUDGED_LEVEL: MasteryLevel = 0;
const PREREQUISITE_GAP_MAX_LEVEL = 1;
const TUTOR_CONDITION = 1;

export type PastMiss = Readonly<{ questionId: string; l1EventId: string; selectedOption: string; reasoningExcerpt: string; misconception: string }>;
export type MemorySignals = Readonly<{
  level: MasteryLevel;
  focusConceptId: string;
  prerequisiteGap: string | null;
  anchor: string | null;
  pastMisses: readonly PastMiss[];
  reliesOnTutor: boolean;
  /** Only a generic teaching-tool choice survives onboarding transformation. */
  initialCoachTool?: BiologyCoachTool;
}>;

type SignalInput = Readonly<{
  question: BankQuestion;
  states: ReadonlyMap<string, JudgmentState>;
  card: ProfileCard | null;
  attempts: readonly TutorEvidence[];
  concepts: readonly Concept[];
  lookupQuestion: (id: string) => BankQuestion;
  onboarding?: BiologyOnboardingMetadata|null;
}>;

const levelOf = (states: SignalInput["states"], id: string) => states.get(id)?.level ?? UNJUDGED_LEVEL;

function focusConcept(question: BankQuestion, states: SignalInput["states"]): string {
  return [...question.conceptIds].sort((a, b) => levelOf(states, a) - levelOf(states, b) || a.localeCompare(b))[0];
}

function prerequisiteGap(input: SignalInput, focus: string): string | null {
  if (levelOf(input.states, focus) > PREREQUISITE_GAP_MAX_LEVEL || !input.card) return null;
  const gaps = input.card.prerequisiteGaps.filter((g) => g.conceptId === focus).map((g) => g.prerequisiteId).sort();
  return gaps[0] ?? null;
}

function anchor(input: SignalInput, focus: string): string | null {
  const concept = input.concepts.find((c) => c.id === focus);
  const strengths = new Set(input.card?.strengths ?? []);
  const candidates = (concept?.prerequisiteIds ?? []).filter((id) => strengths.has(id));
  const stability = (id: string) => input.states.get(id)?.stability ?? 0;
  return [...candidates].sort((a, b) => stability(b) - stability(a) || a.localeCompare(b))[0] ?? null;
}

function newestOnQuestionConcepts(input: SignalInput): TutorEvidence[] {
  const ids = new Set(input.question.conceptIds);
  return input.attempts
    .filter((a) => a.conceptIds.some((id) => ids.has(id)))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

function pastMisses(input: SignalInput, recent: readonly TutorEvidence[]): PastMiss[] {
  return recent.filter((a) => !a.correct).slice(0, MAX_PAST_MISSES).map((a) => {
    const misconception = input.lookupQuestion(a.questionId).optionExplanations[a.selectedOption];
    if (misconception === undefined) throw new Error(`No option explanation for ${a.questionId} ${a.selectedOption}`);
    return { questionId: a.questionId, l1EventId: a.l1EventId, selectedOption: a.selectedOption, reasoningExcerpt: a.explanation.slice(0, EXCERPT_CHARS), misconception };
  });
}

export function deriveMemorySignals(input: SignalInput): MemorySignals {
  const focus = focusConcept(input.question, input.states);
  const recent = newestOnQuestionConcepts(input);
  const window = recent.slice(0, FADING_WINDOW);
  const initialCoachTool=!input.states.has(focus)&&input.onboarding?.status==="completed"
    ?selectBiologyCoachTool([null],input.question.conceptIds,input.onboarding):null;
  return {
    level: levelOf(input.states, focus),
    focusConceptId: focus,
    prerequisiteGap: prerequisiteGap(input, focus),
    anchor: anchor(input, focus),
    pastMisses: pastMisses(input, recent),
    reliesOnTutor: window.length === FADING_WINDOW && window.every((a) => a.condition === TUTOR_CONDITION),
    ...(initialCoachTool ? {initialCoachTool} : {}),
  };
}
