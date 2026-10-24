import { NextResponse } from "next/server";
import { z } from "zod";
import { continueMockInterview } from "@/server/mock-interview/continue-mock-interview";
import { MockInterviewError } from "@/server/mock-interview/mock-interview-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await continueMockInterview(await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid mock interview response.",
          issues: error.flatten(),
        },
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
        error:
          error instanceof Error
            ? error.message
            : "Unable to continue mock interview.",
      },
      { status: 500 },
    );
  }
}
