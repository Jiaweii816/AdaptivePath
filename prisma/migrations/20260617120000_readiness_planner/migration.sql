CREATE TABLE "ReadinessGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "interviewDate" DATETIME NOT NULL,
    "weeklyHours" REAL NOT NULL,
    "dailyDoseTarget" INTEGER NOT NULL DEFAULT 1,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReadinessGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PlannerPlanItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'plan',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledDate" DATETIME,
    "sortOrder" INTEGER NOT NULL,
    "whyJson" TEXT NOT NULL DEFAULT '[]',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannerPlanItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerPlanItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ReadinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerPlanItem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PlannerOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT,
    "planItemId" TEXT,
    "problemId" TEXT NOT NULL,
    "reviewAttemptId" TEXT NOT NULL,
    "problemHistoryId" TEXT NOT NULL,
    "selfRating" TEXT NOT NULL,
    "patternTagsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannerOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerOutcome_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ReadinessGoal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannerOutcome_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlannerPlanItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PlannerOutcome_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerOutcome_reviewAttemptId_fkey" FOREIGN KEY ("reviewAttemptId") REFERENCES "ReviewAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerOutcome_problemHistoryId_fkey" FOREIGN KEY ("problemHistoryId") REFERENCES "ProblemHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReviewSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "patternTag" TEXT,
    "dueDate" DATETIME NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "ease" REAL NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lastRating" TEXT NOT NULL,
    "lastOutcomeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewSchedule_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ReadinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewSchedule_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PlannerProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "patternTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "proposedChangeJson" TEXT NOT NULL DEFAULT '{}',
    "targetProblemSlug" TEXT,
    "targetProblemTitle" TEXT,
    "targetLeetcodeNumber" INTEGER,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannerProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ReadinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ReadinessGoal_userId_status_idx" ON "ReadinessGoal"("userId", "status");
CREATE INDEX "ReadinessGoal_interviewDate_idx" ON "ReadinessGoal"("interviewDate");

CREATE UNIQUE INDEX "PlannerPlanItem_goalId_problemId_key" ON "PlannerPlanItem"("goalId", "problemId");
CREATE INDEX "PlannerPlanItem_userId_status_scheduledDate_idx" ON "PlannerPlanItem"("userId", "status", "scheduledDate");
CREATE INDEX "PlannerPlanItem_goalId_sortOrder_idx" ON "PlannerPlanItem"("goalId", "sortOrder");
CREATE INDEX "PlannerPlanItem_problemId_idx" ON "PlannerPlanItem"("problemId");

CREATE UNIQUE INDEX "PlannerOutcome_reviewAttemptId_key" ON "PlannerOutcome"("reviewAttemptId");
CREATE UNIQUE INDEX "PlannerOutcome_problemHistoryId_key" ON "PlannerOutcome"("problemHistoryId");
CREATE INDEX "PlannerOutcome_userId_createdAt_idx" ON "PlannerOutcome"("userId", "createdAt");
CREATE INDEX "PlannerOutcome_goalId_idx" ON "PlannerOutcome"("goalId");
CREATE INDEX "PlannerOutcome_planItemId_idx" ON "PlannerOutcome"("planItemId");
CREATE INDEX "PlannerOutcome_problemId_idx" ON "PlannerOutcome"("problemId");

CREATE UNIQUE INDEX "ReviewSchedule_userId_goalId_problemId_key" ON "ReviewSchedule"("userId", "goalId", "problemId");
CREATE INDEX "ReviewSchedule_userId_dueDate_idx" ON "ReviewSchedule"("userId", "dueDate");
CREATE INDEX "ReviewSchedule_goalId_status_dueDate_idx" ON "ReviewSchedule"("goalId", "status", "dueDate");
CREATE INDEX "ReviewSchedule_patternTag_idx" ON "ReviewSchedule"("patternTag");

CREATE INDEX "PlannerProposal_userId_status_createdAt_idx" ON "PlannerProposal"("userId", "status", "createdAt");
CREATE INDEX "PlannerProposal_goalId_status_idx" ON "PlannerProposal"("goalId", "status");
CREATE INDEX "PlannerProposal_type_patternTag_idx" ON "PlannerProposal"("type", "patternTag");
