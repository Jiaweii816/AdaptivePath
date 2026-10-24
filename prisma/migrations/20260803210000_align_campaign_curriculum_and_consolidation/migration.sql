-- Campaign phase is derived at selection time. Rebuild the two affected tables
-- so M2 rows upgrade without changing historical migrations.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CampaignSkeleton" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "mixedWindowDays" INTEGER NOT NULL DEFAULT 7 CHECK ("mixedWindowDays" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignSkeleton_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_CampaignSkeleton" ("id", "campaignId", "version", "mixedWindowDays", "createdAt")
SELECT "id", "campaignId", "version", 7, "createdAt" FROM "CampaignSkeleton";

DROP TABLE "CampaignSkeleton";
ALTER TABLE "new_CampaignSkeleton" RENAME TO "CampaignSkeleton";
CREATE INDEX "CampaignSkeleton_campaignId_createdAt_idx" ON "CampaignSkeleton"("campaignId", "createdAt");
CREATE UNIQUE INDEX "CampaignSkeleton_campaignId_version_key" ON "CampaignSkeleton"("campaignId", "version");

CREATE TABLE "new_CampaignDailyTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "campaignDate" TEXT NOT NULL,
    "budget" INTEGER NOT NULL CHECK ("budget" >= 3),
    "primaryNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "selectionMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignDailyTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_CampaignDailyTask" (
    "id", "campaignId", "campaignDate", "budget", "primaryNodeId",
    "status", "selectionMetadataJson", "createdAt", "updatedAt"
)
SELECT
    "id", "campaignId", "campaignDate", "budget", "primaryNodeId",
    "status", "selectionMetadataJson", "createdAt", "updatedAt"
FROM "CampaignDailyTask";

DROP TABLE "CampaignDailyTask";
ALTER TABLE "new_CampaignDailyTask" RENAME TO "CampaignDailyTask";
CREATE INDEX "CampaignDailyTask_campaignId_status_campaignDate_idx" ON "CampaignDailyTask"("campaignId", "status", "campaignDate");
CREATE INDEX "CampaignDailyTask_primaryNodeId_idx" ON "CampaignDailyTask"("primaryNodeId");
CREATE UNIQUE INDEX "CampaignDailyTask_campaignId_campaignDate_key" ON "CampaignDailyTask"("campaignId", "campaignDate");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
