/**
 * Public, instructor-authored Biology 2e §12.2 activities.
 * No answer keys or grading criteria are sent to client components.
 */
export type BiologyMode = "diagnostic" | "guided_practice" | "transfer";
export type BiologyTopic = "genotype_phenotype" | "allele_segregation";
export type BiologyQuestion = {
  id: string;
  topic: BiologyTopic;
  mode: BiologyMode;
  objective: string;
  prompt: string;
  options: Array<{ id: string; text: string }>;
  referenceIds: string[];
};
export type TextbookChunk = {
  id: string;
  section: "12.2";
  subtitle: string;
  page: number;
  pdfPage: number;
  topic: BiologyTopic;
  original: string;
  summary: string;
};

export const OPENSTAX_URL = "https://openstax.org/books/biology-2e/pages/12-2-characteristics-and-traits";

/** Verbatim passages transcribed from the supplied §12.2 PDF. Never send these to an LLM. */
export const TEXTBOOK_CHUNKS: TextbookChunk[] = [
  {
    id: "b2e-12.2-p316-phenotype", section: "12.2", subtitle: "Phenotypes and Genotypes",
    page: 316, pdfPage: 336, topic: "genotype_phenotype",
    original: "Two alleles for a given gene in a diploid organism are expressed and interact to produce physical characteristics. The observable traits expressed by an organism are referred to as its phenotype. An organism’s underlying genetic makeup, consisting of both physically visible and non-expressed alleles, is called its genotype.",
    summary: "A phenotype is observable; a genotype includes alleles whether or not they are expressed.",
  },
  {
    id: "b2e-12.2-p316-dominance", section: "12.2", subtitle: "Dominant and Recessive Alleles",
    page: 316, pdfPage: 336, topic: "genotype_phenotype",
    original: "For a gene that is expressed in a dominant and recessive pattern, homozygous dominant and heterozygous organisms will look identical (that is, they will have different genotypes but the same phenotype). The traits of the recessive allele will only be observed in homozygous recessive individuals (Table 12.4).",
    summary: "A dominant phenotype does not identify a unique genotype.",
  },
  {
    id: "b2e-12.2-p317-punnett", section: "12.2", subtitle: "The Punnett Square Approach for a Monohybrid Cross",
    page: 317, pdfPage: 337, topic: "allele_segregation",
    original: "To prepare a Punnett square, all possible combinations of the parental alleles are listed along the top (for one parent) and side (for the other parent) of a grid, representing their meiotic segregation into haploid gametes. Then the combinations of egg and sperm are made in the boxes in the table to show which alleles are combining. Each box then represents the diploid genotype of a zygote, or fertilized egg, that could result from this mating.",
    summary: "Each gamete contributes one allele; combine them to predict offspring genotypes.",
  },
  {
    id: "b2e-12.2-p319-test", section: "12.2", subtitle: "The Test Cross Distinguishes the Dominant Phenotype",
    page: 319, pdfPage: 339, topic: "genotype_phenotype",
    original: "In a test cross, the dominant-expressing organism is crossed with an organism that is homozygous recessive for the same characteristic. If the dominant-expressing organism is a homozygote, then all F1 offspring will be heterozygotes expressing the dominant trait (Figure 12.5). Alternatively, if the dominant expressing organism is a heterozygote, the F1 offspring will exhibit a 1:1 ratio of heterozygotes and recessive homozygotes (Figure 12.5).",
    summary: "A test cross with rr can distinguish RR from Rr through the offspring.",
  },
  {
    id: "b2e-12.2-p320-alleles", section: "12.2", subtitle: "Alternatives to Dominance and Recessiveness",
    page: 320, pdfPage: 340, topic: "genotype_phenotype",
    original: "Mendel’s experiments with pea plants suggested that: (1) two “units” or alleles exist for every gene; (2) alleles maintain their integrity in each generation (no blending); and (3) in the presence of the dominant allele, the recessive allele is hidden and makes no contribution to the phenotype.",
    summary: "Recessive alleles may be unexpressed yet retained and transmitted.",
  },
];

