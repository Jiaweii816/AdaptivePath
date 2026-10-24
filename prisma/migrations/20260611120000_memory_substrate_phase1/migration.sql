ALTER TABLE "ChatSession" ADD COLUMN "rollingSummary" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "lastConsolidatedMessageId" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "sessionPlanJson" TEXT;

ALTER TABLE "L2MemoryFact" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "L2MemoryFact" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'review_diagnosis';
ALTER TABLE "L2MemoryFact" ADD COLUMN "evidenceTraceIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "L2MemoryFact" ADD COLUMN "contradictionSummary" TEXT;

CREATE TABLE "MemoryEpisode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT,
    "chatSessionId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "salience" REAL NOT NULL DEFAULT 0.5,
    "sourceTraceIds" TEXT NOT NULL DEFAULT '[]',
    "embeddedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryEpisode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryEpisode_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryEpisode_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MemoryEpisode_userId_createdAt_idx" ON "MemoryEpisode" ("userId", "createdAt");
CREATE INDEX "MemoryEpisode_userId_kind_idx" ON "MemoryEpisode" ("userId", "kind");
