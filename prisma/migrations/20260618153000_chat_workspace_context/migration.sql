ALTER TABLE "PracticeRunLog" ADD COLUMN "codeHash" TEXT;

CREATE TABLE "new_RunEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewAttemptId" TEXT,
    "chatSessionId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'review',
    "toolCallId" TEXT,
    "codeHash" TEXT,
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
    "chatSessionId",
    "source",
    "toolCallId",
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
    "chatSessionId",
    "source",
    "toolCallId",
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

CREATE INDEX "PracticeRunLog_codeHash_idx" ON "PracticeRunLog"("codeHash");
CREATE INDEX "RunEvidence_reviewAttemptId_idx" ON "RunEvidence"("reviewAttemptId");
CREATE INDEX "RunEvidence_chatSessionId_idx" ON "RunEvidence"("chatSessionId");
CREATE INDEX "RunEvidence_codeHash_idx" ON "RunEvidence"("codeHash");
CREATE INDEX "RunEvidence_source_idx" ON "RunEvidence"("source");
