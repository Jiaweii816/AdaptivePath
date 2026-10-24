import type { KnowledgeNote, PrismaClient } from "@prisma/client";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import type { FtsStore } from "./fts-store";

export const HANDBOOK_HOME_CAP = 4;

const BANNED_NOTE_TEXT = ["structured json", "evidence-only", "did not return"];

export const KNOWLEDGE_NOTE_CATEGORIES = [
  "python_api",
  "cpp_stl",
  "algo_template",
  "stdlib",
] as const;

export type KnowledgeNoteCategory = (typeof KNOWLEDGE_NOTE_CATEGORIES)[number];

export type CoachNoteInput = {
  conceptKey: string;
  title: string;
  snippet: string;
  whenToUse: string;
  category: KnowledgeNoteCategory;
};

export type EditableNoteFields = {
  title: string;
  snippet: string;
  whenToUse: string;
  category: KnowledgeNoteCategory;
};

type KnowledgeNotePrisma = Pick<PrismaClient, "knowledgeNote">;
type KnowledgeLookupPrisma = Pick<PrismaClient, "knowledgeNote" | "l1MemoryEvent">;

const KNOWLEDGE_NOTE_REF_PREFIX = "knowledge_note:";

export function isCleanCoachKnowledgeNote(note: Pick<CoachNoteInput, "snippet" | "whenToUse">) {
  const snippet = note.snippet.trim();
  const whenToUse = note.whenToUse.trim();
  if (!snippet || !whenToUse) {
    return false;
  }
  const text = `${snippet}\n${whenToUse}`.toLowerCase();
  return !BANNED_NOTE_TEXT.some((needle) => text.includes(needle));
}

export async function upsertKnowledgeNoteFromCoach(
  prisma: KnowledgeNotePrisma,
  args: {
    userId: string;
    note: CoachNoteInput;
    traceId: string;
    now?: Date;
    ftsStore?: FtsStore;
    skipLookupIncrementForExisting?: boolean;
  },
) {
  const now = args.now ?? new Date();
  const cleaned = normalizeCoachNote(args.note);
  if (!isCleanCoachKnowledgeNote(cleaned)) {
    return { saved: false as const, reason: "snippet empty or contained banned content" };
  }

  const existing = await prisma.knowledgeNote.findUnique({
    where: { userId_conceptKey: { userId: args.userId, conceptKey: cleaned.conceptKey } },
  });

  if (!existing) {
    const note = await createCoachNote(prisma, args.userId, cleaned, args.traceId, now);
    indexKnowledgeNote(args.ftsStore, note);
    return { saved: true as const, note, alreadyExisted: false };
  }

  const note = await updateCoachNote(prisma, existing, cleaned, args.traceId, now, {
    skipLookupIncrement: args.skipLookupIncrementForExisting === true,
  });
  indexKnowledgeNote(args.ftsStore, note);
  return { saved: true as const, note, alreadyExisted: true };
}

export async function deleteKnowledgeNote(
  prisma: KnowledgeNotePrisma,
  args: { userId: string; noteId: string; ftsStore?: FtsStore },
) {
  const result = await prisma.knowledgeNote.deleteMany({
    where: { id: args.noteId, userId: args.userId },
  });
  args.ftsStore?.removeMemoryDocument(knowledgeNoteFtsRefId(args.noteId));
  return result;
}

export async function loadHandbookHomeCard(prisma: KnowledgeNotePrisma, userId: string) {
  return prisma.knowledgeNote.findMany({
    where: { userId, status: "active" },
    orderBy: [{ lookupCount: "desc" }, { lastNeededAt: "desc" }],
    take: HANDBOOK_HOME_CAP,
  });
}

export async function listActiveKnowledgeNotes(prisma: KnowledgeNotePrisma, userId: string) {
  return prisma.knowledgeNote.findMany({
    where: { userId, status: "active" },
    orderBy: [{ category: "asc" }, { lookupCount: "desc" }, { lastNeededAt: "desc" }],
  });
}

export async function updateKnowledgeNote(
  prisma: KnowledgeNotePrisma,
  args: {
    userId: string;
    noteId: string;
    patch: Partial<EditableNoteFields>;
    ftsStore?: FtsStore;
  },
) {
  const result = await prisma.knowledgeNote.updateMany({
    where: { id: args.noteId, userId: args.userId },
    data: { ...trimPatch(args.patch), userEdited: true },
  });
  const row = await prisma.knowledgeNote.findFirst({
    where: { id: args.noteId, userId: args.userId },
  });
  if (row?.status === "active") {
    indexKnowledgeNote(args.ftsStore, row);
  } else {
    args.ftsStore?.removeMemoryDocument(knowledgeNoteFtsRefId(args.noteId));
  }
  return result;
}

