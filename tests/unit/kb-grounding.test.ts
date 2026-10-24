import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCoachChatSystemPrompt } from "@/server/agents/coach-agent/build-coach-prompt";
import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import { buildCoachMemoryContext } from "@/server/memory";
import { ensureKbIndexed } from "@/server/memory/kb/ensure-kb-indexed";
import {
  buildKbDocuments,
  getKbDocumentById,
} from "@/server/memory/kb/kb-catalog";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const dirs: string[] = [];
let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;

  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempFts() {
  const dir = mkdtempSync(join(tmpdir(), "pc-kb-"));
  dirs.push(dir);
  return createFtsStore(join(dir, "test.db"));
}

describe("kb-catalog", () => {
  it("builds documents from algorithm hints per level and api reference per entry", () => {
    const documents = buildKbDocuments();
    expect(documents.length).toBeGreaterThan(10);

    const hintDoc = documents.find((doc) => doc.refId === "kb:hint:two-sum:2");
    expect(hintDoc).toBeDefined();
    expect(hintDoc?.content).toContain("complement");
    expect(hintDoc?.source).toBe("algorithm_hint");

    const apiDoc = documents.find((doc) => doc.refId === "kb:api:Python:heapq");
    expect(apiDoc).toBeDefined();
    expect(apiDoc?.content).toContain("min-heap");
    expect(apiDoc?.source).toBe("api_reference");
  });

  it("resolves any built refId back to its document", () => {
    for (const doc of buildKbDocuments()) {
      expect(getKbDocumentById(doc.refId)?.title).toBe(doc.title);
    }

    expect(getKbDocumentById("kb:api:Python/nonexistent")).toBeUndefined();
  });
});

describe("ensureKbIndexed", () => {
  it("indexes kb documents once per store and makes them FTS-searchable under kind=kb", () => {
    const fts = tempFts();
    ensureKbIndexed(fts);
    ensureKbIndexed(fts);

    const hits = fts.searchMemoryFts("heapq min-heap", {
      kind: "kb",
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.refId).toBe("kb:api:Python:heapq");
    expect(fts.searchMemoryFts("heapq", { kind: "episode", limit: 5 })).toEqual(
      [],
    );

    fts.close();
  });
});

describe("truth-tier prompt sections", () => {
  it("passes a selected domain reference through the brief without learner claims", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const fts = tempFts();
    ensureKbIndexed(fts);

    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["binary_search"],
      queryText: "heapq min-heap top-k",
      entry: { kind: "chat", intent: "concept_question" },
      profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
      ftsStore: fts,
    });
    const selectedReference = memory.brief.domainReferences[0];
    expect(selectedReference).toMatchObject({
      sourceLabel: "算法参考",
    });
    expect(selectedReference?.title).toBeTruthy();
    expect(selectedReference?.content).not.toContain("kb:");

    const input: CoachChatInput = {
      problem: {
        slug: problem.slug,
        title: problem.title,
        leetcodeNumber: null,
        tags: ["binary_search"],
        methodName: problem.methodName,
        statementMarkdown: problem.statementMarkdown,
      },
      user: {
        displayName: "u",
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      memory: memory.brief,
      messages: [
        { role: "user", content: "为什么 heapq 适合做 top-k？" },
      ],
      lastRunResult: undefined,
      interactionState: undefined,
      responseLanguage: "zh",
    };

    const prompt = buildCoachChatSystemPrompt(input);

    expect(prompt).toContain(
      "[DOMAIN REFERENCE — supplementary knowledge; never active-problem identity]",
    );
    expect(prompt).not.toContain("[COACH MEMORY BRIEF");
    expect(prompt).toContain(selectedReference!.title);

    fts.close();
  });
});
