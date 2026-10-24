import { describe, expect, it } from "vitest";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  archiveKnowledgeNote,
  createKnowledgeNote,
  deleteKnowledgeNote,
  updateKnowledgeNote,
  type CoachNoteInput,
} from "@/server/memory/store/knowledge-note-store";
import { resolveKnowledgeBookQuery } from "@/server/memory/store/knowledge-book-resolver";
import { createMemoryTestDb } from "./memory-test-helpers";

const BASIC_DEQUE_NOTE = {
  conceptKey: "python_deque",
  title: "Python deque queue basics",
  snippet:
    "from collections import deque\nq = deque()\nq.append(x)\nleft = q.popleft()",
  whenToUse: "BFS queue or O(1) front-pop traversal.",
  category: "python_api",
} satisfies CoachNoteInput;

async function seedUser(prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"]) {
  return prisma.user.create({ data: { handle: "try" } });
}

async function seedDequeNote(
  prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"],
  userId: string,
  note: CoachNoteInput = BASIC_DEQUE_NOTE,
) {
  const row = await createKnowledgeNote(prisma, {
    userId,
    note,
    now: new Date("2026-07-09T10:00:00.000Z"),
  });
  return prisma.knowledgeNote.update({
    where: { id: row.id },
    data: { lookupCount: 3 },
  });
}

