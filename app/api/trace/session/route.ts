import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import {
  getCurrentTraceSessionPage,
  getTraceSessionDetailPage,
  listTraceSessionHistory,
} from "@/server/observability/trace-query";
import { isTraceUiEnabled } from "@/server/observability/trace-ui-config";

export const runtime = "nodejs";

const querySchema = z.object({
  view: z.enum(["current", "history", "detail"]).default("current"),
  browserInstanceId: z.string().min(1).optional(),
  problemId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  if (!isTraceUiEnabled()) return traceRouteDisabled();

  try {
    const url = new URL(request.url);
    if (url.searchParams.has("userId")) {
      return NextResponse.json({ ok: false, error: "userId is server-owned." }, { status: 400 });
    }
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const userId = await resolveLocalTraceUserId(prisma);

    if (query.view === "history") {
      return NextResponse.json(await listTraceSessionHistory(prisma, {
        userId,
        limit: query.limit ?? 50,
        cursor: query.cursor,
      }));
    }
    if (query.view === "detail") {
      if (!query.sessionId) throw new TraceQueryRequestError("sessionId is required for detail view.");
      const page = await getTraceSessionDetailPage(prisma, {
        userId,
        sessionId: query.sessionId,
        since: query.since,
        limit: query.limit ?? 200,
      });
      return page
        ? NextResponse.json(page)
        : NextResponse.json({ ok: false, error: "Trace session not found." }, { status: 404 });
    }

    if (!query.browserInstanceId || !query.problemId) {
      throw new TraceQueryRequestError("browserInstanceId and problemId are required for current view.");
    }
    return NextResponse.json(await getCurrentTraceSessionPage(prisma, {
      userId,
      browserInstanceId: query.browserInstanceId,
      problemId: query.problemId,
      since: query.since,
      limit: query.limit ?? 200,
    }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof TraceQueryRequestError) {
      return NextResponse.json({ ok: false, error: "Invalid trace query." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: "Unable to read runtime trace." }, { status: 500 });
  }
}

class TraceQueryRequestError extends Error {}

function traceRouteDisabled() {
  return NextResponse.json({ ok: false, error: "Runtime trace UI is disabled." }, { status: 404 });
}
