import { describe, expect, it } from "vitest";
import { createMemoryTestDb } from "./memory-test-helpers";
import {
  deleteKnowledgeNote,
  loadHandbookHomeCard,
  upsertKnowledgeNoteFromCoach,
  type CoachNoteInput,
} from "@/server/memory/store/knowledge-note-store";

const NOTE = {
  conceptKey: "python_heapq",
  title: "heapq · 最小堆",
  snippet: "import heapq\nheapq.heappush(h, x)",
  whenToUse: "反复取最小/最大、Top-K",
  category: "python_api",
} satisfies CoachNoteInput;

async function user(prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"]) {
  return prisma.user.upsert({
    where: { handle: "try" },
    update: {},
    create: { handle: "try" },
  });
}

describe("knowledge note store", () => {
  it("creates on first save and increments lookupCount on repeat", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      const first = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: NOTE,
        traceId: "t1",
      });
      expect(first.saved && first.note.lookupCount).toBe(1);

      const second = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, title: "heapq" },
        traceId: "t2",
      });
      expect(second.saved && second.note.lookupCount).toBe(2);
      expect(await db.prisma.knowledgeNote.count({ where: { userId: u.id } })).toBe(1);
    } finally {
      await db.cleanup();
    }
  });

  it("canonicalizes sub-API concept keys into the same handbook note", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: NOTE,
        traceId: "t1",
      });
      const second = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, conceptKey: "python_heapq_heappop" },
        traceId: "t2",
      });

      expect(second.saved && second.note.conceptKey).toBe("python_heapq");
      expect(second.saved && second.note.lookupCount).toBe(2);
      expect(await db.prisma.knowledgeNote.count({ where: { userId: u.id } })).toBe(1);
    } finally {
      await db.cleanup();
    }
  });

  it("can preserve lookupCount when an existing note was already touched in the turn", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: NOTE,
        traceId: "t1",
      });
      const second = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, snippet: "import heapq\nheapq.heappop(h)" },
        traceId: "t2",
        skipLookupIncrementForExisting: true,
      });

      expect(second.saved && second.alreadyExisted).toBe(true);
      expect(second.saved && second.note.lookupCount).toBe(1);
      expect(second.saved && second.note.snippet).toContain("heappop");
    } finally {
      await db.cleanup();
    }
  });

  it("does not overwrite content once userEdited is true", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      await upsertKnowledgeNoteFromCoach(db.prisma, { userId: u.id, note: NOTE, traceId: "t1" });
      await db.prisma.knowledgeNote.updateMany({
        where: { userId: u.id, conceptKey: "python_heapq" },
        data: { userEdited: true, snippet: "MY EDIT" },
      });

      await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, snippet: "COACH OVERWRITE" },
        traceId: "t2",
      });

      const row = await db.prisma.knowledgeNote.findFirstOrThrow({ where: { userId: u.id } });
      expect(row.snippet).toBe("MY EDIT");
      expect(row.lookupCount).toBe(2);
    } finally {
      await db.cleanup();
    }
  });

  it("rejects an empty or banned snippet", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      const empty = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, snippet: "   " },
        traceId: "t1",
      });
      expect(empty.saved).toBe(false);
      const banned = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: { ...NOTE, snippet: "evidence-only review structured JSON" },
        traceId: "t2",
      });
      expect(banned.saved).toBe(false);
    } finally {
      await db.cleanup();
    }
  });

  it("loads home card notes and deletes by owner", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      const saved = await upsertKnowledgeNoteFromCoach(db.prisma, {
        userId: u.id,
        note: NOTE,
        traceId: "t1",
      });
      expect(await loadHandbookHomeCard(db.prisma, u.id)).toHaveLength(1);

      if (saved.saved) {
        await deleteKnowledgeNote(db.prisma, { userId: u.id, noteId: saved.note.id });
      }
      expect(await loadHandbookHomeCard(db.prisma, u.id)).toHaveLength(0);
    } finally {
      await db.cleanup();
    }
  });
});
