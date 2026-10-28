import "server-only";
import { randomUUID } from "node:crypto";
import prisma from "@/server/db/prisma";
import { getQuestion } from "@/features/adaptivepath/content";
import { deriveProfile, nextQuestionId, type AttemptEvidence } from "@/features/adaptivepath/profile";
import { evaluateBiologyWithProvider, liveBiologyTutorReply, isLiveBiologyTutorEnabled } from "./tutor-provider";

export type BiologySession = {
  id: string;
  attempts: AttemptEvidence[];
  messages: Array<{ role: "student" | "tutor"; content: string }>;
  hintsUsed: string[];
  referenceUsed: string[];
};
let setup: Promise<unknown> | undefined;
function ensureTable() {
  setup ??= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS adaptivepath_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).catch(e => { setup=undefined; throw e; });
  return setup;
}
export async function loadSession(id:string):Promise<BiologySession|null> {
  await ensureTable();
  const rows=await prisma.$queryRawUnsafe<Array<{payload:string}>>(
    "SELECT payload FROM adaptivepath_sessions WHERE id=? LIMIT 1",id);
  return rows.length ? JSON.parse(rows[0].payload) as BiologySession : null;
}
async function saveSession(session:BiologySession) {
  await ensureTable();
  await prisma.$executeRawUnsafe(
    "INSERT INTO adaptivepath_sessions(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
    session.id,JSON.stringify(session),new Date().toISOString());
}
export async function createSession() {
  const session:BiologySession={id:randomUUID(),attempts:[],messages:[],hintsUsed:[],referenceUsed:[]};
  await saveSession(session);
  return session;
}
export async function submitBiology(args:{
  sessionId:string;questionId:string;selectedOption:string;studentReasoning:string;attemptId:string;
}) {
  const session=await loadSession(args.sessionId);
  if(!session) throw new Error("Session not found");
  const expected=nextQuestionId(session.attempts);
  if(session.attempts.some(a=>a.id===args.attemptId)){
    return {session,profile:deriveProfile(session.attempts),nextQuestionId:nextQuestionId(session.attempts)};
  }
  if(expected!==args.questionId) throw new Error("This is not the current activity");
  const question=getQuestion(args.questionId);
  if(!question || !question.options.some(o=>o.id===args.selectedOption)) throw new Error("Invalid answer option");
  if(args.studentReasoning.trim().length<12) throw new Error("Please explain your reasoning (at least 12 characters).");
  const evaluation=await evaluateBiologyWithProvider(args.questionId,args.selectedOption,args.studentReasoning);
  const evidence:AttemptEvidence={id:args.attemptId,questionId:question.id,
    selectedOption:args.selectedOption,studentReasoning:args.studentReasoning.trim(),
    assisted:session.hintsUsed.includes(question.id) || (session.referenceUsed ?? []).includes(question.id),evaluation};
  session.attempts.push(evidence);
  await saveSession(session);
  return {session,profile:deriveProfile(session.attempts),nextQuestionId:nextQuestionId(session.attempts)};
}
export async function recordReferenceAccess(id:string,questionId:string) {
  const session=await loadSession(id);
  if(!session) throw new Error("Session not found");
  if(nextQuestionId(session.attempts)!==questionId) throw new Error("This is not the current activity");
  session.referenceUsed ??= [];
  if(!session.referenceUsed.includes(questionId)) session.referenceUsed.push(questionId);
  await saveSession(session);
  return session;
}
export async function recordTutorTurn(id:string,message:string) {
  const session=await loadSession(id);
  if(!session) throw new Error("Session not found");
  const current=nextQuestionId(session.attempts);
  const question=current?getQuestion(current):null;
  const profile=deriveProfile(session.attempts);
  let reply:string;
  if(question?.mode==="diagnostic" || question?.mode==="transfer"){
    reply="This is an independent assessment. I can clarify the instructions, but I cannot give you the genotype, the correct option, or a worked solution before you submit. Explain which alleles each parent may pass on.";
  } else {
    const liveReply=await liveBiologyTutorReply({message,questionId:current,attempts:session.attempts,history:session.messages}).catch(error=>{console.warn("AdaptivePath live tutor unavailable",error instanceof Error?error.message:"error");return null;});
    const q=message.toLowerCase();
    if(q.includes("example") || profile.support==="worked_example") {
      reply="Worked example (different alleles): In a simple Aa × aa cross, the Aa parent can contribute A or a, while the aa parent contributes a. Combine one allele from each gamete. Now apply this same method to the current problem.";
    } else {
      reply="Guided hint: Identify each parent's pair of alleles, then list the single allele each gamete can carry. Which genotypes can form at fertilization? Try explaining this in your own words.";
    }
    if(liveReply) reply=liveReply;
    if(current && !session.hintsUsed.includes(current)) session.hintsUsed.push(current);
  }
  session.messages.push({role:"student",content:message},{role:"tutor",content:reply});
  await saveSession(session);
  return {session,reply,provider: question?.mode === "guided_practice" && isLiveBiologyTutorEnabled() && !reply.startsWith("Guided hint:") && !reply.startsWith("Worked example") ? "live_llm" as const : "offline_rules" as const};
}
