import { describe, expect, it } from "vitest";
import { createMemoryTestDb } from "./memory-test-helpers";
import {
  archiveKnowledgeNote,
  createKnowledgeNote,
  listActiveKnowledgeNotes,
  updateKnowledgeNote,
  type CoachNoteInput,
} from "@/server/memory/store/knowledge-note-store";

const NOTE = {
  conceptKey: "python_deque",
  title: "deque",
  snippet: "from collections import deque",
  whenToUse: "BFS、滑动窗口",
  category: "python_api",
} satisfies CoachNoteInput;

async function user(prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"]) {
  return prisma.user.upsert({
    where: { handle: "try" },
    update: {},
    create: { handle: "try" },
  });
}

describe("knowledge note mutations", () => {
  it("creates a user note, lists it, and edits set userEdited", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      const created = await createKnowledgeNote(db.prisma, { userId: u.id, note: NOTE });
      expect(created.source).toBe("user");
      expect(created.userEdited).toBe(true);

      await updateKnowledgeNote(db.prisma, {
        userId: u.id,
        noteId: created.id,
        patch: { snippet: "MY EDIT" },
      });
      const active = await listActiveKnowledgeNotes(db.prisma, u.id);
      expect(active).toHaveLength(1);
      expect(active[0].snippet).toBe("MY EDIT");
      expect(active[0].userEdited).toBe(true);
    } finally {
      await db.cleanup();
    }
  });

  it("archive drops a note out of the active list", async () => {
    const db = await createMemoryTestDb();
    try {
      const u = await user(db.prisma);
      const created = await createKnowledgeNote(db.prisma, { userId: u.id, note: NOTE });
      await archiveKnowledgeNote(db.prisma, { userId: u.id, noteId: created.id });
      expect(await listActiveKnowledgeNotes(db.prisma, u.id)).toHaveLength(0);

      const row = await db.prisma.knowledgeNote.findFirstOrThrow({ where: { id: created.id } });
      expect(row.status).toBe("memorized");
    } finally {
      await db.cleanup();
    }
  });
});
