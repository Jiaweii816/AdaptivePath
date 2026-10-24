import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import {
  endTraceSession,
  traceSessionEndInputSchema,
} from "@/server/observability/trace-session-end";
import { isTraceUiEnabled } from "@/server/observability/trace-ui-config";

export const runtime = "nodejs";

export const traceSessionEndRequestSchema = traceSessionEndInputSchema
  .omit({ userId: true })
  .strict();

export async function POST(request: Request) {
  if (!isTraceUiEnabled()) {
    return NextResponse.json({ ok: false, error: "Runtime trace UI is disabled." }, { status: 404 });
  }

  try {
    // Local MVP authorization boundary: user identity is resolved server-side.
    // A client-provided userId is rejected by the strict request schema.
    const body = traceSessionEndRequestSchema.parse(await request.json());
    const userId = await resolveLocalTraceUserId(prisma);
    return NextResponse.json(await endTraceSession(prisma, { userId, ...body }));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "Invalid trace session end request." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: "Unable to end runtime trace session." }, { status: 500 });
  }
}
