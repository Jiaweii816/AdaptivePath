/** Neutral wording handed to the coach in place of raw memory or picker internals. */
import type { MasteryLevel } from "../memory/types";

const LEVEL_WORDING: Readonly<Record<MasteryLevel, string>> = {
  0: "needs to be built up from the basics",
  1: "is coming along but still shaky",
  2: "is fairly solid",
  3: "is solid",
};
const NOT_STARTED = "has not been practised yet";

/** Qualitative only: no level names, numbers or record wording (checked by the disclosure guard tests). */
export function describeLevel(level: MasteryLevel | null): string {
  return level === null ? NOT_STARTED : LEVEL_WORDING[level];
}

const PICK_REASON_WORDING = {
  frontier_concept: "按课本的先修顺序，这是接下来要练的概念和难度",
  integrated_review: "把几个概念串起来练",
} as const;

export function describePickReason(reason: keyof typeof PICK_REASON_WORDING): string {
  return PICK_REASON_WORDING[reason];
}
