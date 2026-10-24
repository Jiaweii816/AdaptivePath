CREATE TABLE "PracticeRunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "codeDraftId" TEXT,
    "language" TEXT NOT NULL,
    "runOrdinal" INTEGER NOT NULL,
    "selectedTestCaseIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeRunLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeRunLog_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeRunLog_codeDraftId_fkey" FOREIGN KEY ("codeDraftId") REFERENCES "CodeDraft" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PracticeRunLog_userId_problemId_idx" ON "PracticeRunLog"("userId", "problemId");
CREATE INDEX "PracticeRunLog_codeDraftId_idx" ON "PracticeRunLog"("codeDraftId");
CREATE INDEX "PracticeRunLog_createdAt_idx" ON "PracticeRunLog"("createdAt");
