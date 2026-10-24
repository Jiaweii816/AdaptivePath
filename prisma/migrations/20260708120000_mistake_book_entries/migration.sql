CREATE TABLE "MistakeBookEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "chatSessionId" TEXT,
    "reviewAttemptId" TEXT,
    "title" TEXT NOT NULL,
    "guideMarkdown" TEXT NOT NULL,
    "selfCheckQuestion" TEXT,
    "selfCheckAnswer" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "saveCount" INTEGER NOT NULL DEFAULT 1,
    "sourceTraceIds" TEXT NOT NULL DEFAULT '[]',
    "firstSavedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSavedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MistakeBookEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MistakeBookEntry_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MistakeBookEntry_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MistakeBookEntry_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MistakeBookEntry_userId_problemId_key" ON "MistakeBookEntry"("userId", "problemId");
CREATE INDEX "MistakeBookEntry_userId_lastSavedAt_idx" ON "MistakeBookEntry"("userId", "lastSavedAt");
CREATE INDEX "MistakeBookEntry_problemId_idx" ON "MistakeBookEntry"("problemId");
CREATE INDEX "MistakeBookEntry_chatSessionId_idx" ON "MistakeBookEntry"("chatSessionId");
CREATE INDEX "MistakeBookEntry_reviewAttemptId_idx" ON "MistakeBookEntry"("reviewAttemptId");
