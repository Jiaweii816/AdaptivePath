import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import { loadCampaignRoadmapView } from "@/server/campaign/services";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await resolveLocalTraceUserId(prisma);
    const view = await loadCampaignRoadmapView({ db: prisma, userId, now: new Date() });
    return NextResponse.json({ ok: true, view });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to load Campaign roadmap." },
      { status: 500 },
    );
  }
}
