import { getQuestion } from "./content";
import { deriveProfile, type AttemptEvidence } from "./profile";

/**
 * Pure deterministic tool policy, shared by server Coach adapter and tests.
 * LeetCode execution / repair tools are deliberately not part of this list.
 */
export const BIOLOGY_COACH_TOOLS=[
  "diagnostic_probe","prerequisite_review","guided_hint","worked_example",
  "additional_practice","independent_transfer",
] as const;
export type BiologyCoachTool=(typeof BIOLOGY_COACH_TOOLS)[number];

export function selectBiologyCoachTool(args:{questionId:string|null;attempts:AttemptEvidence[]}):BiologyCoachTool {
  const question=args.questionId?getQuestion(args.questionId):null;
  if(question?.mode==="diagnostic")return "diagnostic_probe";
  if(question?.mode==="transfer")return "independent_transfer";
  const profile=deriveProfile(args.attempts);
  if(args.attempts.length===0)return "diagnostic_probe";
  if(Object.values(profile.misconceptions).some(x=>x==="confirmed"))return "worked_example";
  if(profile.priorKnowledge==="limited" && args.attempts.length<3)return "prerequisite_review";
  if(profile.support==="worked_example")return "worked_example";
  if(profile.support==="guided_hint")return "guided_hint";
  if(args.attempts.at(-1)?.evaluation.successful&&profile.priorKnowledge==="strong")
    return "additional_practice";
  return "guided_hint";
}
