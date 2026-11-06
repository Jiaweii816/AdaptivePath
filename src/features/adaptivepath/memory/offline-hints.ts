/**
 * Explicit offline tutor mode (ADAPTIVEPATH_TUTOR_PROVIDER != "live").
 * Hints are concept-level only and never reveal a question's answer.
 */
import type { BiologyCoachTool } from "./coach-policy";

export const OFFLINE_CONCEPT_HINTS: Readonly<Record<string, string>> = {
  "b2e-12-2-concept-01": "Separate three ideas: a gene is a locus, alleles are versions of it, and ploidy is how many copies of each chromosome a cell carries.",
  "b2e-12-2-concept-02": "Compare the observable trait with the actual pair of alleles. Could different genotypes produce the same phenotype?",
  "b2e-12-2-concept-03": "Write the gametes each parent can make, one allele per gamete, then combine them in a Punnett square.",
  "b2e-12-2-concept-04": "In a test cross the tester is homozygous recessive. Ask what offspring you would expect if the unknown parent were heterozygous, and how many offspring it takes to be convinced.",
  "b2e-12-2-concept-05": "In a recessive pedigree, an affected child of unaffected parents tells you something about both parents. Work backwards from the affected individual.",
  "b2e-12-2-concept-06": "Ask whether the heterozygote looks intermediate, and track the two distinct alleles through fertilization — they do not blend permanently.",
  "b2e-12-2-concept-07": "Think about whether both parental products can be present at the same time in a heterozygote, as with M and N antigens.",
  "b2e-12-2-concept-08": "Separate the number of allele types in the population from the number of copies one diploid organism carries.",
  "b2e-12-2-concept-09": "Track the X from the mother and the X or Y from the father, then count phenotypes separately for sons and daughters.",
  "b2e-12-2-concept-10": "First list all possible zygote genotypes, then remove the one that does not survive before computing ratios.",
};

type OfflineInput = Readonly<{
  tool: BiologyCoachTool;
  conceptIds: readonly string[];
  hintStep: 1 | 2 | 3;
  subsections: readonly string[];
}>;

function conceptHint(conceptIds: readonly string[]): string {
  return conceptIds.map((id) => {
    const hint = OFFLINE_CONCEPT_HINTS[id];
    if (!hint) throw new Error(`No offline hint for concept ${id}`);
    return hint;
  }).join(" ");
}

function passage(subsections: readonly string[]): string {
  return subsections.length ? `“${subsections.join("”, “")}”` : "the passage linked to this question";
}

const LADDER: Readonly<Record<1 | 2 | 3, (input: OfflineInput) => string>> = {
  1: () => "Guided hint (step 1): Before choosing, what does each answer option assume about the parents' alleles?",
  2: (input) => `Guided hint (step 2): Re-read ${passage(input.subsections)} in the textbook and find the sentence that applies here.`,
  3: (input) => `Guided hint (step 3): Key step — ${conceptHint(input.conceptIds)}`,
};

export function offlineTutorReply(input: OfflineInput): string {
  if (input.tool === "guided_hint") return LADDER[input.hintStep](input);
  if (input.tool === "worked_example") {
    return `Worked example: ${conceptHint(input.conceptIds)} Try it with different letters (for example Bb × bb) first, then return to your question.`;
  }
  if (input.tool === "reference_pointer") {
    return `Re-read ${passage(input.subsections)}. Which sentence there decides between the options?`;
  }
  return "What would you expect to observe if your current answer were wrong? Test your reasoning against that.";
}
