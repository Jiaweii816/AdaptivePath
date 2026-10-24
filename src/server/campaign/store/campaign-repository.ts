import type { Prisma, PrismaClient } from "@prisma/client";

export type CampaignDb = PrismaClient | Prisma.TransactionClient;

export const campaignTaskInclude = {
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
    include: { settlement: true },
  },
} satisfies Prisma.CampaignDailyTaskInclude;

export async function findDailyTask(
  db: CampaignDb,
  campaignId: string,
  campaignDate: string,
) {
  return db.campaignDailyTask.findUnique({
    where: { campaignId_campaignDate: { campaignId, campaignDate } },
    include: campaignTaskInclude,
  });
}

export async function findActiveSkeleton(db: CampaignDb, campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { activeSkeletonVersion: true },
  });
  return db.campaignSkeleton.findUniqueOrThrow({
    where: {
      campaignId_version: {
        campaignId,
        version: campaign.activeSkeletonVersion,
      },
    },
    include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
  });
}

export async function findCampaignWithGoal(db: CampaignDb, campaignId: string) {
  return db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { goal: true },
  });
}
