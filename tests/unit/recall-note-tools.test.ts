import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chatToolManifest,
  chatToolNameSchema,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import { pastMistakeRecallChatTool } from "@/server/tools/chat-tools/history-recall-tool";
import { noteMemoryChatTool } from "@/server/tools/chat-tools/note-memory-tool";
import { saveKnowledgeNoteChatTool } from "@/server/tools/chat-tools/save-knowledge-note-tool";
import { saveMistakeBookEntryChatTool } from "@/server/tools/chat-tools/save-mistake-book-entry-tool";
import { PREFERENCE_SET_CONFIDENCE } from "@/server/memory/memory.types";
import { buildCoachMemoryContext } from "@/server/memory";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { createKnowledgeNote } from "@/server/memory/store/knowledge-note-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  TEST_LEARNER_MEMORY_ORIGIN,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const ORIGINAL_MEMORY_ORIGIN = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
});

function toolProblemContext(problem: {
  id: string;
  slug: string;
  title: string;
  methodName: string;
}) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: null,
    methodName: problem.methodName,
    inputContractJson: "{}",
    outputContractJson: "{}",
    isDemoSupported: true,
    localRunStatus: "runnable",
    localRunStatusMessage: null,
    comparisonStrategy: "exact",
    comparisonConfigJson: "{}",
    contractKind: "pure_function",
  };
}

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (ORIGINAL_MEMORY_ORIGIN === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = ORIGINAL_MEMORY_ORIGIN;
  }
});

describe("tool manifest", () => {
  it("registers all 13 tools including discovery, split history recall, note, and capture tools", () => {
    expect(chatToolNameSchema.options).toHaveLength(13);
    expect(chatToolNameSchema.options).toEqual(
      expect.arrayContaining([
        "past_problem_recall",
        "past_mistake_recall",
        "discover_capability",
        "note_memory",
        "save_knowledge_note",
        "save_mistake_book_entry",
      ]),
    );
    expect(chatToolManifest.map((entry) => entry.function.name)).toEqual(
      expect.arrayContaining(["past_problem_recall", "past_mistake_recall"]),
    );
  });
});

describe("pastMistakeRecallChatTool", () => {
  it("returns ranked human-readable history items without raw fact fields", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const trace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "diagnosis",
        eventJson: "{}",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: "binary_search",
        value: "right boundary off by one",
        polarity: "negative",
        confidence: 0.7,
        status: "active",
        evidenceTraceIds: JSON.stringify([trace.id]),
        ...trustedL2FactFixture({
          mechanism: "binary_search",
          humanLabel: "The learner repeatedly excludes the right boundary too early.",
        }),
      },
    });
    const episode = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      kind: "review",
      title: "Binary Search review #1: off_by_one",
      summary: "Right boundary excluded the answer.",
      outcome: "failed",
      tags: ["binary_search"],
      salience: 0.7,
      sourceTraceIds: [trace.id],
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    });
    const fts = createFtsStore(db.dbPath);
    fts.indexMemoryDocument({
      kind: "fact",
      refId: fact.id,
      learnerId: user.id,
      content: "Binary Search recurring negative right boundary off by one",
    });
    fts.indexMemoryDocument({
      kind: "episode",
      refId: episode.id,
      learnerId: user.id,
      content: "Binary Search review off_by_one right boundary excluded",
    });

    const memoryAssembly = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["binary_search"],
      queryText: "binary search 上次怎么错的",
      entry: { kind: "recall_tool" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
    });
    const result = await pastMistakeRecallChatTool(
      { query: "binary search 上次怎么错的" },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["binary_search"],
        memoryAssembly,
        ftsStore: fts,
      },
    );

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceProblem: expect.any(String),
        }),
      ]),
    );
    expect(result.items.some((item) => item.title.includes("Binary Search")))
      .toBe(true);
    expect(result.items.every((item) => !("tag" in item))).toBe(true);
    expect(result.items.every((item) => !("confidence" in item))).toBe(true);
    expect(JSON.stringify(result.items)).not.toContain(trace.id);
    expect(result).not.toHaveProperty("retrievalStatus");
    fts.close();
  });
});

