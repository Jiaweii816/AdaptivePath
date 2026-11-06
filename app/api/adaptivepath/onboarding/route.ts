import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { resolveBiologyLearner } from "@/server/adaptivepath/learner";
import { loadOnboardingMetadata,saveOnboardingMetadata } from "@/server/adaptivepath/onboarding-store";
import { onboardingSubmissionSchema,summarizeOnboarding,SKIPPED_ONBOARDING } from "@/server/adaptivepath/onboarding-scoring";

export const runtime="nodejs";
const requestSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("submit"),submission:onboardingSubmissionSchema}).strict(),
  z.object({action:z.literal("skip")}).strict(),
]);

function failure(error:unknown){
  const payload=biologyErrorResponse(error);
  if(payload.status>=500)console.error("AdaptivePath onboarding failed",error);
  return NextResponse.json(payload.body,{status:payload.status});
}
export async function GET(){
  try{
    const scope=await resolveBiologyLearner(prisma);
    return NextResponse.json({onboarding:await loadOnboardingMetadata(prisma,scope)});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    const input=requestSchema.parse(await request.json());
    const scope=await resolveBiologyLearner(prisma);
    const metadata=input.action==="skip"?SKIPPED_ONBOARDING:summarizeOnboarding(input.submission);
    return NextResponse.json({onboarding:await saveOnboardingMetadata(prisma,scope,metadata)});
  }catch(error){return failure(error);}
}
