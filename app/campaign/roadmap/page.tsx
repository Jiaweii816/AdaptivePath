import { AppLayout } from "@/components/layout/app-layout";
import { CampaignRoadmap } from "@/features/campaign/campaign-roadmap";
import prisma from "@/server/db/prisma";
import { loadCampaignRoadmapView } from "@/server/campaign/services";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const dynamic = "force-dynamic";

export default async function CampaignRoadmapPage() {
  const userId = await resolveLocalTraceUserId(prisma);
  const view = await loadCampaignRoadmapView({ db: prisma, userId, now: new Date() })
    .catch(() => ({ kind: "error" as const, displayName: "PatternCoach Learner", message: "Campaign roadmap is unavailable." }));
  return <AppLayout contentClassName="max-w-none px-0 py-0 lg:px-0" displayName={view.displayName} navigationMode="drawer"><CampaignRoadmap view={view} /></AppLayout>;
}
