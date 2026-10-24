CREATE TABLE "ProblemWorkspaceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "browserInstanceId" TEXT NOT NULL,
    "activeIdentityKey" TEXT,
    "startTrigger" TEXT NOT NULL,
    "captureLevel" TEXT NOT NULL,
    "foregroundStatus" TEXT NOT NULL DEFAULT 'active',
    "backgroundStatus" TEXT NOT NULL DEFAULT 'idle',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foregroundEndedAt" DATETIME,
    "endReason" TEXT,
    "settledAt" DATETIME,
    "nextSeq" INTEGER NOT NULL DEFAULT 1,
    "nextTurnOrdinal" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProblemWorkspaceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemWorkspaceSession_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentTraceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "problemId" TEXT,
    "workspaceSessionId" TEXT,
    "parentTraceRunId" TEXT,
    "originatingTraceRunId" TEXT,
    "turnOrdinal" INTEGER,
    "originatingTurnOrdinal" INTEGER,
    "path" TEXT NOT NULL,
    "actionKind" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "processInstanceId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationMs" INTEGER,
    "providerInputTokens" INTEGER,
    "providerOutputTokens" INTEGER,
    "providerTotalTokens" INTEGER,
    "providerReasoningTokens" INTEGER,
    "providerCachedTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "pricingVersion" TEXT,
    "pricingStatus" TEXT NOT NULL DEFAULT 'not_applicable',
    "unpricedLlmCallCount" INTEGER NOT NULL DEFAULT 0,
    "llmCallCount" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "traceOverheadMs" INTEGER,
    "traceCompleteness" TEXT NOT NULL DEFAULT 'open',
    "finalFlushAt" DATETIME,
    "reviewAttemptId" TEXT,
    "chatSessionId" TEXT,
    "runId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentTraceRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceRun_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceRun_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "ProblemWorkspaceSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceRun_parentTraceRunId_fkey" FOREIGN KEY ("parentTraceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceRun_originatingTraceRunId_fkey" FOREIGN KEY ("originatingTraceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AgentTraceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "eventDigest" TEXT NOT NULL,
    "seq" INTEGER,
    "workspaceSessionId" TEXT,
    "traceRunId" TEXT NOT NULL,
    "parentTraceRunId" TEXT,
    "turnOrdinal" INTEGER,
    "stepId" TEXT,
    "parentStepId" TEXT,
    "stepIndex" INTEGER,
    "agentIteration" INTEGER,
    "path" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientOccurredAt" DATETIME,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "durationMs" INTEGER,
    "model" TEXT,
    "responseModel" TEXT,
    "providerInputTokens" INTEGER,
    "providerOutputTokens" INTEGER,
    "providerTotalTokens" INTEGER,
    "providerReasoningTokens" INTEGER,
    "providerCachedTokens" INTEGER,
    "usageSource" TEXT,
    "usageMissingReason" TEXT,
    "estimatedTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "pricingVersion" TEXT,
    "pricingStatus" TEXT,
    "memoryRssBytes" INTEGER,
    "memoryHeapUsedBytes" INTEGER,
    "resourceScope" TEXT,
    "detailLevel" TEXT NOT NULL DEFAULT 'summary',
    "payloadState" TEXT NOT NULL DEFAULT 'unavailable',
    "redactedFieldsJson" TEXT,
    "truncatedFieldsJson" TEXT,
    "unavailableFieldsJson" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTraceEvent_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "ProblemWorkspaceSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceEvent_traceRunId_fkey" FOREIGN KEY ("traceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTraceEvent_parentTraceRunId_fkey" FOREIGN KEY ("parentTraceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AgentTracePayload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traceEventId" TEXT NOT NULL,
    "workspaceSessionId" TEXT,
    "promptJson" TEXT,
    "inputJson" TEXT,
    "outputJson" TEXT,
    "retrievalJson" TEXT,
    "stateDeltaJson" TEXT,
    "memoryDeltaJson" TEXT,
    "detailMetadataJson" TEXT,
    "stdout" TEXT,
    "stderr" TEXT,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTracePayload_traceEventId_fkey" FOREIGN KEY ("traceEventId") REFERENCES "AgentTraceEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProblemWorkspaceSession_activeIdentityKey_key" ON "ProblemWorkspaceSession"("activeIdentityKey");
CREATE INDEX "ProblemWorkspaceSession_userId_problemId_foregroundStatus_idx" ON "ProblemWorkspaceSession"("userId", "problemId", "foregroundStatus");
CREATE INDEX "ProblemWorkspaceSession_userId_startedAt_idx" ON "ProblemWorkspaceSession"("userId", "startedAt");

CREATE UNIQUE INDEX "AgentTraceRun_workspaceSessionId_turnOrdinal_key" ON "AgentTraceRun"("workspaceSessionId", "turnOrdinal");
CREATE INDEX "AgentTraceRun_workspaceSessionId_startedAt_idx" ON "AgentTraceRun"("workspaceSessionId", "startedAt");
CREATE INDEX "AgentTraceRun_userId_startedAt_idx" ON "AgentTraceRun"("userId", "startedAt");
CREATE INDEX "AgentTraceRun_problemId_idx" ON "AgentTraceRun"("problemId");
CREATE INDEX "AgentTraceRun_parentTraceRunId_idx" ON "AgentTraceRun"("parentTraceRunId");
CREATE INDEX "AgentTraceRun_originatingTraceRunId_idx" ON "AgentTraceRun"("originatingTraceRunId");

CREATE UNIQUE INDEX "AgentTraceEvent_eventId_key" ON "AgentTraceEvent"("eventId");
CREATE UNIQUE INDEX "AgentTraceEvent_workspaceSessionId_seq_key" ON "AgentTraceEvent"("workspaceSessionId", "seq");
CREATE INDEX "AgentTraceEvent_traceRunId_stepIndex_idx" ON "AgentTraceEvent"("traceRunId", "stepIndex");
CREATE INDEX "AgentTraceEvent_parentTraceRunId_idx" ON "AgentTraceEvent"("parentTraceRunId");

CREATE UNIQUE INDEX "AgentTracePayload_traceEventId_key" ON "AgentTracePayload"("traceEventId");
CREATE INDEX "AgentTracePayload_workspaceSessionId_idx" ON "AgentTracePayload"("workspaceSessionId");
