import { getQuestion, type BiologyTopic } from "./content";
import { BIOLOGY_TOPICS } from "./textbook-chunks";

export type PriorKnowledge = "limited" | "partial" | "strong";
export type Mastery = "unknown" | "emerging" | "stable";
export type MisconceptionStatus = "none" | "suspected" | "confirmed" | "resolved";
export type Support = "independent_work" | "probe" | "guided_hint" | "worked_example" | "extra_practice";
export type Certainty = "low" | "medium" | "high";

export type Evaluation = {
  correctOption: boolean;
  reasoningScore: number;
  successful: boolean;
  misconceptionTags: string[];
  feedback: string;
  evaluator: "offline_rules" | "live_llm";
};
export type AttemptEvidence = {
  id: string;
  questionId: string;
  submittedAt?: string;
  selectedOption: string;
  studentReasoning: string;
  assisted: boolean;
  evaluation: Evaluation;
};
export type TopicProfile = { mastery: Mastery; independentTransferSuccesses: number; evidenceCount: number };
export type LearnerProfile = {
  priorKnowledge: PriorKnowledge;
  mastery: Record<BiologyTopic, TopicProfile>;
  misconceptions: Record<string, MisconceptionStatus>;
  support: Support;
  certainty: Certainty;
  latestEvidence: string[];
};
export const MISCONCEPTION_LABELS: Record<string,string> = {
  "round_means_RR": "Round phenotype always means RR",
  "allele_disappears": "Dominance makes recessive alleles disappear",
  "gamete_has_two_alleles": "Each gamete receives both alleles",
  "cross_cannot_produce_rr": "Rr × rr cannot produce rr",
  "incomplete_dominance_is_blending": "Incomplete dominance permanently blends alleles",
  "codominance_is_incomplete_dominance": "Codominance is the same as an intermediate phenotype",
  "individual_has_more_than_two_alleles": "One diploid individual carries every population allele",
  "sons_get_x_from_father": "Sons inherit their X chromosome from their father",
  "lethal_cross_always_three_to_one": "Recessive lethality leaves a 3:1 ratio of surviving genotypes",
};

const misconceptionTopic:Record<string,BiologyTopic>={
  round_means_RR:"genotype_phenotype",
  allele_disappears:"genotype_phenotype",
  gamete_has_two_alleles:"allele_segregation",
  cross_cannot_produce_rr:"allele_segregation",
  incomplete_dominance_is_blending:"incomplete_dominance",
  codominance_is_incomplete_dominance:"codominance",
  individual_has_more_than_two_alleles:"multiple_alleles",
  sons_get_x_from_father:"sex_linkage",
  lethal_cross_always_three_to_one:"lethality",
};

