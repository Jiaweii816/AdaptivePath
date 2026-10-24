import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { resumeCampaignStrategistRun } from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(1_000),
  calendarAuthorization: z.discriminatedUnion("decision", [
    z.object({ decision: z.literal("allow"), rangeStart: z.string().datetime({ offset: true }), rangeEnd: z.string().datetime({ offset: true }) }).strict(),
    z.object({ decision: z.literal("deny") }).strict(),
  ]).optional(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const [{ runId }, userId, body] = await Promise.all([context.params, resolveLocalTraceUserId(prisma), request.json()]);
    const { answer, calendarAuthorization } = answerSchema.parse(body);
    const result = await resumeCampaignStrategistRun({ db: prisma, userId, runId, answer, calendarAuthorization, now: new Date() });
    const status = result.kind === "queued" ? 202
      : result.kind === "run_not_found" ? 404
      : result.kind === "pending_patch" || result.kind === "stale" ? 409
      : 400;
    const errorMessages: Record<string, string> = {
      stale: "The route or context changed. Start planning again; the system will not rebase automatically.",
      pending_patch: "A Patch is already awaiting review. Resolve the current proposal first.",
      not_awaiting_clarification: "This run is not awaiting clarification.",
      already_resumed: "This run was already resumed by another request.",
      calendar_authorization_not_requested: "The current Runtime did not request Calendar permission.",
      invalid_calendar_authorization_range: "The Calendar authorization range must exactly match the Runtime request and be no longer than 7 days.",
    };
    const resumedRun = "run" in result && result.run ? result.run : null;
    return NextResponse.json({
      ok: result.kind === "queued",
      ...(result.kind === "queued" ? {} : { code: result.kind, error: errorMessages[result.kind] ?? "This Strategist run could not be resumed." }),
      result: {
        kind: result.kind,
        runId: resumedRun?.id ?? runId,
        status: resumedRun?.status ?? null,
      },
    }, { status });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, code: "validation_failed", error: "Clarification answer is invalid." }, { status: 400 });
    }
    console.error("Campaign Strategist resume failed.", error);
    return NextResponse.json({ ok: false, code: "strategist_unavailable", error: "Strategist is temporarily unavailable." }, { status: 503 });
  }
}
