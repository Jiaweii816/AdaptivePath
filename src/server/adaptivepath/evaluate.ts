import "server-only";
import { getQuestion } from "@/features/adaptivepath/content";
import type { Evaluation } from "@/features/adaptivepath/profile";

/**
 * Conservative, transparent offline baseline for demonstration.
 * This is NOT an LLM CER grader. No one answer can establish stable mastery.
 */
export function evaluateBiologyAnswer(questionId: string, option: string, reasoning: string): Evaluation {
  const question = getQuestion(questionId);
  if (!question) throw new Error("Unknown Biology question");
  const answerKey: Record<string,string> = {
    D1:"no", D2:"half", D3:"both", D4:"false",
    G1:"same", G2:"half", T1:"Rr", T2:"RrRr", T3:"not",
  };
  const correctOption = option === answerKey[questionId];
  const s = reasoning.toLowerCase().replace(/\s+/g," ").trim();
  const has = (...patterns: RegExp[]) => patterns.some(p => p.test(s));
  const genes = has(/\brr\b/i) && has(/\brr\b/i); // stronger rules below check actual concepts
  void genes;
  const concepts: Record<string,boolean[]> = {
    D1: [has(/not necessarily|not always|can (?:be|have)|could (?:be|have)|different genotype|no,? (?:they|both)/),
      has(/\brr\b/i) && has(/\brr\b/i) && /\bRR\b/.test(reasoning) && /\bRr\b/.test(reasoning),
      has(/dominant|phenotype|same appearance|same trait/) && has(/heterozyg|genotype|two allele/)],
    D2: [has(/gamete|parent|segregat/),
      /\bR\b/.test(reasoning) && /\br\b/.test(reasoning),
      /\bRr\b/.test(reasoning) && /\brr\b/.test(reasoning)],
    D3: [has(/\bRr\b/i) && has(/\brr\b/i),
      has(/gamete|segregat|allele|inherit|parent/),
      has(/round/) && has(/wrinkled/) && has(/half|50%|1:1|one half|two possible|r from/)],
    D4: [has(/false|incorrect|wrong|does not disappear|not disappear|doesn't disappear|not lost|remains|still present/),
      has(/recessive|\br\b/),
      has(/hidden|mask|unexpressed|carried|transmit|pass|offspring|heterozyg/)],
    G1: [/\bRR\b/.test(reasoning) && /\bRr\b/.test(reasoning),
      has(/round|same phenotype|same trait/), has(/dominant|recessive|heterozyg/)],
    G2: [/\bRr\b/.test(reasoning) && /\brr\b/.test(reasoning),
      has(/gamete|segregat|allele/), has(/half|50%|1:1|offspring/)],
    T1: [/\bRr\b/.test(reasoning), /\brr\b/.test(reasoning),
      has(/recessive|r allele|wrinkled|inherit|pass|gamete|from each/)],
    T2: [/\bRr\b/.test(reasoning), /\brr\b/.test(reasoning),
      has(/each parent|both parent|each contribute|each pass|two r|r from|inherit|gamete/)],
    T3: [/\bRr\b/.test(reasoning) && /\bRR\b/.test(reasoning),
      /\brr\b/.test(reasoning), has(/cannot|not|false|incorrect|recessive|r allele|wrinkled/)],
  };
  const checks = concepts[questionId] ?? [];
  // CER interpretation: biologically appropriate claim, relevant genetic evidence,
  // mechanism, coherent link. The offline result remains provisional.
  const claim = Number(correctOption && checks[0]);
  const evidence = Number(checks[1] ?? false);
  const mechanism = Number(checks[2] ?? false);
  const coherent = Number(claim === 1 && evidence === 1 && mechanism === 1 &&
    s.split(/\s+/).length >= 7);
  const reasoningScore = claim + evidence + mechanism + coherent;
  const misconceptionTags: string[] = [];
  if (questionId === "D1" && (!correctOption || has(/must be rr|both are rr|only rr|always rr/))) {
    misconceptionTags.push("round_means_RR");
  }
  if (questionId === "D4" && (!correctOption || has(/recessive (?:allele )?(?:disappears|vanishes|is destroyed)/))) {
    misconceptionTags.push("allele_disappears");
  }
  if ((questionId === "D1" || questionId === "D4") && has(/dominant.*(?:disappear|eliminat|destroy|erase)/) &&
      !has(/does not|doesn't|not true|incorrect|wrong|false/)) {
    misconceptionTags.push("allele_disappears");
  }
  if (questionId === "D2" && has(/gamete.*(?:rr|rr|two alleles)/)) misconceptionTags.push("gamete_has_two_alleles");
  if (questionId === "D3" && !correctOption) misconceptionTags.push("cross_cannot_produce_rr");
  const successful = correctOption && reasoningScore >= 3;
  const feedback = successful
    ? "Your choice and explanation provide relevant biological evidence. Continue to an independent question to confirm understanding."
    : "Your explanation needs stronger genotype evidence or a clearer inheritance mechanism. Compare the alleles in each parent and explain how they reach the offspring.";
  return { correctOption, reasoningScore, successful, misconceptionTags: [...new Set(misconceptionTags)], feedback, evaluator:"offline_rules" };
}
