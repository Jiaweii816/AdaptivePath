import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { campaignTimeZoneSchema } from "@/server/campaign/domain";
import { formatCampaignDate } from "@/server/campaign/core";
import {
  CampaignOnboardingError,
  createInitialCampaignFromOnboarding,
} from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const value: unknown = await request.json();
    const timezoneValue = typeof value === "object" && value !== null && "timezone" in value
      ? (value as { timezone?: unknown }).timezone
      : undefined;
    const timezone = campaignTimeZoneSchema.safeParse(timezoneValue);
    // Invalid timezone remains a field-level schema error. The fallback date is
    // used only so the complete strict DTO can be validated in one response.
    const campaignDate = timezone.success
      ? formatCampaignDate(new Date(), timezone.data)
      : "1970-01-01";
    const userId = await resolveLocalTraceUserId(prisma);
    const result = await createInitialCampaignFromOnboarding({
      db: prisma,
      userId,
      campaignDate,
      value,
    });
    return NextResponse.json({ ok: true, status: result.kind, campaign: result.campaign });
  } catch (error) {
    if (error instanceof CampaignOnboardingError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        error: error.message,
        fieldErrors: error.fieldErrors,
      }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, code: "validation_error", error: "Invalid JSON request." }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({
      ok: false,
      code: "creation_failed",
      error: "Campaign could not be created.",
    }, { status: 500 });
  }
}
