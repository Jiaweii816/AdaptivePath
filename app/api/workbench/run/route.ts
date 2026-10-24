import { NextResponse } from "next/server";
import { z } from "zod";
import { runPracticeTests } from "@/server/workbench/practice-run";
import { ReviewPipelineError } from "@/server/agents/coach-agent/review-pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runPracticeTests(body);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid run request.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof ReviewPipelineError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
        },
        { status: error.status },
      );
    }

    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete the run request.",
      },
      { status: 500 },
    );
  }
}
