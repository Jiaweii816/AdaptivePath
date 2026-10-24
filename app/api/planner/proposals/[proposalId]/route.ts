import { NextResponse } from "next/server";
import { z } from "zod";
import {
  applyPlannerProposal,
  PlannerError,
} from "@/server/planner/planner-service";
import { plannerProposalDecisionSchema } from "@/server/planner/planner.types";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> },
) {
  try {
    const [{ proposalId }, body, userId] = await Promise.all([
      context.params,
      readJson(request),
      resolveLocalTraceUserId(prisma),
    ]);
    const { decision } = plannerProposalDecisionSchema.parse(body);
    const proposal = await applyPlannerProposal(proposalId, decision, {
      db: prisma,
      userId,
    });

    return NextResponse.json({
      ok: true,
      proposalId: proposal.id,
      status: proposal.status,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid planner proposal decision.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof PlannerError) {
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
            : "Unable to update the planner proposal.",
      },
      { status: 500 },
    );
  }
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new PlannerError("Malformed JSON request body.", 400);
  }
}
