import "server-only";
import prisma from "@/server/db/prisma";
import { getQuestion } from "@/features/adaptivepath/content";
import { deriveProfile, nextQuestionId, type AttemptEvidence } from "@/features/adaptivepath/profile";
import { evaluateBiologyWithProvider } from "./tutor-provider";
import {
  createBiologyLedgerSession,loadBiologyLedgerSession,
  persistBiologyAccess,persistBiologyAnswer,persistBiologyChat,
  type BiologySession,
} from "./ledger-store";
import { biologyCoachReply } from "@/server/agents/coach-agent/biology-chat-reply";

export type { BiologySession };

/**
 * Existing pre-integration sessions remain readable/writable as a compatibility
 * path. NEW sessions use the original PatternCoach Prisma ChatSession and
 * Memory ledger and do not create a parallel session table.
 * Delete this adapter after an explicit reviewed data migration.
 */
async function readOldSession(id:string):Promise<BiologySession|null> {
  try {
    const rows=await prisma.$queryRawUnsafe<Array<{payload:string}>>(
      "SELECT payload FROM adaptivepath_sessions WHERE id=? LIMIT 1",id);
    if(!rows.length)return null;
    const parsed=JSON.parse(rows[0].payload) as BiologySession;
    return parsed?.id===id && Array.isArray(parsed.attempts) &&
      Array.isArray(parsed.messages)?{
      ...parsed,hintsUsed:parsed.hintsUsed??[],referenceUsed:parsed.referenceUsed??[],
    }:null;
  } catch {return null;} // Table may not exist in a fresh database.
}
async function saveOldSession(session:BiologySession) {
  await prisma.$executeRawUnsafe(
    "UPDATE adaptivepath_sessions SET payload=?,updated_at=? WHERE id=?",
    JSON.stringify(session),new Date().toISOString(),session.id);
}
async function readSessionWithSource(id:string) {
  const ledger=await loadBiologyLedgerSession(id);
  if(ledger)return {session:ledger,legacy:false as const};
  const legacy=await readOldSession(id);
  if(legacy)return {session:legacy,legacy:true as const};
  return null;
}

export async function loadSession(id:string):Promise<BiologySession|null> {
  return (await readSessionWithSource(id))?.session??null;
}
export async function createSession():Promise<BiologySession> {
  return createBiologyLedgerSession();
}
export async function submitBiology(args:{
  sessionId:string;questionId:string;selectedOption:string;studentReasoning:string;attemptId:string;
}) {
  const found=await readSessionWithSource(args.sessionId);
  if(!found)throw new Error("Session not found");
  const session=found.session;
  if(session.attempts.some(a=>a.id===args.attemptId))
    return {session,profile:deriveProfile(session.attempts),nextQuestionId:nextQuestionId(session.attempts)};
  if(nextQuestionId(session.attempts)!==args.questionId)throw new Error("This is not the current activity");
  const question=getQuestion(args.questionId);
  if(!question || !question.options.some(o=>o.id===args.selectedOption))
    throw new Error("Invalid answer option");
  if(args.studentReasoning.trim().length<12)
    throw new Error("Please explain your reasoning (at least 12 characters).");
  const evaluation=await evaluateBiologyWithProvider(args.questionId,args.selectedOption,args.studentReasoning);
  const evidence:AttemptEvidence={
    id:args.attemptId,questionId:question.id,submittedAt:new Date().toISOString(),
    selectedOption:args.selectedOption,studentReasoning:args.studentReasoning.trim(),
    assisted:session.hintsUsed.includes(question.id) || session.referenceUsed.includes(question.id),
    evaluation,
  };
  if(found.legacy){
    session.attempts.push(evidence);
    await saveOldSession(session);
  } else {
    await persistBiologyAnswer(session.id,evidence,nextQuestionId);
  }
  const saved=(await loadSession(session.id))!;
  return {session:saved,profile:deriveProfile(saved.attempts),nextQuestionId:nextQuestionId(saved.attempts)};
}
export async function recordReferenceAccess(id:string,questionId:string) {
  const found=await readSessionWithSource(id);
  if(!found)throw new Error("Session not found");
  if(nextQuestionId(found.session.attempts)!==questionId)
    throw new Error("This is not the current activity");
  if(!found.session.referenceUsed.includes(questionId)){
    if(found.legacy){
      found.session.referenceUsed.push(questionId);
      await saveOldSession(found.session);
    } else {
      await persistBiologyAccess(id,questionId,"biology_reference_access");
    }
  }
  return (await loadSession(id))!;
}
export async function recordTutorTurn(id:string,message:string) {
  const found=await readSessionWithSource(id);
  if(!found)throw new Error("Session not found");
  const {session}=found;
  const current=nextQuestionId(session.attempts);
  const turn=await biologyCoachReply({message,questionId:current,attempts:session.attempts,history:session.messages});
  if(found.legacy){
    session.messages.push({role:"student",content:message},{role:"tutor",content:turn.reply});
    if(current && turn.tool!=="diagnostic_probe" && turn.tool!=="independent_transfer" &&
      !session.hintsUsed.includes(current))session.hintsUsed.push(current);
    await saveOldSession(session);
  } else {
    await persistBiologyChat(id,message,turn.reply,turn.tool);
    if(current && turn.tool!=="diagnostic_probe" && turn.tool!=="independent_transfer")
      await persistBiologyAccess(id,current,"biology_guided_assistance");
  }
  return {session:(await loadSession(id))!,reply:turn.reply,provider:turn.provider,tool:turn.tool};
}
