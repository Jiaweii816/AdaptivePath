-- Aggregate runtime experience. This table is deliberately independent from
-- learner facts and contains no user-authored content.
CREATE TABLE "OperationalNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryOrigin" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scopeKind" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "preconditionJson" TEXT NOT NULL DEFAULT '{}',
    "preconditionHash" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "supportCount" INTEGER NOT NULL DEFAULT 0,
    "counterCount" INTEGER NOT NULL DEFAULT 0,
    "distinctProblemCount" INTEGER NOT NULL DEFAULT 0,
    "distinctSessionCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceEventIdsJson" TEXT NOT NULL DEFAULT '[]',
    "validatedAt" DATETIME,
    "invalidAt" DATETIME,
    "lastEvidenceAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "OperationalNote_memoryOrigin_kind_scopeKind_scopeKey_signalKey_preconditionHash_contractVersion_key"
ON "OperationalNote"("memoryOrigin", "kind", "scopeKind", "scopeKey", "signalKey", "preconditionHash", "contractVersion");
CREATE INDEX "OperationalNote_memoryOrigin_status_scopeKind_scopeKey_contractVersion_idx"
ON "OperationalNote"("memoryOrigin", "status", "scopeKind", "scopeKey", "contractVersion");
CREATE INDEX "OperationalNote_invalidAt_idx" ON "OperationalNote"("invalidAt");
