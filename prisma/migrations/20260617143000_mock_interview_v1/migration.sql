CREATE TABLE "MockInterviewSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "mode" TEXT NOT NULL DEFAULT 'coding',
    "targetLabel" TEXT,
    "focusTagsJson" TEXT NOT NULL DEFAULT '[]',
    "currentPhase" TEXT NOT NULL DEFAULT 'intro',
    "language" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "maxQuestions" INTEGER NOT NULL DEFAULT 10,
    "durationMinutes" INTEGER NOT NULL DEFAULT 25,
    "planItemId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MockInterviewSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MockInterviewSession_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MockInterviewTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockInterviewTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MockInterviewCodeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockInterviewCodeSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MockInterviewCodeSnapshot_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MockInterviewRunEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "codeSnapshotId" TEXT,
    "problemId" TEXT NOT NULL,
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
    CONSTRAINT "MockInterviewRunEvidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MockInterviewRunEvidence_codeSnapshotId_fkey" FOREIGN KEY ("codeSnapshotId") REFERENCES "MockInterviewCodeSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MockInterviewRunEvidence_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MockInterviewFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "overallSignal" TEXT NOT NULL,
    "scoreJson" TEXT NOT NULL DEFAULT '{}',
    "strengthsJson" TEXT NOT NULL DEFAULT '[]',
    "concernsJson" TEXT NOT NULL DEFAULT '[]',
    "missedFollowUpsJson" TEXT NOT NULL DEFAULT '[]',
    "codeNotesJson" TEXT NOT NULL DEFAULT '[]',
    "recommendationsJson" TEXT NOT NULL DEFAULT '[]',
    "memoryUpdateCandidateJson" TEXT NOT NULL DEFAULT '{}',
    "reportMarkdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockInterviewFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MockInterviewSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MockInterviewSession_userId_status_createdAt_idx" ON "MockInterviewSession"("userId", "status", "createdAt");
CREATE INDEX "MockInterviewSession_problemId_idx" ON "MockInterviewSession"("problemId");
CREATE INDEX "MockInterviewSession_planItemId_idx" ON "MockInterviewSession"("planItemId");

CREATE UNIQUE INDEX "MockInterviewTurn_sessionId_sequence_key" ON "MockInterviewTurn"("sessionId", "sequence");
CREATE INDEX "MockInterviewTurn_sessionId_createdAt_idx" ON "MockInterviewTurn"("sessionId", "createdAt");

CREATE INDEX "MockInterviewCodeSnapshot_sessionId_createdAt_idx" ON "MockInterviewCodeSnapshot"("sessionId", "createdAt");
CREATE INDEX "MockInterviewCodeSnapshot_problemId_idx" ON "MockInterviewCodeSnapshot"("problemId");

CREATE INDEX "MockInterviewRunEvidence_sessionId_createdAt_idx" ON "MockInterviewRunEvidence"("sessionId", "createdAt");
CREATE INDEX "MockInterviewRunEvidence_codeSnapshotId_idx" ON "MockInterviewRunEvidence"("codeSnapshotId");
CREATE INDEX "MockInterviewRunEvidence_problemId_idx" ON "MockInterviewRunEvidence"("problemId");
CREATE INDEX "MockInterviewRunEvidence_status_idx" ON "MockInterviewRunEvidence"("status");

CREATE UNIQUE INDEX "MockInterviewFeedback_sessionId_key" ON "MockInterviewFeedback"("sessionId");
