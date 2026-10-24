import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import { exportRuntimeTraceSession } from "@/server/observability/runtime-trace-export";
import { isTraceUiEnabled } from "@/server/observability/trace-ui-config";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isTraceUiEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Runtime trace UI is disabled." },
      { status: 404 },
    );
  }

  try {
    const url = new URL(request.url);
    if (url.searchParams.has("userId")) {
      return NextResponse.json(
        { ok: false, error: "userId is server-owned." },
        { status: 400 },
      );
    }
    const [{ id }, userId] = await Promise.all([
      context.params,
      resolveLocalTraceUserId(prisma),
    ]);
    if (!id.trim()) {
      return NextResponse.json(
        { ok: false, error: "Invalid trace session id." },
        { status: 400 },
      );
    }

    const traceExport = await exportRuntimeTraceSession(prisma, {
      userId,
      sessionId: id,
    });
    if (!traceExport) {
      return NextResponse.json(
        { ok: false, error: "Trace session not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(traceExport, {
      headers: {
        "content-disposition": `attachment; filename="runtime-trace-${safeFileName(id)}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to export runtime trace." },
      { status: 500 },
    );
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}
