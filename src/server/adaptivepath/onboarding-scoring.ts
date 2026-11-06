import { z } from "zod";
import { BIOLOGY_UNITS,FAMILIARITY,ONBOARDING_QUESTIONS,SUPPORT_PREFERENCES } from "@/features/adaptivepath/onboarding/catalog";
import type { BiologyOnboardingMetadata,ConceptSignal } from "@/features/adaptivepath/onboarding/types";

const choice = z.enum(["A","B","C","D"]);
export const onboardingSubmissionSchema = z.object({
  studiedUnits:z.array(z.enum(BIOLOGY_UNITS.map(u=>u.id) as [string,...string[]])).max(8),
  geneticsFamiliarity:z.enum(FAMILIARITY),
  supportPreference:z.enum(SUPPORT_PREFERENCES),
  responses:z.record(z.string(),choice),
}).strict();
export type OnboardingSubmission=z.infer<typeof onboardingSubmissionSchema>;

// Kept strictly server-side: correct options are never part of the client catalog.
const answerKey:Readonly<Record<string,"A"|"B"|"C"|"D">>=Object.freeze({
  "ob-dna":"A","ob-homologs":"B","ob-gametes":"C",
  "ob-dominance":"B","ob-cross":"D",
});

export function summarizeOnboarding(input:OnboardingSubmission):BiologyOnboardingMetadata {
  const parsed=onboardingSubmissionSchema.parse(input);
  const ids=new Set(ONBOARDING_QUESTIONS.map(q=>q.id));
  if(Object.keys(parsed.responses).length!==ids.size||
    Object.keys(parsed.responses).some(id=>!ids.has(id))) {
    throw new Error("All five diagnostic responses are required.");
  }
  const buckets=new Map<string,{correct:number;count:number}>();
  for(const q of ONBOARDING_QUESTIONS) {
    const prior=buckets.get(q.conceptId)??{correct:0,count:0};
    buckets.set(q.conceptId,{
      count:prior.count+1,
      correct:prior.correct+(parsed.responses[q.id]===answerKey[q.id]?1:0),
    });
  }
  const conceptSignals:ConceptSignal[]=[...buckets].map(([conceptId,x])=>({
    conceptId,
    questionsAnswered:x.count,
    correct:x.correct,
    status:x.correct===x.count?"promising":"needs_review",
    confidence:"low",
  }));
  return {
    schemaVersion:1,sectionId:"12.2",status:"completed",
    source:"initial_self_report_and_diagnostic",
    studiedUnits:[...new Set(parsed.studiedUnits)],
    geneticsFamiliarity:parsed.geneticsFamiliarity,
    supportPreference:parsed.supportPreference,
    diagnosticCount:ONBOARDING_QUESTIONS.length,
    diagnosticCorrect:conceptSignals.reduce((n,x)=>n+x.correct,0),
    conceptSignals,
    firstFocusConceptId:conceptSignals.find(x=>x.status==="needs_review")?.conceptId??null,
  };
}
export const SKIPPED_ONBOARDING:BiologyOnboardingMetadata=Object.freeze({
  schemaVersion:1,sectionId:"12.2",status:"skipped",
  source:"initial_self_report_and_diagnostic",
  studiedUnits:[],geneticsFamiliarity:"not_provided",supportPreference:"not_provided",
  diagnosticCount:0,diagnosticCorrect:0,conceptSignals:[],firstFocusConceptId:null,
});
