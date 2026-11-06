/**
 * Local-only mapping of introductory survey/diagnostic metadata into the
 * existing Coach tools. This NEVER asserts L2 mastery or shares raw student
 * information. Valid L2 judgments always take priority over onboarding.
 */
import { selectCoachTool,type BiologyCoachTool } from "../memory/coach-policy";
import type { MasteryLevel } from "../memory/types";
import type { BiologyOnboardingMetadata } from "./types";
export function selectBiologyCoachTool(
  levels:readonly (MasteryLevel|null)[],
  currentConceptIds:readonly string[],
  onboarding:BiologyOnboardingMetadata|null,
):BiologyCoachTool {
  if(levels.some(level=>level!==null)||onboarding?.status!=="completed"){
    return selectCoachTool(levels);
  }
  const signals=onboarding.conceptSignals.filter(s=>currentConceptIds.includes(s.conceptId));
  const needsReview=signals.some(s=>s.status==="needs_review");
  if(onboarding.geneticsFamiliarity==="new"&&needsReview)return "worked_example";
  if(onboarding.supportPreference==="worked_example")return "worked_example";
  if(onboarding.supportPreference==="visual")return "reference_pointer";
  if(needsReview)return "guided_hint";
  if(onboarding.supportPreference==="step_by_step")return "guided_hint";
  if(onboarding.supportPreference==="socratic"&&
     (signals.some(s=>s.status==="promising")||onboarding.geneticsFamiliarity==="comfortable")){
    return "socratic_probe";
  }
  return "guided_hint";
}
