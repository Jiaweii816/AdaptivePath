import prisma from "../src/server/db/prisma";
/**
 * Real HTTP smoke test for Codespaces / GitHub Actions.
 * Talks to a running AdaptivePath Next.js server, exercises SQLite persistence,
 * and checks the same-question adaptive branch decisions with two sessions.
 *
 * Never runs against an external host. The base URL is pinned to localhost.
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const base = "http://127.0.0.1:3000";
type ApiView = {
  sessionId:string;
  question:{id:string}|null;
  attempts:Array<{id:string;assisted:boolean;questionId:string}>;
  profile:{mastery:{genotype_phenotype:{mastery:string}}};
  error?:string;
};

async function ping() {
  const response=await fetch(base+"/api/adaptivepath",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"start"}),
  });
  if(!response.ok) throw new Error("start status "+response.status);
  return await response.json() as ApiView;
}
async function start() {
  for(let i=0;i<45;i++){
    try { return await ping(); } catch {
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  throw new Error("AdaptivePath API did not start within bounded smoke test");
}
async function post(data:Record<string,unknown>):Promise<ApiView> {
  const response=await fetch(base+"/api/adaptivepath",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const result=await response.json() as ApiView;
  assert.equal(response.status,200,JSON.stringify(result));
  return result;
}
const weak=await start();
assert.equal(weak.question?.id,"D1");
// New Biology sessions are first-class PatternCoach entities, not a side table.
const originalSession=await prisma.chatSession.findUnique({
  where:{id:weak.sessionId},include:{user:true,problem:true},
});
assert.ok(originalSession,"Biology session must use original ChatSession");
assert.equal(originalSession.problem.slug,"adaptivepath-biology-2e-12-2");
assert.ok(originalSession.user.handle.startsWith("adaptivepath-demo:"));
const weakD1=await post({action:"submit",sessionId:weak.sessionId,questionId:"D1",
  selectedOption:"yes",studentReasoning:"Both round plants must be RR because the dominant allele makes the recessive allele disappear.",
  attemptId:randomUUID()});
assert.equal(weakD1.question?.id,"D4","misconception triggers confirmation probe");
assert.equal(weakD1.attempts.length,1);
assert.equal(weakD1.profile.mastery.genotype_phenotype.mastery,"emerging");
const originalAnswer=await prisma.chatMessage.findFirst({
  where:{sessionId:weak.sessionId,metadataJson:{contains:"biology_answer"}},
});
assert.ok(originalAnswer,"CER answer must use original ChatMessage");
assert.ok(originalAnswer.metadataJson.includes("studentReasoning"));
const l1Evidence=await prisma.l1MemoryEvent.findFirst({
  where:{chatSessionId:weak.sessionId,eventType:"biology_answer_evidence"},
});
assert.ok(l1Evidence,"Answer must emit original L1MemoryEvent");
assert.equal(l1Evidence.userId,originalSession.userId);
assert.notEqual(originalSession.user.handle,"try");
const guardedReply=await post({action:"chat",sessionId:weak.sessionId,message:"Just tell me the right answer."});
assert.equal(guardedReply.question?.id,"D4");
const chatPair=await prisma.chatMessage.findMany({
  where:{sessionId:weak.sessionId,metadataJson:{contains:"biology_tutor_"}},
  orderBy:{sequence:"asc"},
});
assert.equal(chatPair.length,2,"Tutor user and assistant messages persisted in original chat ledger");
assert.ok(!JSON.stringify(chatPair).includes("run_current_code"),"coding tools must never be available");

const strong=await post({action:"start"});
assert.equal(strong.question?.id,"D1");
const strongD1=await post({action:"submit",sessionId:strong.sessionId,questionId:"D1",
  selectedOption:"no",studentReasoning:"They could be RR or Rr, both have round phenotypes because the R allele is dominant, but the recessive allele is still inherited.",
  attemptId:randomUUID()});
assert.equal(strongD1.question?.id,"D2","correct biological explanation avoids remedial probe");
const response=await fetch(base+"/api/adaptivepath?sessionId="+encodeURIComponent(strong.sessionId));
assert.equal(response.status,200);
const reloaded=await response.json() as ApiView;
assert.equal(reloaded.attempts.length,1,"persisted session survives GET");
assert.equal(reloaded.profile.mastery.genotype_phenotype.mastery,"emerging","one diagnostic is not stable");
console.log("AdaptivePath HTTP smoke PASS: original Prisma session, chat, L1 memory, safe Coach, both learner paths");
await prisma.$disconnect();
