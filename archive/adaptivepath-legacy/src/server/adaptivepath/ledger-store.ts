import "server-only";
import { randomUUID } from "node:crypto";
import prisma from "@/server/db/prisma";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { getQuestion } from "@/features/adaptivepath/content";
import { type AttemptEvidence } from "@/features/adaptivepath/profile";

/**
 * Biology's adapter to PatternCoach's ORIGINAL durable ledger:
 * User -> Problem -> ChatSession -> ChatMessage / L1MemoryEvent.
 * This creates no parallel session table for new learners.
 *
 * The existing session ID is a UUID for API compatibility, while its row is
 * now a real ChatSession. A unique demo user per learning session prevents
 * the original ChatSession(userId,problemId,memoryOrigin) unique constraint
 * from merging multiple learners into one session.
 *
 * IMPORTANT: opaque session IDs are not authentication. Never make this
 * preview public or use identifiable student data.
 */
export type BiologySession = {
  id: string;
  attempts: AttemptEvidence[];
  messages: Array<{ role: "student" | "tutor"; content: string }>;
  hintsUsed: string[];
  referenceUsed: string[];
};

const BIOLOGY_PROBLEM_SLUG = "adaptivepath-biology-2e-12-2";
const BIOLOGY_DOMAIN = "adaptivepath:biology:12.2";

function decodeMetadata(text:string): Record<string,unknown> {
  try {
    const parsed:unknown=JSON.parse(text);
    return parsed && typeof parsed==="object" && !Array.isArray(parsed)
      ? parsed as Record<string,unknown> : {};
  } catch {return {};}
}
function isAttemptEvidence(value:unknown):value is AttemptEvidence {
  if(!value || typeof value!=="object") return false;
  const a=value as Partial<AttemptEvidence>;
  return typeof a.id==="string" && typeof a.questionId==="string" &&
    typeof a.selectedOption==="string" && typeof a.studentReasoning==="string" &&
    typeof a.assisted==="boolean" && Boolean(a.evaluation) &&
    typeof a.evaluation?.reasoningScore==="number";
}

export async function createBiologyLedgerSession():Promise<BiologySession> {
  const uuid=randomUUID();
  const origin=resolveMemoryOrigin();
  await prisma.$transaction(async tx=>{
    const user=await tx.user.create({data:{handle:"adaptivepath-demo:"+uuid}});
    const problem=await tx.problem.upsert({
      where:{slug:BIOLOGY_PROBLEM_SLUG},
      update:{},
      create:{
        slug:BIOLOGY_PROBLEM_SLUG,
        title:"OpenStax Biology 2e — 12.2 Characteristics and Traits",
        statementMarkdown:"Biology diagnostic, assisted practice and independent transfer tasks.",
        tags:JSON.stringify(["biology","mendelian_genetics","section_12_2"]),
        methodName:"biology_reasoning",
        isDemoSupported:false,
        localRunStatus:"unsupported",
      },
    });
    await tx.chatSession.create({
      data:{id:uuid,userId:user.id,problemId:problem.id,
        title:"AdaptivePath Biology §12.2",isActive:true,memoryOrigin:origin},
    });
  });
  return {id:uuid,attempts:[],messages:[],hintsUsed:[],referenceUsed:[]};
}
async function owner(sessionId:string) {
  return prisma.chatSession.findFirst({
    where:{id:sessionId,problem:{slug:BIOLOGY_PROBLEM_SLUG},memoryOrigin:resolveMemoryOrigin()},
    select:{id:true,userId:true,problemId:true,memoryOrigin:true},
  });
}

export async function loadBiologyLedgerSession(sessionId:string):Promise<BiologySession|null> {
  const session=await owner(sessionId);
  if(!session) return null;
  const [chatMessages,events]=await Promise.all([
    prisma.chatMessage.findMany({where:{sessionId:session.id},orderBy:{sequence:"asc"}}),
    prisma.l1MemoryEvent.findMany({
      where:{chatSessionId:session.id,userId:session.userId,memoryOrigin:session.memoryOrigin,
        eventType:{in:["biology_reference_access","biology_guided_assistance"]}},
      orderBy:{occurredAt:"asc"},
    }),
  ]);
  const result:BiologySession={id:session.id,attempts:[],messages:[],hintsUsed:[],referenceUsed:[]};
  for(const message of chatMessages){
    const meta=decodeMetadata(message.metadataJson);
    if(meta.domain!==BIOLOGY_DOMAIN) continue;
    if(meta.type==="biology_answer" && isAttemptEvidence(meta.evidence)){
      result.attempts.push(meta.evidence);
    }
    if(meta.type==="biology_tutor_user" || meta.type==="biology_tutor_assistant"){
      result.messages.push({
        role:meta.type==="biology_tutor_user"?"student":"tutor",
        content:message.contentMarkdown,
      });
    }
  }
  for(const event of events){
    const meta=decodeMetadata(event.eventJson);
    if(meta.domain!==BIOLOGY_DOMAIN || typeof meta.questionId!=="string")continue;
    if(event.eventType==="biology_reference_access"&&!result.referenceUsed.includes(meta.questionId))
      result.referenceUsed.push(meta.questionId);
    if(event.eventType==="biology_guided_assistance"&&!result.hintsUsed.includes(meta.questionId))
      result.hintsUsed.push(meta.questionId);
  }
  return result;
}

