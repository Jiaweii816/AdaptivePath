import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { practiceRequestSchema } from "@/server/adaptivepath/request-schema";
import { loadBiologyView, recordReference, submitAnswer, tutorTurn, type BiologyDeps } from "@/server/adaptivepath/session";
import { isLiveBiologyTutorEnabled } from "@/server/agents/coach-agent/biology/llm-node";
import { createBiologyCoachClient } from "@/server/llm/anthropic-client";
import { getBiologyCoachModel } from "@/server/llm/models";

export const runtime = "nodejs";

function deps(): BiologyDeps {
  return { db: prisma, coach: isLiveBiologyTutorEnabled() ? { client: createBiologyCoachClient(), model: getBiologyCoachModel() } : null };
}

function fail(error: unknown) {
  const response = biologyErrorResponse(error);
  if (response.status >= 500) console.error("AdaptivePath request failed", error);
  return NextResponse.json(response.body, { status: response.status });
}

export async function GET() {
  try {
    return NextResponse.json(await loadBiologyView(deps()));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = practiceRequestSchema.parse(await request.json());
    if (input.action === "submit") return NextResponse.json(await submitAnswer(deps(), input));
    if (input.action === "reference") return NextResponse.json(await recordReference(deps(), input.questionId));
    return NextResponse.json(await tutorTurn(deps(), {
      focus: input.focus, message: input.message, draft: input.draft, promptIds: input.promptIds, referenceChunkId: input.referenceChunkId,
    }));
  } catch (error) {
    return fail(error);
  }
}