export function deriveProfile(attempts:AttemptEvidence[]):LearnerProfile {
  const diagnostics=attempts.filter(a=>getQuestion(a.questionId)?.mode==="diagnostic");
  const correctDiagnostics=diagnostics.filter(a=>a.evaluation.successful).length;
  const priorKnowledge:PriorKnowledge=diagnostics.length===0?"partial":
    correctDiagnostics>=Math.max(3,Math.ceil(diagnostics.length*0.75))?"strong":
    correctDiagnostics>=1?"partial":"limited";
  const mastery=Object.fromEntries(BIOLOGY_TOPICS.map(topic=>[topic,{
    mastery:"unknown" as Mastery,independentTransferSuccesses:0,evidenceCount:0,
  }])) as Record<BiologyTopic,TopicProfile>;
  const distinctSuccesses=Object.fromEntries(BIOLOGY_TOPICS.map(topic=>[
    topic,new Set<string>(),
  ])) as Record<BiologyTopic,Set<string>>;
  for(const answer of attempts){
    const question=getQuestion(answer.questionId);
    if(!question)continue;
    mastery[question.topic].evidenceCount++;
    if(question.mode==="transfer"&&answer.evaluation.successful&&!answer.assisted){
      distinctSuccesses[question.topic].add(question.id);
    }
  }
  for(const topic of BIOLOGY_TOPICS){
    mastery[topic].independentTransferSuccesses=distinctSuccesses[topic].size;
    mastery[topic].mastery=distinctSuccesses[topic].size>=2?"stable":
      mastery[topic].evidenceCount>0?"emerging":"unknown";
  }
  const misconceptions:Record<string,MisconceptionStatus>={};
  for(const tag of Object.keys(MISCONCEPTION_LABELS)){
    const flagged=attempts.map((a,index)=>({a,index}))
      .filter(v=>v.a.evaluation.misconceptionTags.includes(tag));
    if(!flagged.length){misconceptions[tag]="none";continue;}
    const topic=misconceptionTopic[tag];
    const lastSignal=flagged.at(-1)!.index;
    const laterSuccessfulTransfers=new Set(attempts.slice(lastSignal+1).filter(a=>{
      const q=getQuestion(a.questionId);
      return q?.mode==="transfer"&&q.topic===topic&&a.evaluation.successful&&!a.assisted;
    }).map(a=>a.questionId));
    misconceptions[tag]=laterSuccessfulTransfers.size>=2?"resolved":
      flagged.length>=2?"confirmed":"suspected";
  }
  const hasConfirmed=Object.values(misconceptions).includes("confirmed");
  const last=attempts.at(-1);
  const contradictory=diagnostics.some(a=>a.evaluation.successful)&&diagnostics.some(a=>!a.evaluation.successful);
  const support:Support=!last?"probe":
    hasConfirmed?"worked_example":
    !last.evaluation.successful?"guided_hint":
    contradictory&&diagnostics.length<9?"probe":
    "independent_work";
  const certainty:Certainty=attempts.length<2||(contradictory&&diagnostics.length<9)?"low":
    attempts.length<8?"medium":"high";
  return {priorKnowledge,mastery,misconceptions,support,certainty,
    latestEvidence:attempts.slice(-4).map(a=>
      a.questionId+": "+(a.evaluation.successful?"reasoning supported":"needs more evidence")+
      (a.assisted?" (assisted)":" (independent)"))};
}

export function nextQuestionId(attempts:AttemptEvidence[]):string|null {
  const done=new Set(attempts.map(a=>a.questionId));
  if(!done.has("D1"))return "D1";
  const d1=attempts.find(a=>a.questionId==="D1");
  if(d1&&!d1.evaluation.successful&&!done.has("D4"))return "D4";
  // The four pitch diagnostics and the original weak/strong starting path are
  // unchanged; new diagnostics cover all remaining Section 12.2 objectives.
  for(const id of ["D2","D3","D4","D5","D6","D7","D8","D9"]){
    if(!done.has(id))return id;
  }
  const failures=attempts.filter(a=>getQuestion(a.questionId)?.mode==="diagnostic"&&!a.evaluation.successful);
  if(failures.length>=2&&!done.has("G1"))return "G1";
  if(failures.some(a=>["D2","D3"].includes(a.questionId))&&!done.has("G2"))return "G2";
  // Target guided supports to the student's *actual* misconception evidence.
  for(const [diagnostic,practice] of [
    ["D5","G3"],["D6","G4"],["D7","G5"],["D8","G6"],["D9","G7"],
  ] as const){
    if(failures.some(a=>a.questionId===diagnostic)&&!done.has(practice))return practice;
  }
  for(const id of ["T1","T2"]){if(!done.has(id))return id;}
  if(deriveProfile(attempts).mastery.genotype_phenotype.mastery!=="stable"&&!done.has("T3"))return "T3";
  // Each remaining topic has two distinct independent transfer questions,
  // so the "Stable" promotion rule is attainable rather than just nominal.
  for(const id of ["T16","T17","T4","T5","T6","T7","T8","T9",
    "T10","T11","T12","T13","T14","T15"]){
    if(!done.has(id))return id;
  }
  return null;
}
