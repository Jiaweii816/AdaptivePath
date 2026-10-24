-- Carryover keeps an unfinished task's provenance when it is deliberately
-- re-scheduled into a later Campaign day. It is not a second settlement.
ALTER TABLE "CampaignTaskItem" ADD COLUMN "carryoverFromTaskItemId" TEXT;

CREATE INDEX "CampaignTaskItem_carryoverFromTaskItemId_idx"
ON "CampaignTaskItem"("carryoverFromTaskItemId");