describe("resolveKnowledgeBookQuery", () => {
  it("covers a narrow Python deque left-pop query and increments lookupCount once", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      const note = await seedDequeNote(db.prisma, user.id);

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "Python 怎么从队列中弹出左边元素",
        language: "Python",
        userMessageId: "msg-1",
      });
      const updated = await db.prisma.knowledgeNote.findUniqueOrThrow({
        where: { id: note.id },
      });

      expect(result.status).toBe("covered");
      expect(result.canonicalTopic).toBe("python_deque");
      expect(result.matchedNotes[0]).toMatchObject({
        noteId: note.id,
        previousLookupCount: 3,
        lookupCount: 4,
        touched: true,
      });
      expect(result.matchedNotes[0]?.coveredAspects).toContain("popleft");
      expect(updated.lookupCount).toBe(4);
    } finally {
      await db.cleanup();
    }
  });

  it("marks broad Python queue usage as partial when the card only covers basics", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      await seedDequeNote(db.prisma, user.id);

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "你能告诉我 Python 里面队列的所有用法吗？",
        language: "Python",
        userMessageId: "msg-broad",
      });

      expect(result.status).toBe("partial");
      expect(result.matchedNotes[0]?.lookupCount).toBe(4);
      expect(result.matchedNotes[0]?.coveredAspects).toEqual(
        expect.arrayContaining(["append", "popleft"]),
      );
      expect(result.matchedNotes[0]?.missingAspects).toEqual(
        expect.arrayContaining(["appendleft", "pop", "extend", "extendleft", "rotate", "maxlen"]),
      );
    } finally {
      await db.cleanup();
    }
  });

  it("maps push_back and push_front aliases to append and appendleft coverage", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      await seedDequeNote(db.prisma, user.id);

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "push_back / push_front 在 Python deque 里怎么写？",
        language: "Python",
        userMessageId: "msg-alias",
      });

      expect(result.status).toBe("partial");
      expect(result.queryAspects).toEqual(["append", "appendleft"]);
      expect(result.matchedNotes[0]?.coveredAspects).toContain("append");
      expect(result.matchedNotes[0]?.missingAspects).toContain("appendleft");
    } finally {
      await db.cleanup();
    }
  });

  it("marks a same-topic card as partial when the requested aspect is missing entirely", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      await seedDequeNote(db.prisma, user.id);

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "Python deque 的 appendleft 怎么写？",
        language: "Python",
        userMessageId: "msg-missing-aspect",
      });

      expect(result.status).toBe("partial");
      expect(result.queryAspects).toEqual(["appendleft"]);
      expect(result.matchedNotes[0]?.coveredAspects).toEqual([]);
      expect(result.matchedNotes[0]?.missingAspects).toContain("appendleft");
      expect(result.matchedNotes[0]?.lookupCount).toBe(4);
    } finally {
      await db.cleanup();
    }
  });

  it("does not match a Python note for a C++ deque query", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      await seedDequeNote(db.prisma, user.id);

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "C++ deque 怎么 pop_front？",
        language: "C++",
        userMessageId: "msg-cpp",
      });

      expect(result.status).toBe("none");
      await expect(
        db.prisma.knowledgeNote.findFirstOrThrow({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ lookupCount: 3 });
    } finally {
      await db.cleanup();
    }
  });

  it("ignores archived notes", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      const note = await seedDequeNote(db.prisma, user.id);
      await archiveKnowledgeNote(db.prisma, { userId: user.id, noteId: note.id });

      const result = await resolveKnowledgeBookQuery(db.prisma, {
        userId: user.id,
        queryText: "Python 队列怎么 popleft？",
        language: "Python",
        userMessageId: "msg-archived",
      });

      expect(result.status).toBe("none");
    } finally {
      await db.cleanup();
    }
  });

  it("does not double-count the same userMessageId and note", async () => {
    const db = await createMemoryTestDb();
    try {
      const user = await seedUser(db.prisma);
      const note = await seedDequeNote(db.prisma, user.id);
      const args = {
        userId: user.id,
        queryText: "Python 队列怎么 popleft？",
        language: "Python" as const,
        userMessageId: "msg-idempotent",
      };

      await resolveKnowledgeBookQuery(db.prisma, args);
      const second = await resolveKnowledgeBookQuery(db.prisma, args);
      const updated = await db.prisma.knowledgeNote.findUniqueOrThrow({
        where: { id: note.id },
      });

      expect(second.status).toBe("covered");
      expect(second.matchedNotes[0]?.lookupCount).toBe(4);
      expect(second.matchedNotes[0]?.touched).toBe(false);
      expect(updated.lookupCount).toBe(4);
    } finally {
      await db.cleanup();
    }
  });

  it("keeps knowledge_note FTS in sync across create, edit, archive, and delete", async () => {
    const db = await createMemoryTestDb();
    const fts = createFtsStore(db.dbPath);
    try {
      const user = await seedUser(db.prisma);
      const note = await createKnowledgeNote(db.prisma, {
        userId: user.id,
        note: BASIC_DEQUE_NOTE,
        ftsStore: fts,
      });

      expect(fts.searchMemoryFts("popleft", { kind: "knowledge_note", limit: 5 })).toHaveLength(1);

      await updateKnowledgeNote(db.prisma, {
        userId: user.id,
        noteId: note.id,
        patch: { snippet: "from collections import deque\nq = deque()\nq.append(x)" },
        ftsStore: fts,
      });
      expect(fts.searchMemoryFts("popleft", { kind: "knowledge_note", limit: 5 })).toHaveLength(0);

      await archiveKnowledgeNote(db.prisma, {
        userId: user.id,
        noteId: note.id,
        ftsStore: fts,
      });
      expect(fts.searchMemoryFts("append", { kind: "knowledge_note", limit: 5 })).toHaveLength(0);

      const recreated = await createKnowledgeNote(db.prisma, {
        userId: user.id,
        note: BASIC_DEQUE_NOTE,
        ftsStore: fts,
      });
      expect(fts.searchMemoryFts("popleft", { kind: "knowledge_note", limit: 5 })).toHaveLength(1);

      await deleteKnowledgeNote(db.prisma, {
        userId: user.id,
        noteId: recreated.id,
        ftsStore: fts,
      });
      expect(fts.searchMemoryFts("popleft", { kind: "knowledge_note", limit: 5 })).toHaveLength(0);
    } finally {
      fts.close();
      await db.cleanup();
    }
  });
});
