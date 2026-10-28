import { describe,it,expect } from "vitest";
import { BIOLOGY_QUESTIONS,TEXTBOOK_CHUNKS } from "../../src/features/adaptivepath/content";
import { deriveProfile,nextQuestionId,type AttemptEvidence } from "../../src/features/adaptivepath/profile";
import { selectBiologyCoachTool, BIOLOGY_COACH_TOOLS } from "../../src/server/agents/coach-agent/biology-chat-reply";
const attempt=(id:string,successful:boolean,assisted=false,tags:string[]=[]):AttemptEvidence=>({
  id:id+"-"+String(assisted),questionId:id,studentReasoning:"independent explanation",selectedOption:"no",assisted,
  evaluation:{correctOption:successful,reasoningScore:successful?4:1,successful,misconceptionTags:tags,feedback:"",evaluator:"offline_rules"}
});
describe("AdaptivePath evidence rules",()=>{
  it("provides all four diagnostics and traceable references",()=>{
    expect(BIOLOGY_QUESTIONS.filter(q=>q.mode==="diagnostic").map(q=>q.id)).toEqual(["D1","D2","D3","D4"]);
    expect(BIOLOGY_QUESTIONS.every(q=>q.referenceIds.every(id=>TEXTBOOK_CHUNKS.some(c=>c.id===id)))).toBe(true);
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
  it("never exposes coding tools to Biology Coach",()=>{\n    expect(BIOLOGY_COACH_TOOLS).not.toContain("run_current_code");\n    expect(BIOLOGY_COACH_TOOLS).not.toContain("verify_proposed_repair");\n    expect(selectBiologyCoachTool({questionId:"D1",attempts:[]})).toBe("diagnostic_probe");\n    expect(selectBiologyCoachTool({questionId:"T1",attempts:[attempt("D1",true)]})).toBe("independent_transfer");\n    expect(selectBiologyCoachTool({questionId:"G1",attempts:[attempt("D1",false),attempt("D4",false)]})).toBe("prerequisite_review");\n  });\n  it("changes path based on response evidence, not learner name",()=>{
    expect(nextQuestionId([attempt("D1",false)])).toBe("D4");
    expect(nextQuestionId([attempt("D1",true)])).toBe("D2");
  });
});
