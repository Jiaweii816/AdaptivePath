CREATE TABLE "new_RunEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewAttemptId" TEXT NOT NULL,
    "chatSessionId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'review',
    "toolCallId" TEXT,
    "status" TEXT NOT NULL,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "actualOutput" TEXT,
    "expectedOutput" TEXT,
    "firstFailedCaseJson" TEXT,
    "rawResultJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunEvidence_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunEvidence_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_RunEvidence" (
    "id",
    "reviewAttemptId",
    "status",
    "passedCount",
    "failedCount",
    "durationMs",
    "stdout",
    "stderr",
    "actualOutput",
    "expectedOutput",
    "firstFailedCaseJson",
    "rawResultJson",
    "createdAt"
)
SELECT
    "id",
    "reviewAttemptId",
    "status",
    "passedCount",
    "failedCount",
    "durationMs",
    "stdout",
    "stderr",
    "actualOutput",
    "expectedOutput",
    "firstFailedCaseJson",
    "rawResultJson",
    "createdAt"
FROM "RunEvidence";

DROP TABLE "RunEvidence";
ALTER TABLE "new_RunEvidence" RENAME TO "RunEvidence";

CREATE INDEX "RunEvidence_reviewAttemptId_idx" ON "RunEvidence" ("reviewAttemptId");
CREATE INDEX "RunEvidence_chatSessionId_idx" ON "RunEvidence" ("chatSessionId");
CREATE INDEX "RunEvidence_source_idx" ON "RunEvidence" ("source");

CREATE TABLE "AlgorithmHintProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlgorithmHintProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlgorithmHintProgress_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AlgorithmHintProgress_userId_problemId_key" ON "AlgorithmHintProgress" ("userId", "problemId");
CREATE INDEX "AlgorithmHintProgress_problemId_idx" ON "AlgorithmHintProgress" ("problemId");
