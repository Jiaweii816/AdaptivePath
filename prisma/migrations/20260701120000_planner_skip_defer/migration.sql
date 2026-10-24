ALTER TABLE "PlannerPlanItem" ADD COLUMN "deferredFromDate" DATETIME;

CREATE INDEX "PlannerPlanItem_userId_goalId_deferredFromDate_idx" ON "PlannerPlanItem"("userId", "goalId", "deferredFromDate");
