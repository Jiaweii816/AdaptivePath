import { describe,expect,it,beforeEach,afterEach } from "vitest";
import { BIOLOGY_UNITS,ONBOARDING_QUESTIONS } from "@/features/adaptivepath/onboarding/catalog";
import { summarizeOnboarding,SKIPPED_ONBOARDING,type OnboardingSubmission } from "@/server/adaptivepath/onboarding-scoring";
import { saveOnboardingMetadata,loadOnboardingMetadata } from "@/server/adaptivepath/onboarding-store";
import { selectBiologyCoachTool } from "@/features/adaptivepath/onboarding/coach-policy";
import { deriveMemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { planTeachingTurn } from "@/features/adaptivepath/coach/teaching-policy";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { loadLearnerMemory,type LearnerScope } from "@/server/adaptivepath/memory-store";
import { createMemoryTestDb,type MemoryTestDb } from "./memory-test-helpers";

const answers={
  "ob-dna":"A","ob-homologs":"B","ob-gametes":"C","ob-dominance":"A","ob-cross":"B",
} as const;
const metadata=()=>summarizeOnboarding({
  studiedUnits:["cell","genetics"],geneticsFamiliarity:"some",
  supportPreference:"socratic",responses:answers,
});
let db:MemoryTestDb;
let scope:LearnerScope;
beforeEach(async ()=>{
  db=await createMemoryTestDb();
  const user=await db.prisma.user.create({data:{handle:"onboarding-try"}});
  const problem=await db.prisma.problem.create({data:{
    slug:"adaptivepath-biology-2e-12-2",title:"Biology",
    statementMarkdown:"x",tags:"[]",methodName:"biology_reasoning",
  }});
  const session=await db.prisma.chatSession.create({data:{
    userId:user.id,problemId:problem.id,title:"Biology",memoryOrigin:"test",
  }});
  scope={userId:user.id,problemId:problem.id,chatSessionId:session.id,memoryOrigin:"test"};
});
afterEach(async()=>{await db.cleanup()});

describe("whole-book-aware onboarding diagnostics",()=>{
  it("covers eight full-book units, five prerequisite checks, and uses existing concept IDs",()=>{
    expect(BIOLOGY_UNITS).toHaveLength(8);
    expect(ONBOARDING_QUESTIONS).toHaveLength(5);
    expect(ONBOARDING_QUESTIONS.map(q=>q.source)).toEqual([
      "3.5 Nucleic Acids","4.3 Eukaryotic Cells / 11.1 The Process of Meiosis",
      "11.1 The Process of Meiosis","12.2 Characteristics and Traits","12.2 Characteristics and Traits",
    ]);
    expect(ONBOARDING_QUESTIONS.every(q=>CONCEPTS.some(c=>c.id===q.conceptId))).toBe(true);
  });
  it("creates conservative confidence signals and never mislabels other topics",()=>{
    const result=metadata();
    expect(result.diagnosticCorrect).toBe(3);
    expect(result.conceptSignals.map(x=>x.conceptId)).toEqual(CONCEPTS.slice(0,3).map(x=>x.id));
    expect(result.conceptSignals.map(x=>x.status)).toEqual(["promising","needs_review","needs_review"]);
    expect(result.conceptSignals.every(x=>x.confidence==="low")).toBe(true);
    expect(result.firstFocusConceptId).toBe(CONCEPTS[1].id);
    const serialized=JSON.stringify(result);
    expect(serialized).not.toContain("ob-dna");
    expect(serialized).not.toContain("selectedOption");
    expect(serialized).not.toContain("reasoning");
  });
  it("rejects missing, extra and arbitrary untrusted fields",()=>{
    const input:OnboardingSubmission={studiedUnits:["genetics"],geneticsFamiliarity:"some",supportPreference:"socratic",responses:answers};
    expect(()=>summarizeOnboarding({...input,responses:{"ob-dna":"A"}})).toThrow("All five");
    expect(()=>summarizeOnboarding({...input,fullName:"A Student"} as never)).toThrow();
    expect(()=>summarizeOnboarding({...input,responses:{...answers,extra:"A"}})).toThrow("All five");
  });
});
describe("L1/L2/L3 integration without fabricated mastery",()=>{
  it("persists only scoped metadata, creates L3 baseline immediately, and keeps all L2 unknown",async()=>{
    const input=metadata();
    await saveOnboardingMetadata(db.prisma,scope,input);
    expect(await loadOnboardingMetadata(db.prisma,scope)).toEqual(input);
    const original=await db.prisma.l1MemoryEvent.findMany({where:{userId:scope.userId}});
    expect(original).toHaveLength(1);
    expect(original[0].content).toBeNull();
    expect(original[0].eventType).toBe("biology_onboarding_metadata_v1");
    const stored=JSON.stringify(original[0]);
    expect(stored).not.toContain("ob-dna");
    expect(stored).not.toContain("My name");
    const memory=await loadLearnerMemory(db.prisma,scope);
    expect(memory.attempts).toHaveLength(0);
    expect(memory.states.size).toBe(0);
    expect(memory.latestProfile?.version).toBe(1);
    expect(memory.latestProfile?.card.levelDistribution.unassessed).toBe(10);
    expect(memory.latestProfile?.card.strengths).toEqual([]);
  });
  it("never cross-reads another learner or memoryOrigin",async()=>{
    await saveOnboardingMetadata(db.prisma,scope,metadata());
    const other=await db.prisma.user.create({data:{handle:"onboarding-other"}});
    expect(await loadOnboardingMetadata(db.prisma,{userId:other.id,memoryOrigin:"test"})).toBeNull();
    expect(await loadOnboardingMetadata(db.prisma,{userId:scope.userId,memoryOrigin:"evaluation"})).toBeNull();
  });
  it("skipping stores no evidence and leaves the profile unassessed",async()=>{
    await saveOnboardingMetadata(db.prisma,scope,SKIPPED_ONBOARDING);
    expect((await loadOnboardingMetadata(db.prisma,scope))?.status).toBe("skipped");
    expect((await loadLearnerMemory(db.prisma,scope)).states.size).toBe(0);
  });
  it("turns initial metadata into a local teaching instruction, with L2 overriding it",()=>{
    const input=metadata();
    const focused=["b2e-12-2-concept-02"];
    expect(selectBiologyCoachTool([null],focused,input)).toBe("guided_hint");
    expect(selectBiologyCoachTool([3],focused,input)).toBe("socratic_probe");
    expect(selectBiologyCoachTool([null],focused,null)).toBe("worked_example");
    const q=getBankQuestion("b2e-12-2-q-c02-easy-01");
    const signals=deriveMemorySignals({
      question:q,states:new Map(),card:null,attempts:[],
      concepts:CONCEPTS,lookupQuestion:getBankQuestion,onboarding:input,
    });
    expect(signals.initialCoachTool).toBe("guided_hint");
    const plan=planTeachingTurn({
      turn:{intents:[{kind:"question_hint"}],affect:"none",textbookQuery:"alleles"},
      phase:"current_question",signals,draftState:"empty",
      priorHintTurns:0,firstTurnOnQuestion:true,
    });
    expect(plan.styleKeys).toContain("depth_hint_ladder");
    const missingPrereq=summarizeOnboarding({
      studiedUnits:["genetics"],geneticsFamiliarity:"some",supportPreference:"socratic",
      responses:{...answers,"ob-gametes":"A"},
    });
    const cautious=deriveMemorySignals({
      question:q,states:new Map(),card:null,attempts:[],
      concepts:CONCEPTS,lookupQuestion:getBankQuestion,onboarding:missingPrereq,
    });
    expect(cautious.prerequisiteGap).toBe("b2e-12-2-concept-01");
    expect(cautious.initialCoachTool).toBe("guided_hint");
    expect(JSON.stringify(signals)).not.toContain("studiedUnits");
    expect(JSON.stringify(plan)).not.toContain("geneticsFamiliarity");
  });
});
