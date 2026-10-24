-- Campaign M4A: deterministic, auditable Skeleton patch proposals and decisions.
-- Operations remain strict versioned JSON validated by the application; each accepted
-- patch materializes a complete immutable CampaignSkeleton version.
CREATE TABLE "CampaignSkeletonPatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "patchSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "operationsJson" TEXT NOT NULL,
    "proposalFingerprint" TEXT NOT NULL,
    "dailyBudgetSuggestionJson" TEXT,
    "validatorSummaryJson" TEXT NOT NULL,
    "decidedAt" DATETIME,
    "appliedSkeletonVersion" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignSkeletonPatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignSkeletonDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "resultingVersion" INTEGER,
    "acceptedOperationIdsJson" TEXT NOT NULL DEFAULT '[]',
    "rejectedOperationIdsJson" TEXT NOT NULL DEFAULT '[]',
    "dailyBudgetDecision" TEXT NOT NULL DEFAULT 'not_present',
    "rationale" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignSkeletonDecisionLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignSkeletonDecisionLog_patchId_fkey" FOREIGN KEY ("patchId") REFERENCES "CampaignSkeletonPatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CampaignSkeletonPatch_campaignId_proposalFingerprint_key" ON "CampaignSkeletonPatch"("campaignId", "proposalFingerprint");
CREATE INDEX "CampaignSkeletonPatch_campaignId_status_createdAt_idx" ON "CampaignSkeletonPatch"("campaignId", "status", "createdAt");
CREATE INDEX "CampaignSkeletonPatch_campaignId_baseVersion_idx" ON "CampaignSkeletonPatch"("campaignId", "baseVersion");
CREATE UNIQUE INDEX "CampaignSkeletonDecisionLog_patchId_key" ON "CampaignSkeletonDecisionLog"("patchId");
CREATE INDEX "CampaignSkeletonDecisionLog_campaignId_createdAt_idx" ON "CampaignSkeletonDecisionLog"("campaignId", "createdAt");
CREATE INDEX "CampaignSkeletonDecisionLog_action_actorType_idx" ON "CampaignSkeletonDecisionLog"("action", "actorType");
