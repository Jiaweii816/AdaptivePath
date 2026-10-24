import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/prisma";
import {
  CampaignPatchReviewError,
  decideCampaignPatch,
} from "@/server/campaign/services/campaign-patch-review-service";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

const operationIdSchema = z.string().regex(/^op-\d{3}$/);
const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept_all"),
    acceptDailyBudgetSuggestion: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("partial_accept"),
    acceptedOperationIds: z.array(operationIdSchema).min(1).max(49)
      .refine((values) => new Set(values).size === values.length, "Operation ids must be unique."),
    acceptDailyBudgetSuggestion: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("reject"),
    rejectionReason: z.string().trim().min(1).max(500).optional(),
  }).strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ patchId: string }> },
) {
  try {
    const [{ patchId }, userId, body] = await Promise.all([
      context.params,
      resolveLocalTraceUserId(prisma),
      request.json(),
    ]);
    const decision = decisionSchema.parse(body);
    const result = await decideCampaignPatch({ db: prisma, userId, patchId, decision });
    revalidatePath("/campaign/today");
    revalidatePath("/campaign/roadmap");
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({
        ok: false,
        code: "validation_failed",
        error: "The route-approval request is invalid.",
      }, { status: 400 });
    }
    if (error instanceof CampaignPatchReviewError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({
      ok: false,
      code: "decision_conflict",
      error: "The route proposal changed state. Refresh and try again.",
    }, { status: 409 });
  }
}
