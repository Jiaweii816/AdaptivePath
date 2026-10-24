import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import {
  advanceCampaignDayForLearner,
  CampaignExperienceError,
} from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

export async function POST() {
  try {
    const userId = await resolveLocalTraceUserId(prisma);
    const view = await advanceCampaignDayForLearner({ db: prisma, userId, now: new Date() });
    return NextResponse.json({ ok: true, view });
  } catch (error) {
    if (error instanceof CampaignExperienceError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to advance the Campaign day." },
      { status: 500 },
    );
  }
}
