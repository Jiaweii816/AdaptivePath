import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { loadBiologyView, recordReference, submitAnswer, tutorTurn, type BiologyDeps } from "@/server/adaptivepath/session";
import { createLiveBiologyTutor, isLiveBiologyTutorEnabled } from "@/server/adaptivepath/tutor-provider";

export const runtime = "nodejs";

const MAX_EXPLANATION_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 2_000;
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"), questionId: z.string().min(1), selectedOption: z.string().min(1),
    explanation: z.string().max(MAX_EXPLANATION_CHARS), attemptId: z.string().uuid(),
  }),
  z.object({ action: z.literal("reference"), questionId: z.string().min(1) }),
  z.object({ action: z.literal("chat"), message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }),
]);

function deps(): BiologyDeps {
  return { db: prisma, live: isLiveBiologyTutorEnabled() ? createLiveBiologyTutor() : null };
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
    const input = bodySchema.parse(await request.json());
    if (input.action === "submit") return NextResponse.json(await submitAnswer(deps(), input));
    if (input.action === "reference") return NextResponse.json(await recordReference(deps(), input.questionId));
    return NextResponse.json(await tutorTurn(deps(), input.message));
  } catch (error) {
    return fail(error);
  }
}
