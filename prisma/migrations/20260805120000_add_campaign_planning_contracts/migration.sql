ALTER TABLE "CampaignSkeletonNodePlan" ADD COLUMN "targetByDate" TEXT;
ALTER TABLE "CampaignSkeletonNodePlan" ADD COLUMN "goalDepth" TEXT NOT NULL DEFAULT 'mastery';

ALTER TABLE "CampaignRepairQueueItem" ADD COLUMN "suspendedAt" DATETIME;
ALTER TABLE "CampaignRepairQueueItem" ADD COLUMN "expiredAt" DATETIME;

CREATE TABLE "CampaignDailyBudgetOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "campaignDate" TEXT NOT NULL,
    "maxQuestions" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "approvedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "patchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignDailyBudgetOverride_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignDailyBudgetOverride_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "CampaignSkeletonPatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CampaignDailyBudgetOverride_campaignId_campaignDate_key" ON "CampaignDailyBudgetOverride"("campaignId", "campaignDate");
CREATE INDEX "CampaignDailyBudgetOverride_campaignId_status_campaignDate_idx" ON "CampaignDailyBudgetOverride"("campaignId", "status", "campaignDate");
CREATE INDEX "CampaignDailyBudgetOverride_patchId_idx" ON "CampaignDailyBudgetOverride"("patchId");
