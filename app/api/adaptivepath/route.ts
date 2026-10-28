import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, loadSession, recordTutorTurn, recordReferenceAccess, submitBiology } from "@/server/adaptivepath/session";
import { deriveProfile, nextQuestionId } from "@/features/adaptivepath/profile";
import { BIOLOGY_QUESTIONS, getQuestion } from "@/features/adaptivepath/content";
export const runtime="nodejs";
const bodySchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("start")}),
  z.object({action:z.literal("submit"),sessionId:z.string().uuid(),questionId:z.string(),
    selectedOption:z.string(),studentReasoning:z.string().min(12).max(4000),attemptId:z.string().uuid()}),
  z.object({action:z.literal("reference"),sessionId:z.string().uuid(),questionId:z.string()}),\n  z.object({action:z.literal("chat"),sessionId:z.string().uuid(),message:z.string().trim().min(1).max(2000)}),
]);
function view(session:NonNullable<Awaited<ReturnType<typeof loadSession>>>) {
  const nextId=nextQuestionId(session.attempts);
  return { sessionId:session.id, attempts:session.attempts, messages:session.messages,
    profile:deriveProfile(session.attempts), question:nextId?getQuestion(nextId):null,
    completed:nextId===null, questionCount:BIOLOGY_QUESTIONS.length };
}
export async function GET(request:Request) {
  try {
    const id=new URL(request.url).searchParams.get("sessionId");
    if(!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({error:"Invalid session ID"},{status:400});
    const session=await loadSession(id);
    return session?NextResponse.json(view(session)):NextResponse.json({error:"Session not found"},{status:404});
  } catch {
    return NextResponse.json({error:"Unable to load session"},{status:500});
  }
}
export async function POST(request:Request) {
  try {
    const input=bodySchema.parse(await request.json());
    if(input.action==="start") return NextResponse.json(view(await createSession()));
    if(input.action==="submit"){
      const result=await submitBiology(input);
      return NextResponse.json({...view(result.session),feedback:result.session.attempts.at(-1)?.evaluation});
    }
    if(input.action==="reference") return NextResponse.json(view(await recordReferenceAccess(input.sessionId,input.questionId)));\n    const result=await recordTutorTurn(input.sessionId,input.message);
    return NextResponse.json({...view(result.session),reply:result.reply,provider:result.provider});
  } catch(error) {
    if(error instanceof z.ZodError) return NextResponse.json({error:"Invalid request",details:error.flatten()},{status:400});
    if(error instanceof Error && /not found/.test(error.message)) return NextResponse.json({error:error.message},{status:404});
    if(error instanceof Error && /current activity|Invalid answer|explain your reasoning/.test(error.message)) return NextResponse.json({error:error.message},{status:400});
    console.error("AdaptivePath request failed",error);
    return NextResponse.json({error:"Unable to complete request"},{status:500});
  }
}
