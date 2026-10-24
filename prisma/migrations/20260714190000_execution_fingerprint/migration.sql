ALTER TABLE "PracticeRunLog" ADD COLUMN "executionFingerprint" TEXT;
ALTER TABLE "RunEvidence" ADD COLUMN "executionFingerprint" TEXT;

CREATE INDEX "PracticeRunLog_executionFingerprint_idx"
ON "PracticeRunLog"("executionFingerprint");

CREATE INDEX "RunEvidence_executionFingerprint_idx"
ON "RunEvidence"("executionFingerprint");
