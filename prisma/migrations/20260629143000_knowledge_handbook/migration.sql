CREATE TABLE "KnowledgeNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conceptKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "whenToUse" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lookupCount" INTEGER NOT NULL DEFAULT 1,
    "firstNeededAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNeededAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'coach',
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "sourceTraceIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeNote_userId_conceptKey_key" ON "KnowledgeNote"("userId", "conceptKey");
CREATE INDEX "KnowledgeNote_userId_status_lastNeededAt_idx" ON "KnowledgeNote"("userId", "status", "lastNeededAt");
