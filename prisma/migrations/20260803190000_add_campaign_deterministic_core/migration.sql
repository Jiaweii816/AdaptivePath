-- Campaign Milestone 2 is additive. Curriculum node ids and problem slugs remain
-- references to the versioned TypeScript assets rather than duplicated tables.
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "activeSkeletonVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "endDate" DATETIME NOT NULL,
    "dailyQuestionBudget" INTEGER NOT NULL CHECK ("dailyQuestionBudget" >= 3),
    "language" TEXT NOT NULL CHECK ("language" = 'Python'),
    "selfReportedWeakNodesJson" TEXT NOT NULL DEFAULT '[]',
    "preferredNodesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignGoal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignSkeleton" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignSkeleton_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignSkeletonNodePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skeletonId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "targetWeek" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    CONSTRAINT "CampaignSkeletonNodePlan_skeletonId_fkey" FOREIGN KEY ("skeletonId") REFERENCES "CampaignSkeleton" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignLearnerNodeState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "exposureState" TEXT NOT NULL DEFAULT 'unknown',
    "masteryState" TEXT NOT NULL DEFAULT 'learning',
    "masteryHealth" TEXT NOT NULL DEFAULT 'stable',
    "unlockedAt" DATETIME,
    "startedAt" DATETIME,
    "masteredAt" DATETIME,
    "masteredBySettlementId" TEXT,
    "latestPositiveStreak" INTEGER NOT NULL DEFAULT 0,
    "latestSettlementIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignLearnerNodeState_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignDailyTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "campaignDate" TEXT NOT NULL,
    "budget" INTEGER NOT NULL CHECK ("budget" >= 3),
    "primaryNodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "selectionMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignDailyTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignTaskItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dailyTaskId" TEXT NOT NULL,
    "problemSlug" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "slotRole" TEXT NOT NULL,
    "exposureType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignTaskItem_dailyTaskId_fkey" FOREIGN KEY ("dailyTaskId") REFERENCES "CampaignDailyTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignTaskItemAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskItemId" TEXT NOT NULL,
    "workspaceSessionId" TEXT,
    "reviewAttemptId" TEXT,
    "codeRevision" TEXT,
    "evidenceClass" TEXT,
    "evidenceAuthority" TEXT,
    "verdict" TEXT,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignTaskItemAttempt_taskItemId_fkey" FOREIGN KEY ("taskItemId") REFERENCES "CampaignTaskItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignTaskItemAttempt_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "ProblemWorkspaceSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CampaignTaskItemAttempt_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CampaignTaskItemSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskItemId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "reviewCompleted" BOOLEAN NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "selfRating" TEXT,
    "positiveForMastery" BOOLEAN NOT NULL,
    "negativeOutcome" BOOLEAN NOT NULL,
    "settledAt" DATETIME NOT NULL,
    "settlementVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignTaskItemSettlement_taskItemId_fkey" FOREIGN KEY ("taskItemId") REFERENCES "CampaignTaskItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignTaskItemSettlement_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "CampaignTaskItemAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignTaskReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "plannedCount" INTEGER NOT NULL,
    "settledCount" INTEGER NOT NULL,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignTaskReceipt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CampaignDailyTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignTaskReceipt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CampaignRepairQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "triggerTaskItemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignRepairQueueItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignRepairQueueItem_triggerTaskItemId_fkey" FOREIGN KEY ("triggerTaskItemId") REFERENCES "CampaignTaskItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Campaign_userId_status_idx" ON "Campaign"("userId", "status");
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");
CREATE UNIQUE INDEX "CampaignGoal_campaignId_key" ON "CampaignGoal"("campaignId");
CREATE INDEX "CampaignGoal_endDate_idx" ON "CampaignGoal"("endDate");
CREATE INDEX "CampaignSkeleton_campaignId_createdAt_idx" ON "CampaignSkeleton"("campaignId", "createdAt");
CREATE UNIQUE INDEX "CampaignSkeleton_campaignId_version_key" ON "CampaignSkeleton"("campaignId", "version");
CREATE INDEX "CampaignSkeletonNodePlan_nodeId_idx" ON "CampaignSkeletonNodePlan"("nodeId");
CREATE UNIQUE INDEX "CampaignSkeletonNodePlan_skeletonId_nodeId_key" ON "CampaignSkeletonNodePlan"("skeletonId", "nodeId");
CREATE UNIQUE INDEX "CampaignSkeletonNodePlan_skeletonId_sortOrder_key" ON "CampaignSkeletonNodePlan"("skeletonId", "sortOrder");
CREATE INDEX "CampaignLearnerNodeState_campaignId_masteryState_masteryHealth_idx" ON "CampaignLearnerNodeState"("campaignId", "masteryState", "masteryHealth");
CREATE INDEX "CampaignLearnerNodeState_nodeId_idx" ON "CampaignLearnerNodeState"("nodeId");
CREATE UNIQUE INDEX "CampaignLearnerNodeState_campaignId_nodeId_key" ON "CampaignLearnerNodeState"("campaignId", "nodeId");
CREATE INDEX "CampaignDailyTask_campaignId_status_campaignDate_idx" ON "CampaignDailyTask"("campaignId", "status", "campaignDate");
CREATE INDEX "CampaignDailyTask_primaryNodeId_idx" ON "CampaignDailyTask"("primaryNodeId");
CREATE UNIQUE INDEX "CampaignDailyTask_campaignId_campaignDate_key" ON "CampaignDailyTask"("campaignId", "campaignDate");
CREATE INDEX "CampaignTaskItem_nodeId_status_idx" ON "CampaignTaskItem"("nodeId", "status");
CREATE INDEX "CampaignTaskItem_problemSlug_idx" ON "CampaignTaskItem"("problemSlug");
CREATE UNIQUE INDEX "CampaignTaskItem_dailyTaskId_problemSlug_key" ON "CampaignTaskItem"("dailyTaskId", "problemSlug");
CREATE UNIQUE INDEX "CampaignTaskItem_dailyTaskId_sortOrder_key" ON "CampaignTaskItem"("dailyTaskId", "sortOrder");
CREATE UNIQUE INDEX "CampaignTaskItemAttempt_reviewAttemptId_key" ON "CampaignTaskItemAttempt"("reviewAttemptId");
CREATE INDEX "CampaignTaskItemAttempt_taskItemId_startedAt_idx" ON "CampaignTaskItemAttempt"("taskItemId", "startedAt");
CREATE INDEX "CampaignTaskItemAttempt_workspaceSessionId_idx" ON "CampaignTaskItemAttempt"("workspaceSessionId");
CREATE UNIQUE INDEX "CampaignTaskItemSettlement_taskItemId_key" ON "CampaignTaskItemSettlement"("taskItemId");
CREATE UNIQUE INDEX "CampaignTaskItemSettlement_attemptId_key" ON "CampaignTaskItemSettlement"("attemptId");
CREATE INDEX "CampaignTaskItemSettlement_settledAt_idx" ON "CampaignTaskItemSettlement"("settledAt");
CREATE UNIQUE INDEX "CampaignTaskReceipt_taskId_key" ON "CampaignTaskReceipt"("taskId");
CREATE INDEX "CampaignTaskReceipt_campaignId_status_idx" ON "CampaignTaskReceipt"("campaignId", "status");
CREATE UNIQUE INDEX "CampaignTaskReceipt_campaignId_campaignDate_key" ON "CampaignTaskReceipt"("campaignId", "campaignDate");
CREATE INDEX "CampaignRepairQueueItem_campaignId_status_priority_createdAt_idx" ON "CampaignRepairQueueItem"("campaignId", "status", "priority", "createdAt");
CREATE INDEX "CampaignRepairQueueItem_nodeId_idx" ON "CampaignRepairQueueItem"("nodeId");
CREATE UNIQUE INDEX "CampaignRepairQueueItem_campaignId_nodeId_triggerTaskItemId_reason_key" ON "CampaignRepairQueueItem"("campaignId", "nodeId", "triggerTaskItemId", "reason");
