/** Tutor help level chosen from L2 (spec §9.2, report Table 4). */
import type { MasteryLevel } from "./types";

export const BIOLOGY_COACH_TOOLS = ["worked_example", "guided_hint", "reference_pointer", "socratic_probe"] as const;
export type BiologyCoachTool = (typeof BIOLOGY_COACH_TOOLS)[number];

const TOOL_BY_LEVEL: Readonly<Record<MasteryLevel, BiologyCoachTool>> = {
  0: "worked_example",
  1: "guided_hint",
  2: "reference_pointer",
  3: "socratic_probe",
};
const LAST_HINT_STEP = 3;
const UNJUDGED_LEVEL: MasteryLevel = 0;

/** The weakest concept decides; an unjudged concept counts as level 0. */
export function selectCoachTool(levels: readonly (MasteryLevel | null)[]): BiologyCoachTool {
  const weakest = Math.min(...levels.map((l) => l ?? UNJUDGED_LEVEL)) as MasteryLevel;
  return TOOL_BY_LEVEL[weakest];
}

/** Ladder: 1 counter-question → 2 textbook passage → 3 key step. */
export function hintStep(priorTutorTurnsOnQuestion: number): 1 | 2 | 3 {
  return Math.min(priorTutorTurnsOnQuestion + 1, LAST_HINT_STEP) as 1 | 2 | 3;
}
