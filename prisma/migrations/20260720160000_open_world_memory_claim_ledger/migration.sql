ALTER TABLE "L2MemoryFact" ADD COLUMN "clusterKey" TEXT;
ALTER TABLE "L2MemoryFact" ADD COLUMN "claimText" TEXT;
ALTER TABLE "L2MemoryFact" ADD COLUMN "polarity" TEXT;
ALTER TABLE "L2MemoryFact" ADD COLUMN "scopeJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "L2MemoryFact" ADD COLUMN "mechanismKeysJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "L2MemoryFact" ADD COLUMN "integrityVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "L2MemoryFact_userId_clusterKey_memoryOrigin_key"
ON "L2MemoryFact"("userId", "clusterKey", "memoryOrigin");

CREATE TABLE "MemoryActivityCluster" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "problemId" TEXT,
  "chatSessionId" TEXT,
  "rootReviewAttemptId" TEXT,
  "clusterKind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "sourceKey" TEXT NOT NULL,
  "memoryOrigin" TEXT NOT NULL DEFAULT 'legacy_unknown',
  "startedAt" DATETIME NOT NULL,
  "endedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MemoryActivityCluster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryActivityCluster_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemoryActivityCluster_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemoryActivityCluster_rootReviewAttemptId_fkey" FOREIGN KEY ("rootReviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryActivityCluster_rootReviewAttemptId_key" ON "MemoryActivityCluster"("rootReviewAttemptId");
CREATE UNIQUE INDEX "MemoryActivityCluster_userId_sourceKey_memoryOrigin_key" ON "MemoryActivityCluster"("userId", "sourceKey", "memoryOrigin");
CREATE INDEX "MemoryActivityCluster_userId_startedAt_idx" ON "MemoryActivityCluster"("userId", "startedAt");
CREATE INDEX "MemoryActivityCluster_problemId_idx" ON "MemoryActivityCluster"("problemId");
CREATE INDEX "MemoryActivityCluster_chatSessionId_idx" ON "MemoryActivityCluster"("chatSessionId");
CREATE INDEX "MemoryActivityCluster_memoryOrigin_status_startedAt_idx" ON "MemoryActivityCluster"("memoryOrigin", "status", "startedAt");

CREATE TABLE "MemoryActivityItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityClusterId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "role" TEXT,
  "occurredAt" DATETIME NOT NULL,
  "messageSequence" INTEGER,
  "contentHash" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryActivityItem_activityClusterId_fkey" FOREIGN KEY ("activityClusterId") REFERENCES "MemoryActivityCluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryActivityItem_sourceType_sourceId_key" ON "MemoryActivityItem"("sourceType", "sourceId");
CREATE UNIQUE INDEX "MemoryActivityItem_activityClusterId_ordinal_key" ON "MemoryActivityItem"("activityClusterId", "ordinal");
CREATE INDEX "MemoryActivityItem_activityClusterId_occurredAt_idx" ON "MemoryActivityItem"("activityClusterId", "occurredAt");

CREATE TABLE "MemoryExtractionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityClusterId" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "inputHash" TEXT,
  "outputHash" TEXT,
  "noSemanticReason" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MemoryExtractionReceipt_activityClusterId_fkey" FOREIGN KEY ("activityClusterId") REFERENCES "MemoryActivityCluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryExtractionReceipt_activityClusterId_extractorVersion_key" ON "MemoryExtractionReceipt"("activityClusterId", "extractorVersion");
CREATE INDEX "MemoryExtractionReceipt_status_createdAt_idx" ON "MemoryExtractionReceipt"("status", "createdAt");

ALTER TABLE "MemoryEpisode" ADD COLUMN "activityClusterId" TEXT REFERENCES "MemoryActivityCluster" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MemoryEpisode_activityClusterId_idx" ON "MemoryEpisode"("activityClusterId");

CREATE TABLE "MemoryClaimObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "activityClusterId" TEXT NOT NULL,
  "problemId" TEXT,
  "episodeId" TEXT,
  "claimType" TEXT NOT NULL,
  "claimText" TEXT NOT NULL,
  "polarity" TEXT NOT NULL,
  "scopeJson" TEXT NOT NULL DEFAULT '{}',
  "mechanismKeysJson" TEXT NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL,
  "memoryOrigin" TEXT NOT NULL DEFAULT 'legacy_unknown',
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "claimFingerprint" TEXT NOT NULL,
  "evidenceStrength" TEXT NOT NULL DEFAULT 'observed',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MemoryClaimObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryClaimObservation_activityClusterId_fkey" FOREIGN KEY ("activityClusterId") REFERENCES "MemoryActivityCluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryClaimObservation_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemoryClaimObservation_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "MemoryEpisode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryClaimObservation_activityClusterId_claimFingerprint_key" ON "MemoryClaimObservation"("activityClusterId", "claimFingerprint");
CREATE INDEX "MemoryClaimObservation_userId_status_createdAt_idx" ON "MemoryClaimObservation"("userId", "status", "createdAt");
CREATE INDEX "MemoryClaimObservation_problemId_idx" ON "MemoryClaimObservation"("problemId");
CREATE INDEX "MemoryClaimObservation_memoryOrigin_status_createdAt_idx" ON "MemoryClaimObservation"("memoryOrigin", "status", "createdAt");

CREATE TABLE "MemoryClaimRelation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "observationId" TEXT NOT NULL,
  "targetClusterFactId" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "modelConfidence" REAL,
  "rationale" TEXT,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "guardReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MemoryClaimRelation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MemoryClaimObservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryClaimRelation_targetClusterFactId_fkey" FOREIGN KEY ("targetClusterFactId") REFERENCES "L2MemoryFact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryClaimRelation_observationId_targetClusterFactId_key" ON "MemoryClaimRelation"("observationId", "targetClusterFactId");
CREATE INDEX "MemoryClaimRelation_targetClusterFactId_relation_idx" ON "MemoryClaimRelation"("targetClusterFactId", "relation");

CREATE TABLE "MemoryEvidenceContribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "observationId" TEXT NOT NULL,
  "targetClusterFactId" TEXT NOT NULL,
  "activityClusterId" TEXT NOT NULL,
  "problemId" TEXT,
  "reviewAttemptId" TEXT,
  "contributionKey" TEXT NOT NULL,
  "evidenceRole" TEXT NOT NULL,
  "transition" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "revisionKey" TEXT NOT NULL,
  "evidenceTraceIds" TEXT NOT NULL DEFAULT '[]',
  "countsAsIndependent" BOOLEAN NOT NULL DEFAULT true,
  "memoryOrigin" TEXT NOT NULL DEFAULT 'legacy_unknown',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryEvidenceContribution_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "MemoryClaimObservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryEvidenceContribution_targetClusterFactId_fkey" FOREIGN KEY ("targetClusterFactId") REFERENCES "L2MemoryFact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryEvidenceContribution_activityClusterId_fkey" FOREIGN KEY ("activityClusterId") REFERENCES "MemoryActivityCluster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemoryEvidenceContribution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MemoryEvidenceContribution_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MemoryEvidenceContribution_contributionKey_key" ON "MemoryEvidenceContribution"("contributionKey");
CREATE INDEX "MemoryEvidenceContribution_targetClusterFactId_activityClusterId_idx" ON "MemoryEvidenceContribution"("targetClusterFactId", "activityClusterId");
CREATE INDEX "MemoryEvidenceContribution_observationId_idx" ON "MemoryEvidenceContribution"("observationId");
CREATE INDEX "MemoryEvidenceContribution_problemId_idx" ON "MemoryEvidenceContribution"("problemId");
CREATE INDEX "MemoryEvidenceContribution_memoryOrigin_createdAt_idx" ON "MemoryEvidenceContribution"("memoryOrigin", "createdAt");

-- Durable downstream intents from one extraction receipt are idempotent.
ALTER TABLE "BackgroundJob" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "BackgroundJob" ADD COLUMN "parentTraceRunId" TEXT;
CREATE UNIQUE INDEX "BackgroundJob_dedupeKey_key" ON "BackgroundJob"("dedupeKey");
CREATE INDEX "BackgroundJob_parentTraceRunId_idx" ON "BackgroundJob"("parentTraceRunId");
