CREATE TABLE "PlannerDailyDoseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "doseDate" DATETIME NOT NULL,
    "problemId" TEXT NOT NULL,
    "planItemId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'plan',
    "sortOrder" INTEGER NOT NULL,
    "whyJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlannerDailyDoseItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerDailyDoseItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ReadinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerDailyDoseItem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlannerDailyDoseItem_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlannerPlanItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlannerDailyDoseItem_goalId_doseDate_problemId_key" ON "PlannerDailyDoseItem"("goalId", "doseDate", "problemId");
CREATE INDEX "PlannerDailyDoseItem_userId_goalId_doseDate_idx" ON "PlannerDailyDoseItem"("userId", "goalId", "doseDate");
CREATE INDEX "PlannerDailyDoseItem_planItemId_idx" ON "PlannerDailyDoseItem"("planItemId");
CREATE INDEX "PlannerDailyDoseItem_problemId_idx" ON "PlannerDailyDoseItem"("problemId");