describe("noteMemoryChatTool", () => {
  it("saves a preference immediately via the preference_set opcode with evidence", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);

    const result = await noteMemoryChatTool(
      { tag: "preferred_language", value: "以后都用 Python" },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["binary_search"],
        toolCallId: "call-2",
        userMessageContent: "以后默认都用 Python，请记住这个偏好",
      },
    );

    expect(result.saved).toBe(true);
    const fact = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "preference", tag: "preferred_language" },
    });
    expect(fact.value).toBe("以后都用 Python");
    expect(fact.confidence).toBe(PREFERENCE_SET_CONFIDENCE);
    expect(fact.source).toBe("user_explicit");

    const fts = createFtsStore(db.dbPath);
    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["binary_search"],
      queryText: "please explain",
      entry: { kind: "chat", intent: "general_followup" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
    });
    fts.close();
    expect(memory.brief.outputPreferences).toContain("以后都用 Python");

    const note = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: { eventType: "memory_note" },
    });
    expect(JSON.parse(fact.evidenceTraceIds)).toContain(note.id);
  });

  it("overwrites the previous preference value on repeat", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const context = {
      prisma: db.prisma,
      userId: user.id,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      chatSessionId: chatSession.id,
      problem: toolProblemContext(problem),
      problemTags: [] as string[],
      toolCallId: "call-3",
    };

    await noteMemoryChatTool(
      { tag: "explanation_style", value: "长解释" },
      {
        ...context,
        userMessageContent: "以后请记住我的解释偏好：使用长解释",
      },
    );
    await noteMemoryChatTool(
      { tag: "explanation_style", value: "短解释" },
      {
        ...context,
        userMessageContent: "以后请更新我的解释偏好：使用短解释",
      },
    );

    const facts = await db.prisma.l2MemoryFact.findMany({
      where: { factType: "preference", tag: "explanation_style" },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.value).toBe("短解释");
  });

  it("refuses to save a preference without an explicit user request", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );

    const result = await noteMemoryChatTool(
      { tag: "explanation_style", value: "短解释" },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: [],
        toolCallId: "call-not-explicit",
        userMessageContent: "这一轮简单解释一下就行",
      },
    );

    expect(result).toMatchObject({
      saved: false,
      message: "Not saved: preference_requires_explicit_user_request",
    });
    await expect(
      db.prisma.l2MemoryFact.count({ where: { userId: user.id } }),
    ).resolves.toBe(0);
  });
});

describe("saveKnowledgeNoteChatTool", () => {
  it("saves a handbook note and appends a knowledge_note trace", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);

    const result = await saveKnowledgeNoteChatTool(
      {
        conceptKey: "python_heapq",
        title: "heapq · 最小堆",
        snippet: "import heapq\nheapq.heappush(h, x)",
        whenToUse: "Top-K、Dijkstra",
        category: "python_api",
      },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["heap"],
        toolCallId: "call-4",
        userMessageContent: "帮我把 heapq 语法保存到知识手册",
      },
    );

    expect(result.saved).toBe(true);
    expect(result.alreadyExisted).toBe(false);
    expect(result.lookupCount).toBe(1);
    expect(await db.prisma.knowledgeNote.count({ where: { userId: user.id } })).toBe(1);
    const trace = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: { eventType: "knowledge_note" },
    });
    expect(trace.source).toBe("save_knowledge_note_tool");
  });

  it("counts an explicit save as use without overwriting a user-edited note", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const note = await createKnowledgeNote(db.prisma, {
      userId: user.id,
      note: {
        conceptKey: "python_deque",
        title: "deque",
        snippet: "MY USER EDIT",
        whenToUse: "BFS queue",
        category: "python_api",
      },
    });
    await db.prisma.knowledgeNote.update({
      where: { id: note.id },
      data: { lookupCount: 4 },
    });

    const result = await saveKnowledgeNoteChatTool(
      {
        conceptKey: "python_deque_popleft",
        title: "deque popleft",
        snippet: "COACH OVERWRITE",
        whenToUse: "O(1) left pop.",
        category: "python_api",
      },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["queue"],
        toolCallId: "call-5",
        userMessageContent: "帮我扩展这张知识手册卡片",
      },
    );
    const stored = await db.prisma.knowledgeNote.findUniqueOrThrow({
      where: { id: note.id },
    });

    expect(result.saved).toBe(true);
    expect(result.alreadyExisted).toBe(true);
    expect(result.lookupCount).toBe(5);
    expect(result.message).toContain("手动编辑");
    expect(stored.lookupCount).toBe(5);
    expect(stored.snippet).toBe("MY USER EDIT");
  });
});

