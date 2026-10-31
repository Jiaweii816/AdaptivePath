import "server-only";
import { getQuestion } from "@/features/adaptivepath/content";
import type { Evaluation } from "@/features/adaptivepath/profile";

/**
 * Conservative, transparent offline baseline for demonstration.
 * This is NOT an LLM CER grader. No one answer can establish stable mastery.
 */
export const BIOLOGY_ANSWER_KEY:Record<string,string>={
  D1:"no",D2:"half",D3:"both",D4:"false",
  G1:"same",G2:"half",T1:"Rr",T2:"RrRr",T3:"not",
  D5:"incomplete",D6:"codominance",D7:"two",D8:"mother",D9:"one_two",
  G3:"one_two_one",G4:"both",G5:"population",G6:"half",G7:"aa_nonviable",
  T4:"one_one",T5:"quarter",T6:"half",T7:"one_two_one",
  T8:"no_two",T9:"wild",T10:"half",T11:"white",
  T12:"two_thirds",T13:"no_lethal",T14:"haploid",T15:"late_onset",
  T16:"one_one",T17:"quarter",
};

const EXPANDED_CER_PATTERNS:Record<string,RegExp[]>={
  D5:[/pink|intermediate/,/red.*white|white.*red/,/incomplete|neither.*dominant|heterozyg/],
  D6:[/both|together|simultaneous/,/antigen|m and n|m.*n/,/codominan|express|heterozyg/],
  D7:[/two|2|pair/,/four|4|population|multiple/,/diploid|homolog|one.*each parent/],
  D8:[/mother|maternal/,/x|sex.chromosome/,/father.*y|y.*father|male|xy/],
  D9:[/1.*2|one.*two|2.*1|2.*aa/i,/aa|recessive|homozyg/,/lethal|die|death|surviv|nonviable/],
  G3:[/1.*2.*1|one.*two.*one|quarter.*half.*quarter/,/pink|red|white/,/gamete|allele|cross|heterozyg/],
  G4:[/both|together|simultaneous/,/m.*n|antigen/,/express|codominant|heterozyg/],
  G5:[/two|pair|2/,/population|four|4|multiple/,/diploid|allele|copy|copies/],
  G6:[/half|50|one.in.two/,/son|male|boy/,/mother|carrier|x.chromosome|xⁿ/],
  G7:[/aa|recessive|homozygous/,/die|lethal|nonviable|surviv/,/1.*2|2.*1|ratio|exclude|denominator/],
  T4:[/half|50|1.*1|one.in.two/,/pink|white/,/gamete|allele|heterozyg|cross/],
  T5:[/quarter|25|1.*4/,/red|pink|white/,/heterozyg|incomplete|1.*2.*1|allele/],
  T6:[/half|50|1.*2/,/both|m.*n|antigen/,/allele|parent|heterozyg|gamete/],
  T7:[/1.*2.*1|quarter.*half.*quarter/,/m.*n|antigen/,/both|codominan|offspring|allele/],
  T8:[/two|2|not.*six|cannot.*six/,/population|six|6|variant/,/diploid|copy|allele|homolog/],
  T9:[/wild|brown|dominant/,/albino|c.allele|recessive/,/pigment|allele|mask|express|coat/],
  T10:[/half|50|one.in.two/,/son|male/,/mother|x.chromosome|carrier|female/],
  T11:[/white|recessive/,/son|male|offspring/,/mother|x.chromosome|father.*y|maternal/],
  T12:[/two.third|2.*3|66/,/aa|lethal|recessive/,/surviv|exclude|denominator|three/],
  T13:[/aa|recessive|zygote/,/still|formed|produce|fertiliz|segregat/,/lethal|die|surviv|not observed/],
  T14:[/one|single|haploid/,/allele|gene|dhps/,/resistan|express|copy|dose/],
  T15:[/after|late|adult/,/reproduc|child|offspring/,/transmit|pass|inherit|onset/],
  T16:[/1.*1|half|50/,/Yy|yy|yellow|green/,/gamete|segregat|allele|parent/],
  T17:[/quarter|25|1.*4/,/yy|green|recessive/,/Yy|heterozyg|gamete|segregat|parent/],
};

export function evaluateBiologyAnswer(questionId: string, option: string, reasoning: string): Evaluation {
  const question = getQuestion(questionId);
  if (!question) throw new Error("Unknown Biology question");

  const correctOption = option === BIOLOGY_ANSWER_KEY[questionId];
  const s = reasoning.toLowerCase().replace(/\s+/g," ").trim();
  const has = (...patterns: RegExp[]) => patterns.some(p => p.test(s));
  const concepts: Record<string,boolean[]> = {
    D1: [has(/not necessarily|not always|can (?:be|have)|could (?:be|have)|different genotype|no,? (?:they|both)/),
      has(/\brr\b/i) && has(/\brr\b/i) && /\bRR\b/.test(reasoning) && /\bRr\b/.test(reasoning),
      has(/dominant|phenotype|same appearance|same trait/) && has(/heterozyg|genotype|two allele|allele/)],
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
  const checks = concepts[questionId] ?? EXPANDED_CER_PATTERNS[questionId]?.map(pattern=>pattern.test(s)) ?? [];
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
  // A wrong multiple-choice response alone is a weak *signal*, not proof.
  const extraTags:Record<string,string>={
    D5:"incomplete_dominance_is_blending",D6:"codominance_is_incomplete_dominance",
    D7:"individual_has_more_than_two_alleles",D8:"sons_get_x_from_father",
    D9:"lethal_cross_always_three_to_one",
  };
  if(!correctOption && extraTags[questionId])misconceptionTags.push(extraTags[questionId]);
  const successful = correctOption && reasoningScore >= 3;
  const feedback = successful
    ? "Your choice and explanation provide relevant biological evidence. Continue to an independent question to confirm understanding."
    : "Your explanation needs stronger genotype evidence or a clearer inheritance mechanism. Compare the alleles in each parent and explain how they reach the offspring.";
  return { correctOption, reasoningScore, successful, misconceptionTags: [...new Set(misconceptionTags)], feedback, evaluator:"offline_rules" };
}