export async function createKnowledgeNote(
  prisma: KnowledgeNotePrisma,
  args: { userId: string; note: CoachNoteInput; now?: Date; ftsStore?: FtsStore },
) {
  const now = args.now ?? new Date();
  const note = normalizeCoachNote(args.note);
  const fields = editableFields(note);
  const row = await prisma.knowledgeNote.upsert({
    where: { userId_conceptKey: { userId: args.userId, conceptKey: note.conceptKey } },
    update: { ...fields, source: "user", userEdited: true, status: "active", lastNeededAt: now },
    create: {
      userId: args.userId,
      conceptKey: note.conceptKey,
      ...fields,
      source: "user",
      userEdited: true,
      lookupCount: 1,
      firstNeededAt: now,
      lastNeededAt: now,
    },
  });
  indexKnowledgeNote(args.ftsStore, row);
  return row;
}

export async function archiveKnowledgeNote(
  prisma: KnowledgeNotePrisma,
  args: { userId: string; noteId: string; ftsStore?: FtsStore },
) {
  const result = await prisma.knowledgeNote.updateMany({
    where: { id: args.noteId, userId: args.userId },
    data: { status: "memorized" },
  });
  args.ftsStore?.removeMemoryDocument(knowledgeNoteFtsRefId(args.noteId));
  return result;
}

export async function touchKnowledgeNoteLookup(
  prisma: KnowledgeLookupPrisma,
  args: {
    userId: string;
    noteId: string;
    problemId?: string;
    chatSessionId?: string;
    userMessageId?: string;
    status: "covered" | "partial" | "related";
    canonicalTopic?: string;
    coveredAspects?: string[];
    missingAspects?: string[];
    now?: Date;
    ftsStore?: FtsStore;
  },
) {
  const existing = await prisma.knowledgeNote.findFirst({
    where: { id: args.noteId, userId: args.userId, status: "active" },
  });

  if (!existing) {
    return undefined;
  }

  const alreadyTouched = args.userMessageId
    ? await findKnowledgeLookupTrace(prisma, {
        userId: args.userId,
        chatSessionId: args.chatSessionId,
        userMessageId: args.userMessageId,
        noteId: args.noteId,
      })
    : undefined;

  if (alreadyTouched) {
    return {
      note: existing,
      previousLookupCount: existing.lookupCount,
      lookupCount: existing.lookupCount,
      touched: false,
    };
  }

  const now = args.now ?? new Date();
  const previousLookupCount = existing.lookupCount;
  const note = await prisma.knowledgeNote.update({
    where: { id: existing.id },
    data: {
      lookupCount: { increment: 1 },
      lastNeededAt: now,
    },
  });
  indexKnowledgeNote(args.ftsStore, note);

  await appendL1TraceEvent(prisma, {
    userId: args.userId,
    problemId: args.problemId,
    chatSessionId: args.chatSessionId,
    eventType: "knowledge_lookup",
    source: "knowledge_book_resolver",
    content: `${note.title}: ${args.status}`,
    eventJson: {
      userMessageId: args.userMessageId,
      noteId: note.id,
      conceptKey: note.conceptKey,
      status: args.status,
      canonicalTopic: args.canonicalTopic,
      coveredAspects: args.coveredAspects ?? [],
      missingAspects: args.missingAspects ?? [],
      previousLookupCount,
      lookupCount: note.lookupCount,
    },
  });

  return {
    note,
    previousLookupCount,
    lookupCount: note.lookupCount,
    touched: true,
  };
}

export async function wasKnowledgeNoteTouchedForMessage(
  prisma: Pick<PrismaClient, "l1MemoryEvent">,
  args: {
    userId: string;
    chatSessionId?: string;
    userMessageId?: string;
    noteId?: string;
    conceptKey?: string;
  },
) {
  return Boolean(await findKnowledgeLookupTrace(prisma, args));
}

export function normalizeCoachNote(note: CoachNoteInput): CoachNoteInput {
  const conceptKey = normalizeKnowledgeConceptKey(note.conceptKey, note.category);
  return {
    conceptKey,
    title: note.title.trim(),
    snippet: note.snippet.trim(),
    whenToUse: note.whenToUse.trim(),
    category: note.category,
  };
}

