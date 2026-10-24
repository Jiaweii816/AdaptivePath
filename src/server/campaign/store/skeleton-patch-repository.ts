import type { CampaignDb } from "./campaign-repository";

export async function findSkeletonPatchForOwner(
  db: CampaignDb,
  input: { patchId: string; userId: string },
) {
  return db.campaignSkeletonPatch.findFirst({
    where: { id: input.patchId, campaign: { userId: input.userId } },
    include: { decision: true },
  });
}

export async function findSkeletonPatchByFingerprint(
  db: CampaignDb,
  input: { campaignId: string; userId: string; proposalFingerprint: string },
) {
  return db.campaignSkeletonPatch.findFirst({
    where: {
      campaignId: input.campaignId,
      proposalFingerprint: input.proposalFingerprint,
      campaign: { userId: input.userId },
    },
    include: { decision: true },
  });
}
