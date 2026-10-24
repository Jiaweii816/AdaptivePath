-- Bind a Campaign attempt to one tab-local WorkspaceSession and retain the
-- latest persisted Review evidence identity without changing Review tables.
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "executionFingerprint" TEXT;
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "selectedSuiteFingerprint" TEXT;
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "evidenceProblemSlug" TEXT;
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "evidenceSubject" TEXT;
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "evidenceScope" TEXT;
ALTER TABLE "CampaignTaskItemAttempt" ADD COLUMN "evidenceCanVerdict" BOOLEAN;

CREATE UNIQUE INDEX "CampaignTaskItemAttempt_taskItemId_workspaceSessionId_key"
ON "CampaignTaskItemAttempt"("taskItemId", "workspaceSessionId");
