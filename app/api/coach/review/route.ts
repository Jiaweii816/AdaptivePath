import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reviewPipeline,
  ReviewPipelineError,
} from "@/server/agents/coach-agent/review-pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamReview(body);
    }
    const result = await reviewPipeline(body);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid review request.",
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
            : "Unable to complete the review request.",
      },
      { status: 500 },
    );
  }
}

function streamReview(body: unknown) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void reviewPipeline(body, {
        onProgress(event) {
          write(event);
        },
      })
        .then((result) => write({ type: "complete", result }))
        .catch((error: unknown) => {
          console.error(error);
          write({
            type: "error",
            error: reviewErrorMessage(error),
          });
        })
        .finally(() => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function reviewErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) return "Invalid review request.";
  if (error instanceof ReviewPipelineError) return error.message;
  return error instanceof Error
    ? error.message
    : "Unable to complete the review request.";
}
