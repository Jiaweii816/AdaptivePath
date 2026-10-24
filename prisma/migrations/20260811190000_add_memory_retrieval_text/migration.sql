-- Retrieval prose belongs to the durable memory records.  FTS/vector rows are
-- rebuildable projections and must not be the only place where this wording lives.
ALTER TABLE "L2MemoryFact" ADD COLUMN "retrievalText" TEXT;
ALTER TABLE "L2MemoryFact" ADD COLUMN "retrievalTextVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "L2MemoryFact" ADD COLUMN "retrievalInputHash" TEXT;

ALTER TABLE "MemoryEpisode" ADD COLUMN "retrievalText" TEXT;
ALTER TABLE "MemoryEpisode" ADD COLUMN "retrievalTextVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MemoryEpisode" ADD COLUMN "retrievalInputHash" TEXT;

ALTER TABLE "SynthesisSlot" ADD COLUMN "retrievalText" TEXT;
ALTER TABLE "SynthesisSlot" ADD COLUMN "retrievalTextVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SynthesisSlot" ADD COLUMN "retrievalInputHash" TEXT;