export function normalizeKnowledgeConceptKey(
  conceptKey: string,
  category: KnowledgeNoteCategory,
) {
  const normalized = normalizeMemoryTag(conceptKey)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  if (category === "python_api") {
    if (normalized.includes("heapq")) return "python_heapq";
    if (normalized.includes("deque")) return "python_deque";
    if (normalized.includes("bisect")) return "python_bisect";
  }
  if (category === "algo_template" && normalized.includes("sliding_window")) {
    return "sliding_window_template";
  }
  return normalized;
}

function editableFields(note: CoachNoteInput): EditableNoteFields {
  return {
    title: note.title,
    snippet: note.snippet,
    whenToUse: note.whenToUse,
    category: note.category,
  };
}

async function createCoachNote(
  prisma: KnowledgeNotePrisma,
  userId: string,
  note: CoachNoteInput,
  traceId: string,
  now: Date,
) {
  return prisma.knowledgeNote.create({
    data: {
      userId,
      ...note,
      lookupCount: 1,
      firstNeededAt: now,
      lastNeededAt: now,
      source: "coach",
      sourceTraceIds: JSON.stringify([traceId]),
    },
  });
}

async function updateCoachNote(
  prisma: KnowledgeNotePrisma,
  existing: KnowledgeNote,
  note: CoachNoteInput,
  traceId: string,
  now: Date,
  options: { skipLookupIncrement?: boolean } = {},
) {
  return prisma.knowledgeNote.update({
    where: { id: existing.id },
    data: {
      lookupCount: options.skipLookupIncrement
        ? existing.lookupCount
        : existing.lookupCount + 1,
      lastNeededAt: now,
      status: "active",
      sourceTraceIds: appendTraceId(existing.sourceTraceIds, traceId),
      ...(existing.userEdited ? {} : editableFields(note)),
    },
  });
}

function appendTraceId(existing: string, traceId: string) {
  try {
    const parsed = JSON.parse(existing) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
    return JSON.stringify([...new Set([...ids, traceId])]);
  } catch {
    return JSON.stringify([traceId]);
  }
}

function trimPatch(patch: Partial<EditableNoteFields>) {
  return {
    ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
    ...(patch.snippet === undefined ? {} : { snippet: patch.snippet.trim() }),
    ...(patch.whenToUse === undefined ? {} : { whenToUse: patch.whenToUse.trim() }),
    ...(patch.category === undefined ? {} : { category: patch.category }),
  };
}

export function knowledgeNoteFtsRefId(noteId: string) {
  return `${KNOWLEDGE_NOTE_REF_PREFIX}${noteId}`;
}

export function parseKnowledgeNoteFtsRefId(refId: string) {
  return refId.startsWith(KNOWLEDGE_NOTE_REF_PREFIX)
    ? refId.slice(KNOWLEDGE_NOTE_REF_PREFIX.length)
    : undefined;
}

export function knowledgeNoteFtsContent(note: Pick<
  KnowledgeNote,
  "conceptKey" | "title" | "snippet" | "whenToUse" | "category"
>) {
  return [
    note.conceptKey,
    note.title,
    note.category,
    note.whenToUse,
    note.snippet,
  ].join(" ");
}

export function indexKnowledgeNote(
  ftsStore: FtsStore | undefined,
  note: Pick<
    KnowledgeNote,
    "id" | "status" | "conceptKey" | "title" | "snippet" | "whenToUse" | "category"
  >,
) {
  if (!ftsStore) {
    return;
  }

  const refId = knowledgeNoteFtsRefId(note.id);
  if (note.status !== "active") {
    ftsStore.removeMemoryDocument(refId);
    return;
  }

  ftsStore.indexMemoryDocument({
    kind: "knowledge_note",
    refId,
    content: knowledgeNoteFtsContent(note),
  });
}

async function findKnowledgeLookupTrace(
  prisma: Pick<PrismaClient, "l1MemoryEvent">,
  args: {
    userId: string;
    chatSessionId?: string;
    userMessageId?: string;
    noteId?: string;
    conceptKey?: string;
  },
) {
  if (!args.userMessageId || (!args.noteId && !args.conceptKey)) {
    return undefined;
  }

  const traces = await prisma.l1MemoryEvent.findMany({
    where: {
      userId: args.userId,
      chatSessionId: args.chatSessionId,
      eventType: "knowledge_lookup",
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return traces.find((trace) => {
    try {
      const event = JSON.parse(trace.eventJson) as {
        userMessageId?: string;
        noteId?: string;
        conceptKey?: string;
      };
      return (
        event.userMessageId === args.userMessageId &&
        (event.noteId === args.noteId ||
          (args.conceptKey !== undefined && event.conceptKey === args.conceptKey))
      );
    } catch {
      return false;
    }
  });
}
