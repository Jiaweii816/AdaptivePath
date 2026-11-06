-- CreateTable
CREATE TABLE "BiologyMasteryJudgment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "stability" INTEGER NOT NULL,
    "supportStreak" INTEGER NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "memoryOrigin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BiologyMasteryJudgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiologyMasteryLedgerRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "memoryOrigin" TEXT NOT NULL,
    "l1EventId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "condition" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "reason" TEXT,
    "levelBefore" INTEGER,
    "levelAfter" INTEGER,
    "stabilityBefore" INTEGER,
    "stabilityAfter" INTEGER,
    "ruleVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiologyMasteryLedgerRow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiologyLearnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "cardJson" TEXT NOT NULL,
    "noteStatus" TEXT NOT NULL,
    "noteText" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "memoryOrigin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BiologyLearnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BiologyMasteryJudgment_memoryOrigin_userId_idx" ON "BiologyMasteryJudgment"("memoryOrigin", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BiologyMasteryJudgment_userId_sectionId_conceptId_memoryOrigin_key" ON "BiologyMasteryJudgment"("userId", "sectionId", "conceptId", "memoryOrigin");

-- CreateIndex
CREATE INDEX "BiologyMasteryLedgerRow_memoryOrigin_userId_occurredAt_idx" ON "BiologyMasteryLedgerRow"("memoryOrigin", "userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BiologyMasteryLedgerRow_userId_sectionId_conceptId_memoryOrigin_l1EventId_key" ON "BiologyMasteryLedgerRow"("userId", "sectionId", "conceptId", "memoryOrigin", "l1EventId");

-- CreateIndex
CREATE UNIQUE INDEX "BiologyMasteryLedgerRow_userId_sectionId_conceptId_memoryOrigin_sequence_key" ON "BiologyMasteryLedgerRow"("userId", "sectionId", "conceptId", "memoryOrigin", "sequence");

-- CreateIndex
CREATE INDEX "BiologyLearnerProfile_memoryOrigin_userId_sectionId_idx" ON "BiologyLearnerProfile"("memoryOrigin", "userId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BiologyLearnerProfile_userId_sectionId_version_memoryOrigin_key" ON "BiologyLearnerProfile"("userId", "sectionId", "version", "memoryOrigin");

