import { AppLayout } from "@/components/layout/app-layout";
import { CampaignTodayClient } from "@/features/campaign/campaign-today-client";
import prisma from "@/server/db/prisma";
import { loadCampaignTodayView } from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const dynamic = "force-dynamic";

export default async function CampaignTodayPage() {
  const userId = await resolveLocalTraceUserId(prisma);
  const view = await loadCampaignTodayView({ db: prisma, userId, now: new Date(), materialize: false })
    .catch(() => ({ kind: "error" as const, displayName: "PatternCoach Learner", message: "Campaign Today is unavailable." }));
  return <AppLayout contentClassName="max-w-none px-0 py-0 lg:px-0" displayName={view.displayName} navigationMode="drawer"><CampaignTodayClient initialView={view} /></AppLayout>;
}
