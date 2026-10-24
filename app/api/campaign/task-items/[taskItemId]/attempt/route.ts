import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import { CampaignBindingError } from "@/server/campaign/services/task-evidence-binding";
import {
  CampaignExperienceError,
  startOrResumeCampaignWorkbenchEntry,
} from "@/server/campaign/services/campaign-experience-service";

export const runtime = "nodejs";

const browserInstanceSchema = z.string().trim().min(8).max(200);

export async function POST(
  request: Request,
  context: { params: Promise<{ taskItemId: string }> },
) {
  try {
    const [{ taskItemId }, userId] = await Promise.all([
      context.params,
      resolveLocalTraceUserId(prisma),
    ]);
    const browserInstanceId = browserInstanceSchema.parse(
      request.headers.get("x-patterncoach-browser-instance-id"),
    );
    const result = await startOrResumeCampaignWorkbenchEntry(prisma, {
      userId,
      taskItemId,
      browserInstanceId,
      now: new Date(),
    });
    return NextResponse.json({
      ok: true,
      status: result.status,
      attemptId: result.attemptId,
      workspaceSessionId: result.workspaceSessionId,
      workbenchUrl: result.workbenchUrl,
      context: result.context,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: "Invalid Campaign attempt request.", issues: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof CampaignBindingError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof CampaignExperienceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to start Campaign task attempt." },
      { status: 500 },
    );
  }
}
