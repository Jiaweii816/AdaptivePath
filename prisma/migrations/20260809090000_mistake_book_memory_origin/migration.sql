-- Existing rows remain deliberately quarantined as legacy_unknown. Their
-- learner-origin backfill is a separately authorized live-data cutover.
ALTER TABLE "MistakeBookEntry" ADD COLUMN "memoryOrigin" TEXT NOT NULL DEFAULT 'legacy_unknown';

DROP INDEX "MistakeBookEntry_userId_lastSavedAt_idx";

CREATE INDEX "MistakeBookEntry_userId_memoryOrigin_lastSavedAt_idx"
ON "MistakeBookEntry"("userId", "memoryOrigin", "lastSavedAt");
