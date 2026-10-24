import { NextResponse } from "next/server";
import { z } from "zod";
import { startMockInterview } from "@/server/mock-interview/start-mock-interview";
import { MockInterviewError } from "@/server/mock-interview/mock-interview-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await startMockInterview(await request.json()));
  } catch (error) {
    return handleMockInterviewError(error, "Unable to start mock interview.");
  }
}

function handleMockInterviewError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { ok: false, error: "Invalid mock interview request.", issues: error.flatten() },
      { status: 400 },
    );
  }

  if (error instanceof MockInterviewError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status },
    );
  }

  console.error(error);
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 500 },
  );
}
