import { NextResponse } from "next/server";
import {
  loadCampaignProactiveDashboard,
  resolveActiveCampaignForLearner,
  resolveActiveCampaignDate,
} from "@/server/campaign/services";
import { formatCampaignDate } from "@/server/campaign/core";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await resolveLocalTraceUserId(prisma);
    const active = await resolveActiveCampaignForLearner(prisma, userId);
    const now = new Date();
    const dashboard = await loadCampaignProactiveDashboard({
      db: prisma,
      userId,
      now,
      ...(active.kind === "active" && active.campaign.goal
        ? {
            campaignId: active.campaign.id,
            campaignDate: await resolveActiveCampaignDate(
              prisma,
              active.campaign.id,
              formatCampaignDate(now, active.campaign.goal.timezone),
            ),
          }
        : {}),
    });
    return NextResponse.json({ ok: true, dashboard });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to refresh proactive dashboard modules." },
      { status: 500 },
    );
  }
}