describe("saveMistakeBookEntryChatTool", () => {
  it("saves and overwrites the active problem's mistake-book guide", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const context = {
      prisma: db.prisma,
      userId: user.id,
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      chatSessionId: chatSession.id,
      problem: toolProblemContext(problem),
      problemTags: ["two_pointers"],
      userMessageContent: "请把这题保存到错题本，并更新这份复习指南",
    };

    const first = await saveMistakeBookEntryChatTool(
      {
        title: "双指针边界复盘",
        guideMarkdown: "左右边界中，谁更矮，水就从谁那边漏出去。",
        selfCheckQuestion: "为什么移动较矮的一侧？",
        selfCheckAnswer: "较高一侧不限制当前面积，移动较矮一侧才可能变大。",
        tags: ["two_pointers"],
      },
      { ...context, toolCallId: "call-mistake-1" },
    );
    const second = await saveMistakeBookEntryChatTool(
      {
        title: "双指针核心理解",
        guideMarkdown: "每轮面积由较矮柱决定；只移动较矮指针。",
        tags: ["two_pointers", "array"],
      },
      { ...context, toolCallId: "call-mistake-2" },
    );

    expect(first.saved).toBe(true);
    expect(first.recallIndexStatus).toBe("ready");
    expect(second.saved).toBe(true);
    expect(second.entryId).toBe(first.entryId);
    expect(second.saveCount).toBe(2);
    await expect(
      db.prisma.mistakeBookEntry.count({ where: { userId: user.id } }),
    ).resolves.toBe(1);
    const entry = await db.prisma.mistakeBookEntry.findFirstOrThrow({
      where: { userId: user.id, problemId: problem.id },
    });
    expect(entry.title).toBe("双指针核心理解");
    expect(entry.guideMarkdown).toContain("只移动较矮指针");
    expect(entry.selfCheckQuestion).toBeNull();
    expect(entry.memoryOrigin).toBe(TEST_LEARNER_MEMORY_ORIGIN);
    await expect(
      db.prisma.l1MemoryEvent.count({
        where: { eventType: "mistake_book_entry" },
      }),
    ).resolves.toBe(2);
  });

  it("returns a visible repair receipt when the targeted FTS upsert fails", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const brokenFts = {
      indexMemoryDocument: () => {
        throw new Error("simulated FTS failure");
      },
    };

    const result = await saveMistakeBookEntryChatTool(
      {
        title: "失败索引复盘",
        guideMarkdown: "保存成功，但索引需要重试。",
        tags: ["binary_search"],
      },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["binary_search"],
        toolCallId: "call-mistake-index-failure",
        ftsStore: brokenFts as never,
      },
    );

    expect(result).toMatchObject({ saved: true, recallIndexStatus: "pending_repair" });
    await expect(db.prisma.l1MemoryEvent.count({
      where: { eventType: "mistake_book_retrieval_index_pending_repair" },
    })).resolves.toBe(1);
  });
});
