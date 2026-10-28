import { describe,it,expect } from "vitest";
import { BIOLOGY_QUESTIONS,TEXTBOOK_CHUNKS } from "../../src/features/adaptivepath/content";
import { BIOLOGY_TOPICS,chunkBiologySection } from "../../src/features/adaptivepath/textbook-chunks";
import { BIOLOGY_12_2_EXTRACTED } from "../../src/features/adaptivepath/data/biology-12-2-extracted";
import { deriveProfile,nextQuestionId,type AttemptEvidence } from "../../src/features/adaptivepath/profile";
import { selectBiologyCoachTool, BIOLOGY_COACH_TOOLS } from "../../src/features/adaptivepath/coach-policy";
const attempt=(id:string,successful:boolean,assisted=false,tags:string[]=[]):AttemptEvidence=>({
  id:id+"-"+String(assisted),questionId:id,studentReasoning:"independent explanation",selectedOption:"no",assisted,
  evaluation:{correctOption:successful,reasoningScore:successful?4:1,successful,misconceptionTags:tags,feedback:"",evaluator:"offline_rules"}
});
describe("AdaptivePath evidence rules",()=>{
  it("provides all four diagnostics and traceable references",()=>{
    expect(BIOLOGY_QUESTIONS.filter(q=>q.mode==="diagnostic").map(q=>q.id).slice(0,4)).toEqual(["D1","D2","D3","D4"]);
    expect(BIOLOGY_QUESTIONS).toHaveLength(33);
    expect(new Set(BIOLOGY_QUESTIONS.map(q=>q.id)).size).toBe(BIOLOGY_QUESTIONS.length);
    expect(new Set(BIOLOGY_QUESTIONS.map(q=>q.topic))).toEqual(new Set(BIOLOGY_TOPICS));
    expect(BIOLOGY_TOPICS.every(t=>BIOLOGY_QUESTIONS.filter(q=>q.topic===t&&q.mode==="transfer").length>=2)).toBe(true);
    expect(BIOLOGY_QUESTIONS.every(q=>q.referenceIds.every(id=>TEXTBOOK_CHUNKS.some(c=>c.id===id)))).toBe(true);
  });
  it("indexes all supplied Section 12.2 pages and subtopics into traceable chunks",()=>{
    expect(TEXTBOOK_CHUNKS.length).toBeGreaterThan(35);
    expect([...new Set(TEXTBOOK_CHUNKS.map(c=>c.page))]).toEqual([
      316,317,318,319,320,321,322,323,324,325,326,327,
    ]);
    expect(TEXTBOOK_CHUNKS.some(c=>c.subtitle==="Incomplete Dominance")).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.subtitle==="Codominance")).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.subtitle==="Multiple Alleles")).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.subtitle==="X-Linked Traits")).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.subtitle==="Lethality")).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.original.includes("Huntington"))).toBe(true);
    expect(TEXTBOOK_CHUNKS.some(c=>c.original.includes("FIGURE 12.14"))).toBe(true);
    expect(TEXTBOOK_CHUNKS.every(c=>c.page+20===c.pdfPage&&c.original.length>0)).toBe(true);
    expect(TEXTBOOK_CHUNKS.every(c=>c.section==="12.2")).toBe(true);
    expect(chunkBiologySection(BIOLOGY_12_2_EXTRACTED)).toEqual(TEXTBOOK_CHUNKS);
  });
  it("routes additional diagnostic evidence into targeted guided practice",()=>{
    const diagnostics=["D1","D2","D3","D4","D5","D6","D7","D8","D9"]
      .map(id=>attempt(id,id!=="D6"));
    expect(nextQuestionId(diagnostics)).toBe("G4");
    expect(nextQuestionId(diagnostics.map(a=>({...a,evaluation:{...a.evaluation,successful:true}})))).toBe("T1");
  });
  it("requires two distinct independent non-Mendelian transfer tasks for stable mastery",()=>{
    expect(deriveProfile([attempt("T4",true)]).mastery.incomplete_dominance.mastery).toBe("emerging");
    expect(deriveProfile([attempt("T4",true),attempt("T5",true)]).mastery.incomplete_dominance.mastery).toBe("stable");
    expect(deriveProfile([attempt("T4",true),attempt("T5",true,true)]).mastery.incomplete_dominance.mastery).toBe("emerging");
  });
  it("does not promote mastery after one transfer",()=>{
    expect(deriveProfile([attempt("T1",true)]).mastery.genotype_phenotype.mastery).toBe("emerging");
  });
  it("requires two distinct independent transfers",()=>{
    expect(deriveProfile([attempt("T1",true),attempt("T2",true)]).mastery.genotype_phenotype.mastery).toBe("stable");
    expect(deriveProfile([attempt("T1",true),attempt("T2",true,true)]).mastery.genotype_phenotype.mastery).toBe("emerging");
  });
  it("keeps a single misconception suspected and confirms repeated evidence",()=>{
    expect(deriveProfile([attempt("D1",false,false,["allele_disappears"])]).misconceptions.allele_disappears).toBe("suspected");
    expect(deriveProfile([attempt("D1",false,false,["allele_disappears"]),attempt("D4",false,false,["allele_disappears"])]).misconceptions.allele_disappears).toBe("confirmed");
  });
  it("never exposes coding tools to Biology Coach",()=>{
    expect(BIOLOGY_COACH_TOOLS).not.toContain("run_current_code");
    expect(BIOLOGY_COACH_TOOLS).not.toContain("verify_proposed_repair");
    expect(selectBiologyCoachTool({questionId:"D1",attempts:[]})).toBe("diagnostic_probe");
    expect(selectBiologyCoachTool({questionId:"T1",attempts:[attempt("D1",true)]})).toBe("independent_transfer");
    expect(selectBiologyCoachTool({questionId:"G1",attempts:[attempt("D1",false),attempt("D4",false)]})).toBe("prerequisite_review");
  });
  it("changes path based on response evidence, not learner name",()=>{
    expect(nextQuestionId([attempt("D1",false)])).toBe("D4");
    expect(nextQuestionId([attempt("D1",true)])).toBe("D2");
  });
});