/** All writes are verified against the live ChatSession and serialized by
 * SQLite's transaction boundary. We validate again at write time to avoid
 * advancing a question while a model is still evaluating a stale response.
 */
export async function persistBiologyAnswer(sessionId:string,evidence:AttemptEvidence,
  nextQuestionId:(evidence:AttemptEvidence[])=>string|null) {
  return prisma.$transaction(async tx=>{
    const parent=await tx.chatSession.findFirst({
      where:{id:sessionId,problem:{slug:BIOLOGY_PROBLEM_SLUG},memoryOrigin:resolveMemoryOrigin()},
      select:{id:true,userId:true,problemId:true,memoryOrigin:true},
    });
    if(!parent)throw new Error("Session not found");
    const records=await tx.chatMessage.findMany({
      where:{sessionId:parent.id},orderBy:{sequence:"asc"},
      select:{sequence:true,metadataJson:true},
    });
    const existing=records.map(m=>decodeMetadata(m.metadataJson))
      .filter(m=>m.domain===BIOLOGY_DOMAIN && m.type==="biology_answer" && isAttemptEvidence(m.evidence))
      .map(m=>m.evidence as AttemptEvidence);
    if(existing.some(a=>a.id===evidence.id))return;
    if(nextQuestionId(existing)!==evidence.questionId)throw new Error("This is not the current activity");
    const sequence=(records.at(-1)?.sequence??0)+1;
    await tx.chatMessage.create({
      data:{sessionId:parent.id,sequence,role:"user",contentMarkdown:evidence.studentReasoning,
        memoryOrigin:parent.memoryOrigin,
        metadataJson:JSON.stringify({domain:BIOLOGY_DOMAIN,type:"biology_answer",evidence})},
    });
    await tx.l1MemoryEvent.create({
      data:{userId:parent.userId,problemId:parent.problemId,chatSessionId:parent.id,
        memoryOrigin:parent.memoryOrigin,eventType:"biology_answer_evidence",
        source:"adaptivepath_biology",content:evidence.studentReasoning,
        eventJson:JSON.stringify({domain:BIOLOGY_DOMAIN,questionId:evidence.questionId,
          selectedOption:evidence.selectedOption,assisted:evidence.assisted,
          evaluator:evidence.evaluation.evaluator,reasoningScore:evidence.evaluation.reasoningScore,
          misconceptionTags:evidence.evaluation.misconceptionTags,attemptId:evidence.id})},
    });
    await tx.chatSession.update({where:{id:parent.id},data:{isActive:true}});
  });
}

export async function persistBiologyAccess(sessionId:string,questionId:string,
  category:"biology_reference_access"|"biology_guided_assistance") {
  await prisma.$transaction(async tx=>{
    const parent=await tx.chatSession.findFirst({
      where:{id:sessionId,problem:{slug:BIOLOGY_PROBLEM_SLUG},memoryOrigin:resolveMemoryOrigin()},
      select:{id:true,userId:true,problemId:true,memoryOrigin:true},
    });
    if(!parent)throw new Error("Session not found");
    const prior=await tx.l1MemoryEvent.findMany({
      where:{chatSessionId:parent.id,userId:parent.userId,eventType:category},
      select:{eventJson:true},
    });
    if(prior.some(x=>{const m=decodeMetadata(x.eventJson);return m.domain===BIOLOGY_DOMAIN&&m.questionId===questionId;}))return;
    await tx.l1MemoryEvent.create({
      data:{userId:parent.userId,problemId:parent.problemId,chatSessionId:parent.id,
        memoryOrigin:parent.memoryOrigin,eventType:category,source:"adaptivepath_biology",
        eventJson:JSON.stringify({domain:BIOLOGY_DOMAIN,questionId})},
    });
  });
}

export async function persistBiologyChat(sessionId:string,userText:string,reply:string,tool:string) {
  await prisma.$transaction(async tx=>{
    const parent=await tx.chatSession.findFirst({
      where:{id:sessionId,problem:{slug:BIOLOGY_PROBLEM_SLUG},memoryOrigin:resolveMemoryOrigin()},
      select:{id:true,userId:true,problemId:true,memoryOrigin:true},
    });
    if(!parent)throw new Error("Session not found");
    const latest=await tx.chatMessage.findFirst({where:{sessionId:parent.id},
      orderBy:{sequence:"desc"},select:{sequence:true}});
    const n=(latest?.sequence??0)+1;
    await tx.chatMessage.create({
      data:{sessionId:parent.id,sequence:n,role:"user",contentMarkdown:userText,
        memoryOrigin:parent.memoryOrigin,metadataJson:JSON.stringify({
          domain:BIOLOGY_DOMAIN,type:"biology_tutor_user"})},
    });
    await tx.chatMessage.create({
      data:{sessionId:parent.id,sequence:n+1,role:"assistant",contentMarkdown:reply,
        memoryOrigin:parent.memoryOrigin,metadataJson:JSON.stringify({
          domain:BIOLOGY_DOMAIN,type:"biology_tutor_assistant",tool})},
    });
    await tx.l1MemoryEvent.create({
      data:{userId:parent.userId,problemId:parent.problemId,chatSessionId:parent.id,
        memoryOrigin:parent.memoryOrigin,eventType:"biology_coach_turn",source:"biology_coach_agent",
        content:reply.slice(0,1200),
        eventJson:JSON.stringify({domain:BIOLOGY_DOMAIN,selectedTool:tool})},
    });
  });
}
