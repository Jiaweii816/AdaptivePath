/**
 * AdaptivePath Biology 2e §12.2 — full-section indexed textbook and
 * instructor-reviewed question bank. The four original pitch diagnostic
 * prompts D1–D4 are preserved, and no answer keys are sent to this client.
 */
import { TEXTBOOK_CHUNKS, OPENSTAX_URL, getReference, textbookReference as ref } from "./textbook-chunks";
import { EXPANDED_BIOLOGY_QUESTIONS } from "./expanded-questions";

export { TEXTBOOK_CHUNKS, OPENSTAX_URL, getReference };
export type { BiologyTopic, TextbookChunk } from "./textbook-chunks";
import type { BiologyTopic } from "./textbook-chunks";
export type BiologyMode = "diagnostic" | "guided_practice" | "transfer";
export type BiologyQuestion = {
  id:string;
  topic:BiologyTopic;
  mode:BiologyMode;
  objective:string;
  prompt:string;
  options:Array<{id:string;text:string}>;
  referenceIds:string[];
};

const ORIGINAL_BIOLOGY_QUESTIONS: BiologyQuestion[] = [
  { id:"D1", topic:"genotype_phenotype", mode:"diagnostic",
    objective:"Distinguish genotype from phenotype.",
    prompt:"Two round-seed plants look the same. Must they have the same genotype? Explain.",
    options:[{id:"yes",text:"Yes, both must be RR"},{id:"no",text:"No, they could be RR or Rr"},{id:"unsure",text:"I am not sure"}],
    referenceIds:[ref("Phenotypes and Genotypes","underlying genetic makeup"),ref("Dominant and Recessive Alleles","homozygous dominant and heterozygous")] },
  { id:"D2",topic:"allele_segregation",mode:"diagnostic",
    objective:"Predict gametes and offspring genotypes.",
    prompt:"For Rr × rr, list the possible gametes and offspring genotypes.",
    options:[{id:"half",text:"Rr and rr are possible offspring"},{id:"allRr",text:"All offspring must be Rr"},{id:"other",text:"Another outcome / unsure"}],
    referenceIds:[ref("The Punnett Square Approach for a Monohybrid Cross","To prepare a Punnett square")] },
  { id:"D3",topic:"allele_segregation",mode:"diagnostic",
    objective:"Explain an inheritance mechanism, not just a ratio.",
    prompt:"Explain how Rr × rr can produce both round and wrinkled offspring.",
    options:[{id:"both",text:"Both round and wrinkled are possible"},{id:"round",text:"Only round offspring are possible"},{id:"unsure",text:"I am not sure"}],
    referenceIds:[ref("The Punnett Square Approach for a Monohybrid Cross","To prepare a Punnett square"),ref("The Test Cross Distinguishes the Dominant Phenotype","In a test cross")] },
  { id:"D4",topic:"genotype_phenotype",mode:"diagnostic",
    objective:"Critique a misconception about dominant and recessive alleles.",
    prompt:"Evaluate: “The dominant allele wins, so the recessive allele disappears.”",
    options:[{id:"false",text:"The claim is false"},{id:"true",text:"The claim is correct"},{id:"unsure",text:"I am not sure"}],
    referenceIds:[ref("Alternatives to Dominance and Recessiveness","Mendel’s experiments with pea plants")] },
  { id:"G1",topic:"genotype_phenotype",mode:"guided_practice",
    objective:"Compare homozygous and heterozygous round-seed plants.",
    prompt:"Compare the genotypes RR and Rr. Why are their phenotypes alike even though their allele pairs differ?",
    options:[{id:"same",text:"They show the same round phenotype"},{id:"different",text:"They must have different phenotypes"}],
    referenceIds:[ref("Dominant and Recessive Alleles","homozygous dominant and heterozygous")] },
  { id:"G2",topic:"allele_segregation",mode:"guided_practice",
    objective:"Practice constructing a genetic cross.",
    prompt:"For Rr × rr, identify each parent's gametes and use them to explain the possible offspring.",
    options:[{id:"half",text:"Rr and rr"},{id:"all",text:"RR and rr"}],
    referenceIds:[ref("The Punnett Square Approach for a Monohybrid Cross","To prepare a Punnett square")] },
  { id:"T1",topic:"genotype_phenotype",mode:"transfer",
    objective:"Apply a test cross without hints.",
    prompt:"A round-seed plant is crossed with an rr plant, and some offspring are wrinkled. What must the round-seed parent's genotype be? Justify your answer.",
    options:[{id:"Rr",text:"Rr"},{id:"RR",text:"RR"},{id:"rr",text:"rr"}],
    referenceIds:[ref("The Test Cross Distinguishes the Dominant Phenotype","In a test cross")] },
  { id:"T2",topic:"genotype_phenotype",mode:"transfer",
    objective:"Explain allele transmission in a new cross.",
    prompt:"Two round-seed plants produce a wrinkled-seed offspring. Give a possible genotype for each parent and explain how the wrinkled offspring can arise.",
    options:[{id:"RrRr",text:"Rr × Rr"},{id:"RRRR",text:"RR × RR"},{id:"RRRr",text:"RR × Rr"}],
    referenceIds:[ref("The Punnett Square Approach for a Monohybrid Cross","To prepare a Punnett square"),ref("Dominant and Recessive Alleles","homozygous dominant and heterozygous")] },
  { id:"T3",topic:"genotype_phenotype",mode:"transfer",
    objective:"Evaluate genotype claims using offspring evidence.",
    prompt:"A round-seed parent crossed with rr produces both round and wrinkled offspring. A student claims that the round parent is RR. Is the claim supported? Explain.",
    options:[{id:"not",text:"No, the parent must be Rr"},{id:"yes",text:"Yes, RR is necessary"},{id:"unsure",text:"Not enough information"}],
    referenceIds:[ref("The Test Cross Distinguishes the Dominant Phenotype","In a test cross")] },
];
export const BIOLOGY_QUESTIONS:BiologyQuestion[]=[
  ...ORIGINAL_BIOLOGY_QUESTIONS,
  ...EXPANDED_BIOLOGY_QUESTIONS,
];
export const getQuestion=(id:string)=>BIOLOGY_QUESTIONS.find(q=>q.id===id);