export const BIOLOGY_QUESTIONS: BiologyQuestion[] = [
  { id:"D1", topic:"genotype_phenotype", mode:"diagnostic",
    objective:"Distinguish genotype from phenotype.",
    prompt:"Two round-seed plants look the same. Must they have the same genotype? Explain.",
    options:[{id:"yes",text:"Yes, both must be RR"},{id:"no",text:"No, they could be RR or Rr"},{id:"unsure",text:"I am not sure"}],
    referenceIds:["b2e-12.2-p316-phenotype","b2e-12.2-p316-dominance"] },
  { id:"D2",topic:"allele_segregation",mode:"diagnostic",
    objective:"Predict gametes and offspring genotypes.",
    prompt:"For Rr × rr, list the possible gametes and offspring genotypes.",
    options:[{id:"half",text:"Rr and rr are possible offspring"},{id:"allRr",text:"All offspring must be Rr"},{id:"other",text:"Another outcome / unsure"}],
    referenceIds:["b2e-12.2-p317-punnett"] },
  { id:"D3",topic:"allele_segregation",mode:"diagnostic",
    objective:"Explain an inheritance mechanism, not just a ratio.",
    prompt:"Explain how Rr × rr can produce both round and wrinkled offspring.",
    options:[{id:"both",text:"Both round and wrinkled are possible"},{id:"round",text:"Only round offspring are possible"},{id:"unsure",text:"I am not sure"}],
    referenceIds:["b2e-12.2-p317-punnett","b2e-12.2-p319-test"] },
  { id:"D4",topic:"genotype_phenotype",mode:"diagnostic",
    objective:"Critique a misconception about dominant and recessive alleles.",
    prompt:"Evaluate: “The dominant allele wins, so the recessive allele disappears.”",
    options:[{id:"false",text:"The claim is false"},{id:"true",text:"The claim is correct"},{id:"unsure",text:"I am not sure"}],
    referenceIds:["b2e-12.2-p320-alleles"] },
  { id:"G1",topic:"genotype_phenotype",mode:"guided_practice",
    objective:"Compare homozygous and heterozygous round-seed plants.",
    prompt:"Compare the genotypes RR and Rr. Why are their phenotypes alike even though their allele pairs differ?",
    options:[{id:"same",text:"They show the same round phenotype"},{id:"different",text:"They must have different phenotypes"}],
    referenceIds:["b2e-12.2-p316-dominance"] },
  { id:"G2",topic:"allele_segregation",mode:"guided_practice",
    objective:"Practice constructing a genetic cross.",
    prompt:"For Rr × rr, identify each parent's gametes and use them to explain the possible offspring.",
    options:[{id:"half",text:"Rr and rr"},{id:"all",text:"RR and rr"}],
    referenceIds:["b2e-12.2-p317-punnett"] },
  { id:"T1",topic:"genotype_phenotype",mode:"transfer",
    objective:"Apply a test cross without hints.",
    prompt:"A round-seed plant is crossed with an rr plant, and some offspring are wrinkled. What must the round-seed parent's genotype be? Justify your answer.",
    options:[{id:"Rr",text:"Rr"},{id:"RR",text:"RR"},{id:"rr",text:"rr"}],
    referenceIds:["b2e-12.2-p319-test"] },
  { id:"T2",topic:"genotype_phenotype",mode:"transfer",
    objective:"Explain allele transmission in a new cross.",
    prompt:"Two round-seed plants produce a wrinkled-seed offspring. Give a possible genotype for each parent and explain how the wrinkled offspring can arise.",
    options:[{id:"RrRr",text:"Rr × Rr"},{id:"RRRR",text:"RR × RR"},{id:"RRRr",text:"RR × Rr"}],
    referenceIds:["b2e-12.2-p317-punnett","b2e-12.2-p316-dominance"] },
  { id:"T3",topic:"genotype_phenotype",mode:"transfer",
    objective:"Evaluate genotype claims using offspring evidence.",
    prompt:"A round-seed parent crossed with rr produces both round and wrinkled offspring. A student claims that the round parent is RR. Is the claim supported? Explain.",
    options:[{id:"not",text:"No, the parent must be Rr"},{id:"yes",text:"Yes, RR is necessary"},{id:"unsure",text:"Not enough information"}],
    referenceIds:["b2e-12.2-p319-test"] },
];
export const getQuestion = (id:string) => BIOLOGY_QUESTIONS.find(q => q.id === id);
export const getReference = (id:string) => TEXTBOOK_CHUNKS.find(c => c.id === id);
