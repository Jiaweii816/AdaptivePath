/**
 * Biology 2e onboarding: whole-book background survey + five §12.2 entry
 * prerequisite checks. Original questions authored from the user-supplied
 * OpenStax Biology 2e (Ch 3.5, 4.3, 11.1, 12.2); no textbook passages copied.
 * Correct choices intentionally live ONLY on the server.
 */
export const BIOLOGY_UNITS = [
  { id:"chemistry", title:"The Chemistry of Life", chapters:"1–3" },
  { id:"cell", title:"The Cell", chapters:"4–10" },
  { id:"genetics", title:"Genetics", chapters:"11–17" },
  { id:"evolution", title:"Evolutionary Processes", chapters:"18–20" },
  { id:"diversity", title:"Biological Diversity", chapters:"21–29" },
  { id:"plant", title:"Plant Structure and Function", chapters:"30–32" },
  { id:"animal", title:"Animal Structure and Function", chapters:"33–43" },
  { id:"ecology", title:"Ecology", chapters:"44–47" },
] as const;

export const FAMILIARITY = ["new","some","comfortable"] as const;
export const SUPPORT_PREFERENCES = ["socratic","step_by_step","worked_example","visual"] as const;
export type BiologyUnitId = (typeof BIOLOGY_UNITS)[number]["id"];
export type Familiarity = (typeof FAMILIARITY)[number];
export type SupportPreference = (typeof SUPPORT_PREFERENCES)[number];
export type DiagnosticQuestion = Readonly<{
  id: string;
  prompt: string;
  choices: readonly Readonly<{id:"A"|"B"|"C"|"D";text:string}>[];
  conceptId: string;
  source: string;
  sourcePages: string;
}>;
export const ONBOARDING_QUESTIONS: readonly DiagnosticQuestion[] = [
  {
    id:"ob-dna", conceptId:"b2e-12-2-concept-01",source:"3.5 Nucleic Acids",sourcePages:"Biology 2e, p. 88",
    prompt:"Which biological molecule stores most inherited genetic information in the chromosomes of a human cell?",
    choices:[{id:"A",text:"DNA"},{id:"B",text:"Starch"},{id:"C",text:"A phospholipid"},{id:"D",text:"ATP"}],
  },
  {
    id:"ob-homologs", conceptId:"b2e-12-2-concept-01",source:"4.3 Eukaryotic Cells / 11.1 The Process of Meiosis",sourcePages:"Biology 2e, pp. 105, 291",
    prompt:"Which statement best describes a pair of homologous chromosomes in a diploid organism?",
    choices:[{id:"A",text:"They have exactly identical DNA sequences."},{id:"B",text:"They carry corresponding genes but may contain different alleles."},{id:"C",text:"Both copies are inherited from the same parent."},{id:"D",text:"They only exist inside haploid gametes."}],
  },
  {
    id:"ob-gametes", conceptId:"b2e-12-2-concept-01",source:"11.1 The Process of Meiosis",sourcePages:"Biology 2e, p. 291",
    prompt:"An individual has genotype Aa at an autosomal locus. Which allele can a normal haploid gamete contain at that locus?",
    choices:[{id:"A",text:"Both A and a together"},{id:"B",text:"AA or aa as a pair"},{id:"C",text:"Either A or a"},{id:"D",text:"Neither allele"}],
  },
  {
    id:"ob-dominance", conceptId:"b2e-12-2-concept-02",source:"12.2 Characteristics and Traits",sourcePages:"Biology 2e, p. 316",
    prompt:"A plant with genotype Aa shows the dominant phenotype. What happens to its recessive a allele?",
    choices:[{id:"A",text:"It disappears from the plant's DNA."},{id:"B",text:"It is retained even if it is not visible in the phenotype."},{id:"C",text:"It changes into A."},{id:"D",text:"The plant carries only A."}],
  },
  {
    id:"ob-cross", conceptId:"b2e-12-2-concept-03",source:"12.2 Characteristics and Traits",sourcePages:"Biology 2e, pp. 317–318",
    prompt:"Assume standard Mendelian segregation and random fertilization. For Aa × aa, what fraction of offspring is expected to have genotype aa?",
    choices:[{id:"A",text:"0"},{id:"B",text:"1/4"},{id:"C",text:"3/4"},{id:"D",text:"1/2"}],
  },
] as const;
