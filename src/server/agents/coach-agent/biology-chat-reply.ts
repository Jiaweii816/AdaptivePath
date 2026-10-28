import "server-only";
import { getQuestion } from "@/features/adaptivepath/content";
import type { AttemptEvidence } from "@/features/adaptivepath/profile";
import { buildBiologyMemoryContext } from "@/server/memory";
import { isLiveBiologyTutorEnabled, liveBiologyTutorReply } from "@/server/adaptivepath/tutor-provider";

/**
 * Biology domain adapter at the ORIGINAL Coach Agent boundary.
 *
 * The legacy LeetCode chatReply loop assumes code, local tests and run
 * evidence. Never pass Biology questions into that loop: it could call
 * run_current_code/verify_proposed_repair. This scoped adapter shares the
 * existing LLM client, memory projection and chat ledger while exposing
 * ONLY Biology tutoring actions, not coding tools.
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
  const {profile,recentEvidence}=buildBiologyMemoryContext(args.attempts);
  if(recentEvidence.length===0)return "diagnostic_probe";
  const mistakes=Object.values(profile.misconceptions);
  if(mistakes.some(x=>x==="confirmed"))return "worked_example";
  if(profile.priorKnowledge==="limited" && recentEvidence.length<3)return "prerequisite_review";
  if(profile.support==="worked_example")return "worked_example";
  if(profile.support==="guided_hint")return "guided_hint";
  if(recentEvidence.at(-1)?.successful && profile.priorKnowledge==="strong")
    return "additional_practice";
  return "guided_hint";
}

export async function biologyCoachReply(args:{
  message:string;
  questionId:string|null;
  attempts:AttemptEvidence[];
  history:Array<{role:"student"|"tutor";content:string}>;
}) {
  const tool=selectBiologyCoachTool(args);
  const question=args.questionId?getQuestion(args.questionId):null;
  // Avoid leaking answers even if live model is configured.
  if(tool==="diagnostic_probe"||tool==="independent_transfer"){
    return {reply:"This is an independent assessment. I can clarify the instructions, but I cannot give you the genotype, correct option, or a worked solution before you submit. Explain which alleles each parent may pass on.",
      provider:"offline_rules" as const,tool};
  }
  const liveReply=await liveBiologyTutorReply({...args,selectedTool:tool}).catch(error=>{
    console.warn("AdaptivePath Biology Coach fallback",error instanceof Error?error.message:"provider error");
    return null;
  });
  if(liveReply) return {reply:liveReply,provider:"live_llm" as const,tool};
  const offline:Record<BiologyCoachTool,string>={
    diagnostic_probe:"",
    independent_transfer:"",
    prerequisite_review:"Prerequisite review: A genotype describes the pair of alleles; a phenotype is the visible trait. Which one are you describing, and why?",
    guided_hint:"Guided hint: Identify each parent's allele pair. List the single allele each gamete can carry. Which combinations could form after fertilization?",
    worked_example:"Worked example with *different* symbols: In Aa × aa, the Aa parent makes A and a gametes; the aa parent makes a gametes. Combine one from each parent, then try your Biology question yourself.",
    additional_practice:"Additional practice: Compare two possible parental genotypes. Explain what evidence from the offspring would help distinguish them, without looking up the answer.",
  };
  // Question-specific solution never sent as a live model output in assessment.
  void question;
  return {reply:offline[tool],provider:"offline_rules" as const,tool};
}

export function biologyCoachProviderConfigured() {return isLiveBiologyTutorEnabled();}
