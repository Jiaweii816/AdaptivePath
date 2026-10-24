import { NextResponse } from "next/server";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";
import {
  CampaignExperienceError,
  createStubStrategistProvider,
  loadCampaignTodayView,
  maybeEnqueueStrategistWakeForLearner,
} from "@/server/campaign/services";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";

export const runtime = "nodejs";

export async function POST() {
  try {
    const userId = await resolveLocalTraceUserId(prisma);
    const view = await loadCampaignTodayView({
      db: prisma,
      userId,
      now: new Date(),
      materialize: true,
    });
    if (view.kind === "campaign" && !view.ended) {
      try {
        await maybeEnqueueStrategistWakeForLearner({
          db: prisma,
          userId,
          campaignDate: view.campaignDate,
          now: new Date(),
          ...(resolveMemoryOrigin() === "test"
            ? {
                providerFactory: () => createStubStrategistProvider({
                  decision: "no_change",
                  rationale: "Test traffic does not invoke an external Strategist provider.",
                }),
              }
            : {}),
        });
      } catch (error) {
        console.warn("Campaign Strategist wake enqueue failed without blocking Today.", error);
      }
    }
    return NextResponse.json({ ok: true, view });
  } catch (error) {
    if (error instanceof CampaignExperienceError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: "Campaign Today is temporarily unavailable." },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Unable to load Campaign Today." },
      { status: 500 },
    );
  }
}
