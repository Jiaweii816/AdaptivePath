import { getQuestion, type BiologyTopic } from "./content";

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
};

export function deriveProfile(attempts: AttemptEvidence[]): LearnerProfile {
  const diagnostics = attempts.filter(a => getQuestion(a.questionId)?.mode === "diagnostic");
  const correctDiagnostics = diagnostics.filter(a => a.evaluation.successful).length;
  const priorKnowledge: PriorKnowledge = diagnostics.length === 0 ? "partial" :
    correctDiagnostics >= 3 ? "strong" : correctDiagnostics >= 1 ? "partial" : "limited";
  const mastery = {
    genotype_phenotype: { mastery: "unknown" as Mastery, independentTransferSuccesses: 0, evidenceCount: 0 },
    allele_segregation: { mastery: "unknown" as Mastery, independentTransferSuccesses: 0, evidenceCount: 0 },
  };
  const tags = Object.keys(MISCONCEPTION_LABELS);
  const misconceptions: Record<string,MisconceptionStatus> = {};
  const distinctSuccesses: Record<BiologyTopic, Set<string>> = {
    genotype_phenotype: new Set(), allele_segregation: new Set(),
  };
  for (const attempt of attempts) {
    const question = getQuestion(attempt.questionId);
    if (!question) continue;
    mastery[question.topic].evidenceCount += 1;
    if (question.mode === "transfer" && attempt.evaluation.successful && !attempt.assisted) {
      distinctSuccesses[question.topic].add(question.id);
    }
  }
  for (const topic of Object.keys(mastery) as BiologyTopic[]) {
    const topicProfile = mastery[topic];
    topicProfile.independentTransferSuccesses = distinctSuccesses[topic].size;
    topicProfile.mastery = distinctSuccesses[topic].size >= 2
      ? "stable" : topicProfile.evidenceCount > 0 ? "emerging" : "unknown";
  }
  for (const tag of tags) {
    const seen = attempts.filter(a => a.evaluation.misconceptionTags.includes(tag));
    const resolvedBy = attempts.filter(a => {
      const question = getQuestion(a.questionId);
      return question?.mode === "transfer" && a.evaluation.successful && !a.assisted;
    });
    const tagTopic: BiologyTopic = tag === "gamete_has_two_alleles" || tag === "cross_cannot_produce_rr"
      ? "allele_segregation" : "genotype_phenotype";
    const resolution = new Set(resolvedBy.filter(a => getQuestion(a.questionId)?.topic === tagTopic).map(a => a.questionId)).size;
    misconceptions[tag] = seen.length === 0 ? "none" :
      resolution >= 2 && attempts.indexOf(seen[seen.length - 1]) < attempts.indexOf(resolvedBy[resolvedBy.length - 1])
        ? "resolved" : seen.length >= 2 ? "confirmed" : "suspected";
  }
  const hasUnresolved = Object.values(misconceptions).some(s => s === "confirmed");
  const last = attempts[attempts.length - 1];
  const contradictory = diagnostics.some(a => a.evaluation.successful) && diagnostics.some(a => !a.evaluation.successful);
  const support: Support = !last ? "probe" :
    hasUnresolved ? "worked_example" :
    !last.evaluation.successful ? "guided_hint" :
    contradictory && diagnostics.length < 4 ? "probe" :
    mastery.genotype_phenotype.mastery === "stable" ? "independent_work" :
    "independent_work";
  const certainty: Certainty = attempts.length < 2 || contradictory && diagnostics.length < 4
    ? "low" : attempts.length < 4 ? "medium" : "high";
  return { priorKnowledge, mastery, misconceptions, support, certainty,
    latestEvidence: attempts.slice(-4).map(a =>
      a.questionId + ": " + (a.evaluation.successful ? "reasoning supported" : "needs more evidence") +
      (a.assisted ? " (assisted)" : " (independent)")) };
}

export function nextQuestionId(attempts: AttemptEvidence[]): string | null {
  const done = new Set(attempts.map(a => a.questionId));
  if (!done.has("D1")) return "D1";
  const d1 = attempts.find(a => a.questionId === "D1");
  if (d1 && !d1.evaluation.successful && !done.has("D4")) return "D4";
  for (const id of ["D2","D3","D4"]) if (!done.has(id)) return id;
  const profile = deriveProfile(attempts);
  const diagFailures = attempts.filter(a => getQuestion(a.questionId)?.mode === "diagnostic" && !a.evaluation.successful).length;
  if (diagFailures >= 2 && !done.has("G1")) return "G1";
  if (!done.has("T1")) return "T1";
  if (!done.has("T2")) return "T2";
  if (profile.mastery.genotype_phenotype.mastery !== "stable") {
    if (!done.has("G2")) return "G2";
    if (!done.has("T3")) return "T3";
  }
  return null;
}
