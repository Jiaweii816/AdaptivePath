import { BIOLOGY_12_2_EXTRACTED } from "./data/biology-12-2-extracted";

export const BIOLOGY_TOPICS = [
  "genotype_phenotype","allele_segregation","incomplete_dominance",
  "codominance","multiple_alleles","sex_linkage","lethality",
] as const;
export type BiologyTopic = (typeof BIOLOGY_TOPICS)[number];
export type ChunkKind =
  "paragraph" | "learning_objective" | "figure" | "table" | "question" | "context";
export type TextbookChunk = {
  id:string;
  section:"12.2";
  subtitle:string;
  page:number;
  pdfPage:number;
  topic:BiologyTopic;
  kind:ChunkKind;
  original:string;
  summary:string;
  misconceptionTags:string[];
  sourceLineStart:number;
  sourceLineEnd:number;
};

export const OPENSTAX_URL = "https://openstax.org/books/biology-2e/pages/12-2-characteristics-and-traits";
export const OPENSTAX_ATTRIBUTION =
  "OpenStax, Biology 2e, Section 12.2, Characteristics and Traits. Source: user-supplied textbook extraction, printed pp. 316–327 (PDF pp. 336–347). Original source licensing/credit applies.";

const HEADING_TOPIC:Record<string,BiologyTopic> = {
  "Phenotypes and Genotypes":"genotype_phenotype",
  "Dominant and Recessive Alleles":"genotype_phenotype",
  "The Punnett Square Approach for a Monohybrid Cross":"allele_segregation",
  "The Test Cross Distinguishes the Dominant Phenotype":"genotype_phenotype",
  "Alternatives to Dominance and Recessiveness":"genotype_phenotype",
  "Incomplete Dominance":"incomplete_dominance",
  "Codominance":"codominance",
  "Multiple Alleles":"multiple_alleles",
  "Multiple Alleles Confer Drug Resistance in the Malaria Parasite":"multiple_alleles",
  "X-Linked Traits":"sex_linkage",
  "Human Sex-linked Disorders":"sex_linkage",
  "Lethality":"lethality",
};
const TOPIC_MISCONCEPTIONS:Record<BiologyTopic,string[]> = {
  genotype_phenotype:["round_means_RR","allele_disappears"],
  allele_segregation:["gamete_has_two_alleles","cross_cannot_produce_rr"],
  incomplete_dominance:["incomplete_dominance_is_blending"],
  codominance:["codominance_is_incomplete_dominance"],
  multiple_alleles:["individual_has_more_than_two_alleles"],
  sex_linkage:["sons_get_x_from_father"],
  lethality:["lethal_cross_always_three_to_one"],
};
const SOURCE_PAGE = /^====== PRINTED PAGE (\d+) \| PDF SOURCE PAGE (\d+) ======$/;
const PAGE_HEADER = /^(?:\d{3}\s+12\s*[•]\s*Mendel|12\.2\s*[•]\s*Characteristics and Traits|12\.3\s*[•]\s*Laws of Inheritance)/;
const CALLOUT = new Set(["LEARNING OBJECTIVES","VISUAL CONNECTION","LINK TO LEARNING","EVOLUTION CONNECTION"]);
const SUPPORTING_LABEL = /^\b(?:FIGURE|TABLE)\s+12\.\d+\b/i;

/**
 * Deterministic, page-aware paragraph chunking of the COMPLETE supplied
 * extraction (including objectives, callouts, figure captions, tables and
 * exercises). Paragraphs never cross printed-page boundaries; split source
 * paragraphs therefore carry their own accurate page references.
 *
 * We exclude only repeated page headers, attribution footers and metadata
 * outside the source. All other extracted section content remains in chunks.
 */
export function chunkBiologySection(source= BIOLOGY_12_2_EXTRACTED):TextbookChunk[] {
  const lines=source.split(/\r?\n/);
  const out:TextbookChunk[]=[];
  const seq:Record<number,number>={};
  let page=0,pdfPage=0,subtitle="Introduction: genes and alleles";
  let topic:BiologyTopic="genotype_phenotype";
  let active:string[]=[],start=0,kind:ChunkKind="paragraph";
  const flush=(end:number)=>{
    if(!active.length||!page){active=[];return;}
    const original=active.join(" ").replace(/\s+/g," ").replace(/- ([a-z])/g,"-$1").trim();
    active=[];
    if(!original)return;
    const pieces:string[]=[];
    // Rare long paragraphs remain readable; use complete sentences when split.
    if(original.length<=1600)pieces.push(original);
    else {
      const sentences=original.match(/[^.!?]+[.!?]+|[^.!?]+$/g)??[original];
      let accumulator="";
      for(const sentence of sentences){
        if(accumulator && (accumulator+sentence).length>1400){
          pieces.push(accumulator.trim());accumulator="";
        }
        accumulator+=sentence;
      }
      if(accumulator.trim())pieces.push(accumulator.trim());
    }
    for(const part of pieces){
      seq[page]=(seq[page]??0)+1;
      const sentence=part.match(/^.{1,210}?[.!?](?=\s|$)/)?.[0] ?? part.slice(0,180);
      out.push({
        id:`b2e-12.2-p${page}-c${String(seq[page]).padStart(2,"0")}`,
        section:"12.2",subtitle,page,pdfPage,topic,kind,original:part,
        summary:sentence,
        misconceptionTags:TOPIC_MISCONCEPTIONS[topic],
        sourceLineStart:start,sourceLineEnd:end,
      });
    }
  };
  for(let i=0;i<lines.length;i++){
    const text=lines[i].trim();
    const marker=text.match(SOURCE_PAGE);
    if(marker){
      flush(i);page=Number(marker[1]);pdfPage=Number(marker[2]);continue;
    }
    if(page===0)continue;
    if(!text){flush(i);continue;}
    if(text==="12.2 Characteristics and Traits"||text==="Access for free at openstax.org"||PAGE_HEADER.test(text))continue;
    if(text in HEADING_TOPIC) {
      flush(i);subtitle=text;topic=HEADING_TOPIC[text];continue;
    }
    if(CALLOUT.has(text)){
      flush(i);kind=text==="LEARNING OBJECTIVES"?"learning_objective":"context";
      if(text==="EVOLUTION CONNECTION")subtitle="Multiple Alleles Confer Drug Resistance in the Malaria Parasite";
      continue;
    }
    if(!active.length){
      start=i+1;
      kind=SUPPORTING_LABEL.test(text)?(text.startsWith("TABLE")?"table":"figure"):
        /^What |^In pea plants, round peas|^What are the genotypes/.test(text)?"question":
        subtitle==="Learning objectives"?"learning_objective":"paragraph";
    }
    active.push(text);
  }
  flush(lines.length);
  return out;
}
export const TEXTBOOK_CHUNKS = chunkBiologySection();

/** Exact heading + phrase matching, rather than page guessing. */
export function textbookReference(heading:string,contains:string):string {
  const chunk=TEXTBOOK_CHUNKS.find(c=>c.subtitle===heading &&
    c.original.toLowerCase().includes(contains.toLowerCase()));
  if(!chunk)throw new Error(`Missing Section 12.2 reference: ${heading} / ${contains}`);
  return chunk.id;
}
export const getReference=(id:string)=>TEXTBOOK_CHUNKS.find(c=>c.id===id);
