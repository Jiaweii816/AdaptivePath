-- Enable WAL for the local SQLite MVP database file.
PRAGMA journal_mode = WAL;

CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "interviewGoal" TEXT,
    "preferredLanguages" TEXT NOT NULL DEFAULT '[]',
    "strongPatterns" TEXT NOT NULL DEFAULT '[]',
    "weakPatterns" TEXT NOT NULL DEFAULT '[]',
    "explanationStyle" TEXT NOT NULL DEFAULT '[]',
    "outputPreferences" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Problem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leetcodeNumber" INTEGER,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" TEXT,
    "statementMarkdown" TEXT NOT NULL DEFAULT '',
    "examplesJson" TEXT NOT NULL DEFAULT '[]',
    "constraintsJson" TEXT NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "starterCodePython" TEXT,
    "starterCodeCpp" TEXT,
    "methodName" TEXT NOT NULL,
    "inputContractJson" TEXT NOT NULL DEFAULT '{}',
    "outputContractJson" TEXT NOT NULL DEFAULT '{}',
    "isDemoSupported" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ProblemTestCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "problemId" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "expectedJson" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'sample',
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProblemTestCase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemTestCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CodeDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "selectedTestCaseIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeDraft_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReviewAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "codeDraftId" TEXT,
    "language" TEXT NOT NULL,
    "userState" TEXT,
    "userQuestion" TEXT,
    "codeSnapshot" TEXT NOT NULL DEFAULT '',
    "selectedTestCaseIds" TEXT NOT NULL DEFAULT '[]',
    "selectedTestsJson" TEXT NOT NULL DEFAULT '[]',
    "coachReplyMarkdown" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewAttempt_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewAttempt_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewAttempt_codeDraftId_fkey" FOREIGN KEY ("codeDraftId") REFERENCES "CodeDraft" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "RunEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewAttemptId" TEXT NOT NULL,
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
    CONSTRAINT "RunEvidence_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DiagnosisResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewAttemptId" TEXT NOT NULL,
    "diagnosisJson" TEXT NOT NULL DEFAULT '{}',
    "memoryUpdateCandidateJson" TEXT NOT NULL DEFAULT '{}',
    "mistakeTags" TEXT NOT NULL DEFAULT '[]',
    "skillTags" TEXT NOT NULL DEFAULT '[]',
    "userIssueSummary" TEXT,
    "coachSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiagnosisResult_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "title" TEXT,
    "primaryLanguage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatSession_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "reviewAttemptId" TEXT,
    "role" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ProblemHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "reviewAttemptId" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "userState" TEXT,
    "problemTags" TEXT NOT NULL DEFAULT '[]',
    "runStatus" TEXT NOT NULL,
    "failedCaseSummary" TEXT,
    "userIssueSummary" TEXT,
    "coachSummary" TEXT,
    "memoryUpdateSummary" TEXT,
    "nextRecommendation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProblemHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemHistory_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemHistory_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemHistory_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "L1MemoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT,
    "chatSessionId" TEXT,
    "reviewAttemptId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventJson" TEXT NOT NULL DEFAULT '{}',
    "content" TEXT,
    "source" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "L1MemoryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "L1MemoryEvent_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "L1MemoryEvent_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "L1MemoryEvent_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "L2MemoryFact" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "L2MemoryFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "L2MemoryFact_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "L2MemoryFact_sourceReviewAttemptId_fkey" FOREIGN KEY ("sourceReviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "L3MemorySynthesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceProblemId" TEXT,
    "sourceReviewAttemptId" TEXT,
    "synthesisMarkdown" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "sourceEventIds" TEXT NOT NULL DEFAULT '[]',
    "modelName" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "L3MemorySynthesis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "L3MemorySynthesis_sourceProblemId_fkey" FOREIGN KEY ("sourceProblemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "L3MemorySynthesis_sourceReviewAttemptId_fkey" FOREIGN KEY ("sourceReviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_handle_key" ON "User" ("handle");
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile" ("userId");
CREATE UNIQUE INDEX "Problem_leetcodeNumber_key" ON "Problem" ("leetcodeNumber");
CREATE UNIQUE INDEX "Problem_slug_key" ON "Problem" ("slug");
CREATE INDEX "ProblemTestCase_problemId_idx" ON "ProblemTestCase" ("problemId");
CREATE INDEX "ProblemTestCase_userId_idx" ON "ProblemTestCase" ("userId");
CREATE UNIQUE INDEX "CodeDraft_userId_problemId_language_key" ON "CodeDraft" ("userId", "problemId", "language");
CREATE INDEX "CodeDraft_problemId_idx" ON "CodeDraft" ("problemId");
CREATE INDEX "ReviewAttempt_userId_problemId_idx" ON "ReviewAttempt" ("userId", "problemId");
CREATE INDEX "ReviewAttempt_chatSessionId_idx" ON "ReviewAttempt" ("chatSessionId");
CREATE INDEX "ReviewAttempt_codeDraftId_idx" ON "ReviewAttempt" ("codeDraftId");
CREATE INDEX "ReviewAttempt_createdAt_idx" ON "ReviewAttempt" ("createdAt");
CREATE UNIQUE INDEX "RunEvidence_reviewAttemptId_key" ON "RunEvidence" ("reviewAttemptId");
CREATE UNIQUE INDEX "DiagnosisResult_reviewAttemptId_key" ON "DiagnosisResult" ("reviewAttemptId");
CREATE UNIQUE INDEX "ChatSession_userId_problemId_key" ON "ChatSession" ("userId", "problemId");
CREATE INDEX "ChatSession_problemId_idx" ON "ChatSession" ("problemId");
CREATE UNIQUE INDEX "ChatMessage_sessionId_sequence_key" ON "ChatMessage" ("sessionId", "sequence");
CREATE INDEX "ChatMessage_reviewAttemptId_idx" ON "ChatMessage" ("reviewAttemptId");
CREATE UNIQUE INDEX "ProblemHistory_reviewAttemptId_key" ON "ProblemHistory" ("reviewAttemptId");
CREATE INDEX "ProblemHistory_userId_problemId_idx" ON "ProblemHistory" ("userId", "problemId");
CREATE INDEX "ProblemHistory_chatSessionId_idx" ON "ProblemHistory" ("chatSessionId");
CREATE INDEX "ProblemHistory_createdAt_idx" ON "ProblemHistory" ("createdAt");
CREATE INDEX "L1MemoryEvent_userId_occurredAt_idx" ON "L1MemoryEvent" ("userId", "occurredAt");
CREATE INDEX "L1MemoryEvent_problemId_idx" ON "L1MemoryEvent" ("problemId");
CREATE INDEX "L1MemoryEvent_chatSessionId_idx" ON "L1MemoryEvent" ("chatSessionId");
CREATE INDEX "L1MemoryEvent_reviewAttemptId_idx" ON "L1MemoryEvent" ("reviewAttemptId");
CREATE UNIQUE INDEX "L2MemoryFact_userId_factType_tag_key" ON "L2MemoryFact" ("userId", "factType", "tag");
CREATE INDEX "L2MemoryFact_problemId_idx" ON "L2MemoryFact" ("problemId");
CREATE INDEX "L2MemoryFact_sourceReviewAttemptId_idx" ON "L2MemoryFact" ("sourceReviewAttemptId");
CREATE INDEX "L2MemoryFact_lastSeenAt_idx" ON "L2MemoryFact" ("lastSeenAt");
CREATE INDEX "L3MemorySynthesis_userId_isLatest_createdAt_idx" ON "L3MemorySynthesis" ("userId", "isLatest", "createdAt");
CREATE INDEX "L3MemorySynthesis_sourceProblemId_idx" ON "L3MemorySynthesis" ("sourceProblemId");
CREATE INDEX "L3MemorySynthesis_sourceReviewAttemptId_idx" ON "L3MemorySynthesis" ("sourceReviewAttemptId");
