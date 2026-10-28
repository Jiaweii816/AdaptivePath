import "server-only";
import { getQuestion } from "@/features/adaptivepath/content";
import type { AttemptEvidence } from "@/features/adaptivepath/profile";
import { buildBiologyMemoryContext } from "@/server/memory";
import { selectBiologyCoachTool, type BiologyCoachTool } from "@/features/adaptivepath/coach-policy";
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
export async function biologyCoachReply(args:{
  message:string;
  questionId:string|null;
  attempts:AttemptEvidence[];
  history:Array<{role:"student"|"tutor";content:string}>;
}) {
  const tool=selectBiologyCoachTool(args);
  const memory=buildBiologyMemoryContext(args.attempts);
  const question=args.questionId?getQuestion(args.questionId):null;
  // Avoid leaking answers even if live model is configured.
  if(tool==="diagnostic_probe"||tool==="independent_transfer"){
    return {reply:"This is an independent assessment. I can clarify the instructions, but I cannot give you the genotype, correct option, or a worked solution before you submit. Explain which alleles each parent may pass on.",
      provider:"offline_rules" as const,tool};
  }
  const liveReply=await liveBiologyTutorReply({...args,selectedTool:tool,learnerMemory:memory}).catch(error=>{
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
  // In practice, choose a prompt based on the current biology concept, not
  // generic LeetCode "run tests" advice. Preserve guided questioning.
  const topicHints:Record<string,string>={
    genotype_phenotype:"Compare the observable trait with the actual pair of alleles. Could different genotypes produce the same phenotype?",
    allele_segregation:"Draw one allele from each parent's gametes, then combine them in a Punnett square.",
    incomplete_dominance:"Ask whether the heterozygote looks intermediate, and track the two distinct alleles through fertilization.",
    codominance:"Think about whether both parental antigens can be present at the same time in a heterozygote.",
    multiple_alleles:"Separate the number of allele types in the population from the number of copies in one diploid organism.",
    sex_linkage:"Track the X from the mother and the X or Y from the father before counting phenotypes separately by sex.",
    lethality:"First list all possible zygote genotypes, then identify which genotype is absent among surviving offspring.",
  };
  const reply=question&&tool==="guided_hint"?
    "Guided hint: "+(topicHints[question.topic]??offline[tool]):offline[tool];
  return {reply,provider:"offline_rules" as const,tool};
}

export function biologyCoachProviderConfigured() {return isLiveBiologyTutorEnabled();}
