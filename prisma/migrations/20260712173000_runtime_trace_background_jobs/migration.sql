CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceSessionId" TEXT,
    "originatingTraceRunId" TEXT NOT NULL,
    "traceRunId" TEXT,
    "processInstanceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "enqueuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BackgroundJob_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "ProblemWorkspaceSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BackgroundJob_originatingTraceRunId_fkey" FOREIGN KEY ("originatingTraceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BackgroundJob_traceRunId_fkey" FOREIGN KEY ("traceRunId") REFERENCES "AgentTraceRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BackgroundJob_traceRunId_key" ON "BackgroundJob"("traceRunId");
CREATE INDEX "BackgroundJob_workspaceSessionId_status_idx" ON "BackgroundJob"("workspaceSessionId", "status");
CREATE INDEX "BackgroundJob_processInstanceId_status_enqueuedAt_idx" ON "BackgroundJob"("processInstanceId", "status", "enqueuedAt");
CREATE INDEX "BackgroundJob_originatingTraceRunId_idx" ON "BackgroundJob"("originatingTraceRunId");
