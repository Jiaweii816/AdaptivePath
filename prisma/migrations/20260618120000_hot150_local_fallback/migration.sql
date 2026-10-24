ALTER TABLE "Problem" ADD COLUMN "hot150Order" INTEGER;
ALTER TABLE "Problem" ADD COLUMN "hot150Section" TEXT;
ALTER TABLE "Problem" ADD COLUMN "officialUrl" TEXT;
ALTER TABLE "Problem" ADD COLUMN "localRunStatus" TEXT NOT NULL DEFAULT 'not_ready';
ALTER TABLE "Problem" ADD COLUMN "localRunStatusMessage" TEXT;
ALTER TABLE "Problem" ADD COLUMN "localRunValidatedAt" DATETIME;
ALTER TABLE "Problem" ADD COLUMN "comparisonStrategy" TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE "Problem" ADD COLUMN "comparisonConfigJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Problem" ADD COLUMN "contractKind" TEXT NOT NULL DEFAULT 'pure_function';
ALTER TABLE "Problem" ADD COLUMN "referenceSolutionHash" TEXT;

ALTER TABLE "ProblemTestCase" ADD COLUMN "expectedSource" TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE "ProblemTestCase" ADD COLUMN "gtProvenance" TEXT;
ALTER TABLE "ProblemTestCase" ADD COLUMN "validationStatus" TEXT NOT NULL DEFAULT 'unchecked';
ALTER TABLE "ProblemTestCase" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "PracticeRunLog" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "PracticeRunLog" ADD COLUMN "rawResultJson" TEXT NOT NULL DEFAULT '{}';
