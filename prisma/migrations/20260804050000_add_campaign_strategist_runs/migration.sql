-- Campaign M4B: durable, idempotent Strategist wake and proposal receipts.
CREATE TABLE "CampaignStrategistRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "activeSkeletonVersion" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerFingerprint" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "wakeSnapshotJson" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelAlias" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "proposalPatchId" TEXT,
    "backgroundJobId" TEXT,
    "traceRunId" TEXT,
    "rationaleSummary" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorClass" TEXT,
    "outputDigest" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignStrategistRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignStrategistRun_proposalPatchId_fkey" FOREIGN KEY ("proposalPatchId") REFERENCES "CampaignSkeletonPatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CampaignStrategistRun_triggerFingerprint_key" ON "CampaignStrategistRun"("triggerFingerprint");
CREATE UNIQUE INDEX "CampaignStrategistRun_backgroundJobId_key" ON "CampaignStrategistRun"("backgroundJobId");
CREATE INDEX "CampaignStrategistRun_campaignId_status_createdAt_idx" ON "CampaignStrategistRun"("campaignId", "status", "createdAt");
CREATE INDEX "CampaignStrategistRun_campaignId_completedAt_idx" ON "CampaignStrategistRun"("campaignId", "completedAt");
CREATE INDEX "CampaignStrategistRun_proposalPatchId_idx" ON "CampaignStrategistRun"("proposalPatchId");
