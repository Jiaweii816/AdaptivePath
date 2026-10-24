import { redirect } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { CampaignOnboardingForm } from "@/features/campaign/campaign-onboarding-form";
import { campaignCurriculumAssets } from "@/server/campaign/curriculum";
import { resolveActiveCampaignForLearner } from "@/server/campaign/services";
import prisma from "@/server/db/prisma";
import { resolveLocalTraceUserId } from "@/server/observability/local-trace-user";

export const dynamic = "force-dynamic";

export default async function CampaignOnboardingPage() {
  const userId = await resolveLocalTraceUserId(prisma);
  const active = await resolveActiveCampaignForLearner(prisma, userId);
  if (active.kind === "active") redirect("/campaign/today");

  const nodes = campaignCurriculumAssets.graph.nodes
    .filter((node) => node.kind === "transferable")
    .map((node) => ({
      nodeId: node.nodeId,
      name: node.label.en,
      mechanism: node.description,
      requiredPrerequisites: campaignCurriculumAssets.graph.edges
        .filter((edge) => edge.type === "required" && edge.toNodeId === node.nodeId)
        .map((edge) => campaignCurriculumAssets.graph.nodes.find((candidate) => candidate.nodeId === edge.fromNodeId)?.label.en)
        .filter((name): name is string => Boolean(name)),
    }));

  return (
    <AppLayout displayName="PatternCoach Learner">
      <CampaignOnboardingForm conflict={active.kind === "conflict"} nodes={nodes} />
    </AppLayout>
  );
}
