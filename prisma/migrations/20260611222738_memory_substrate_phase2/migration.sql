-- CreateTable
CREATE TABLE "SynthesisSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "synthesisKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceFactIds" TEXT NOT NULL DEFAULT '[]',
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SynthesisSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_L2MemoryFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT,
    "sourceReviewAttemptId" TEXT,
    "factType" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "label" TEXT,
    "value" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "lastEvidenceSummary" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'review_diagnosis',
    "evidenceTraceIds" TEXT NOT NULL DEFAULT '[]',
    "contradictionSummary" TEXT,
    "validationJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "L2MemoryFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "L2MemoryFact_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "L2MemoryFact_sourceReviewAttemptId_fkey" FOREIGN KEY ("sourceReviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_L2MemoryFact" ("confidence", "contradictionSummary", "createdAt", "evidenceCount", "evidenceTraceIds", "factType", "id", "label", "lastEvidenceSummary", "lastSeenAt", "problemId", "source", "sourceReviewAttemptId", "status", "tag", "updatedAt", "userId", "value") SELECT "confidence", "contradictionSummary", "createdAt", "evidenceCount", "evidenceTraceIds", "factType", "id", "label", "lastEvidenceSummary", "lastSeenAt", "problemId", "source", "sourceReviewAttemptId", "status", "tag", "updatedAt", "userId", "value" FROM "L2MemoryFact";
DROP TABLE "L2MemoryFact";
ALTER TABLE "new_L2MemoryFact" RENAME TO "L2MemoryFact";
CREATE INDEX "L2MemoryFact_problemId_idx" ON "L2MemoryFact"("problemId");
CREATE INDEX "L2MemoryFact_sourceReviewAttemptId_idx" ON "L2MemoryFact"("sourceReviewAttemptId");
CREATE INDEX "L2MemoryFact_lastSeenAt_idx" ON "L2MemoryFact"("lastSeenAt");
CREATE UNIQUE INDEX "L2MemoryFact_userId_factType_tag_key" ON "L2MemoryFact"("userId", "factType", "tag");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SynthesisSlot_userId_status_updatedAt_idx" ON "SynthesisSlot"("userId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisSlot_userId_slot_synthesisKey_key" ON "SynthesisSlot"("userId", "slot", "synthesisKey");
