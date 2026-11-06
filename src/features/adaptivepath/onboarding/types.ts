/** Safe, bounded, non-identifying Biology onboarding metadata. */
import type { BiologyUnitId,Familiarity,SupportPreference } from "./catalog";

export type ConceptSignalStatus = "needs_review"|"promising"|"unassessed";
export type ConceptSignal = Readonly<{
  conceptId:string;
  status:ConceptSignalStatus;
  questionsAnswered:number;
  correct:number;
  confidence:"low";
}>;
export type BiologyOnboardingMetadata = Readonly<{
  schemaVersion:1;
  sectionId:"12.2";
  status:"completed"|"skipped";
  source:"initial_self_report_and_diagnostic";
  studiedUnits:readonly BiologyUnitId[];
  geneticsFamiliarity:Familiarity|"not_provided";
  supportPreference:SupportPreference|"not_provided";
  diagnosticCount:number;
  diagnosticCorrect:number;
  conceptSignals:readonly ConceptSignal[];
  /** Initial planning hint, not a validated L2 mastery judgment. */
  firstFocusConceptId:string|null;
}>;
