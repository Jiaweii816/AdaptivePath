import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { applyPrismaMigrations } from "./prisma-test-utils";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
  prepare: (source: string) => {
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    run: (...params: unknown[]) => unknown;
  };
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("PatternCoach Prisma schema", () => {
  it("applies the migration and accepts one fixture row for every base entity", () => {
    const dir = mkdtempSync(join(tmpdir(), "patterncoach-schema-"));
    tempDirs.push(dir);

    const db = new Database(join(dir, "fixture.db"));
    applyPrismaMigrations(db);
    db.exec("PRAGMA foreign_keys = ON;");

    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");

    const now = "2026-06-08T00:00:00.000Z";
    const ids = {
      user: randomUUID(),
      profile: randomUUID(),
      problem: randomUUID(),
      testCase: randomUUID(),
      draft: randomUUID(),
      practiceRun: randomUUID(),
      session: randomUUID(),
      review: randomUUID(),
      run: randomUUID(),
      diagnosis: randomUUID(),
      message: randomUUID(),
      history: randomUUID(),
      l1: randomUUID(),
      l2: randomUUID(),
      hint: randomUUID(),
      episode: randomUUID(),
      mistakeBookEntry: randomUUID(),
      mockSession: randomUUID(),
      mockTurn: randomUUID(),
      mockCodeSnapshot: randomUUID(),
      mockRunEvidence: randomUUID(),
      mockFeedback: randomUUID(),
    };

    db.prepare(
      'INSERT INTO "User" ("id", "handle", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)',
    ).run(ids.user, "try", now, now);
    db.prepare(
      'INSERT INTO "UserProfile" ("id", "userId", "displayName", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)',
    ).run(ids.profile, ids.user, "try", now, now);
    db.prepare(
      'INSERT INTO "Problem" ("id", "leetcodeNumber", "slug", "title", "methodName", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.problem, 1, "two-sum", "Two Sum", "twoSum", now, now);
    db.prepare(
      'INSERT INTO "ProblemTestCase" ("id", "problemId", "label", "inputJson", "expectedJson", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.testCase,
      ids.problem,
      "sample 1",
      '{"nums":[2,7,11,15],"target":9}',
      "[0,1]",
      now,
      now,
    );
    db.prepare(
      'INSERT INTO "CodeDraft" ("id", "userId", "problemId", "language", "content", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.draft, ids.user, ids.problem, "python", "class Solution: pass", now, now);
    db.prepare(
      'INSERT INTO "PracticeRunLog" ("id", "userId", "problemId", "codeDraftId", "language", "runOrdinal", "status", "passedCount", "totalCount", "summary", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.practiceRun,
      ids.user,
      ids.problem,
      ids.draft,
      "python",
      1,
      "passed_visible_tests",
      1,
      1,
      "execute 1: 1/1 visible tests passed",
      now,
    );
    db.prepare(
      'INSERT INTO "ChatSession" ("id", "userId", "problemId", "title", "primaryLanguage", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.session, ids.user, ids.problem, "Two Sum", "zh", now, now);
    db.prepare(
      'INSERT INTO "ReviewAttempt" ("id", "userId", "problemId", "chatSessionId", "codeDraftId", "language", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.review, ids.user, ids.problem, ids.session, ids.draft, "python", now);
    db.prepare(
      'INSERT INTO "RunEvidence" ("id", "reviewAttemptId", "status", "passedCount", "failedCount", "createdAt") VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ids.run, ids.review, "passed_visible_tests", 1, 0, now);
    db.prepare(
      'INSERT INTO "DiagnosisResult" ("id", "reviewAttemptId", "diagnosisJson", "createdAt") VALUES (?, ?, ?, ?)',
    ).run(ids.diagnosis, ids.review, '{"status":"ok"}', now);
    db.prepare(
      'INSERT INTO "ChatMessage" ("id", "sessionId", "reviewAttemptId", "role", "contentMarkdown", "sequence", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.message, ids.session, ids.review, "assistant", "Nice start.", 1, now);
    db.prepare(
      'INSERT INTO "ProblemHistory" ("id", "userId", "problemId", "reviewAttemptId", "chatSessionId", "language", "runStatus", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.history,
      ids.user,
      ids.problem,
      ids.review,
      ids.session,
      "python",
      "passed_visible_tests",
      now,
    );
    db.prepare(
      'INSERT INTO "L1MemoryEvent" ("id", "userId", "problemId", "chatSessionId", "reviewAttemptId", "eventType", "occurredAt", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(ids.l1, ids.user, ids.problem, ids.session, ids.review, "review_attempt", now, now);
    db.prepare(
      'INSERT INTO "L2MemoryFact" ("id", "userId", "problemId", "sourceReviewAttemptId", "factType", "tag", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.l2,
      ids.user,
      ids.problem,
      ids.review,
      "strength",
      "hashmap",
      now,
      now,
    );
    db.prepare(
      'INSERT INTO "AlgorithmHintProgress" ("id", "userId", "problemId", "currentLevel", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ids.hint, ids.user, ids.problem, 1, now, now);
    db.prepare(
      'INSERT INTO "MemoryEpisode" ("id", "userId", "problemId", "chatSessionId", "kind", "title", "summary", "outcome", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.episode,
      ids.user,
      ids.problem,
      ids.session,
      "review",
      "Two Sum review #1",
      "Passed visible tests.",
      "passed",
      now,
    );
    db.prepare(
      'INSERT INTO "MistakeBookEntry" ("id", "userId", "problemId", "chatSessionId", "reviewAttemptId", "title", "guideMarkdown", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.mistakeBookEntry,
      ids.user,
      ids.problem,
      ids.session,
      ids.review,
      "Two Sum guide",
      "Remember complement lookup.",
      now,
      now,
    );
    db.prepare(
      'INSERT INTO "MockInterviewSession" ("id", "userId", "problemId", "language", "updatedAt") VALUES (?, ?, ?, ?, ?)',
    ).run(ids.mockSession, ids.user, ids.problem, "Python", now);
    db.prepare(
      'INSERT INTO "MockInterviewTurn" ("id", "sessionId", "role", "contentMarkdown", "phase", "sequence") VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      ids.mockTurn,
      ids.mockSession,
      "interviewer",
      "Walk me through your invariant.",
      "intro",
      0,
    );
    db.prepare(
      'INSERT INTO "MockInterviewCodeSnapshot" ("id", "sessionId", "problemId", "language", "code") VALUES (?, ?, ?, ?, ?)',
    ).run(
      ids.mockCodeSnapshot,
      ids.mockSession,
      ids.problem,
      "Python",
      "class Solution: pass",
    );
    db.prepare(
      'INSERT INTO "MockInterviewRunEvidence" ("id", "sessionId", "codeSnapshotId", "problemId", "status", "passedCount", "failedCount") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      ids.mockRunEvidence,
      ids.mockSession,
      ids.mockCodeSnapshot,
      ids.problem,
      "passed_visible_tests",
      1,
      0,
    );
    db.prepare(
      'INSERT INTO "MockInterviewFeedback" ("id", "sessionId", "verdict", "overallSignal", "reportMarkdown") VALUES (?, ?, ?, ?, ?)',
    ).run(
      ids.mockFeedback,
      ids.mockSession,
      "Acceptable signal.",
      "acceptable",
      "## Verdict\nAcceptable signal.",
    );

    const tables = [
      "User",
      "UserProfile",
      "Problem",
      "ProblemTestCase",
      "CodeDraft",
      "PracticeRunLog",
      "ReviewAttempt",
      "RunEvidence",
      "DiagnosisResult",
      "ChatSession",
      "ChatMessage",
      "ProblemHistory",
      "L1MemoryEvent",
      "L2MemoryFact",
      "AlgorithmHintProgress",
      "MemoryEpisode",
      "MistakeBookEntry",
      "MockInterviewSession",
      "MockInterviewTurn",
      "MockInterviewCodeSnapshot",
      "MockInterviewRunEvidence",
      "MockInterviewFeedback",
    ];

    for (const table of tables) {
      const result = db
        .prepare(`SELECT COUNT(*) as count FROM "${table}"`)
        .get();

      expect(result?.count).toBe(1);
    }

    db.close();
  });

  it("defines the memory substrate phase-1 models and columns", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toContain("model MemoryEpisode {");
    expect(schema).toMatch(
      /model L2MemoryFact \{[\s\S]*?status\s+String\s+@default\("active"\)/,
    );
    expect(schema).toMatch(
      /model L2MemoryFact \{[\s\S]*?source\s+String\s+@default\("review_diagnosis"\)/,
    );
    expect(schema).toMatch(
      /model L2MemoryFact \{[\s\S]*?evidenceTraceIds\s+String\s+@default\("\[\]"\)/,
    );
    expect(schema).toMatch(
      /model L2MemoryFact \{[\s\S]*?contradictionSummary\s+String\?/,
    );
    expect(schema).toMatch(
      /model ChatSession \{[\s\S]*?rollingSummary\s+String\?/,
    );
    expect(schema).toMatch(
      /model ChatSession \{[\s\S]*?lastConsolidatedMessageId\s+String\?/,
    );
    expect(schema).toMatch(
      /model ChatSession \{[\s\S]*?sessionPlanJson\s+String\?/,
    );
    expect(schema).toMatch(
      /model ChatSession \{[\s\S]*?clearedBeforeSequence\s+Int\s+@default\(0\)/,
    );
    expect(schema).toMatch(
      /model ChatSession \{[\s\S]*?clearedAt\s+DateTime\?/,
    );
    expect(schema).toContain("model MockInterviewSession {");
    expect(schema).toContain("model MockInterviewTurn {");
    expect(schema).toContain("model MockInterviewCodeSnapshot {");
    expect(schema).toContain("model MockInterviewRunEvidence {");
    expect(schema).toContain("model MockInterviewFeedback {");
    expect(schema).toContain("model MistakeBookEntry {");
    expect(schema).toMatch(
      /model MistakeBookEntry \{[\s\S]*?@@unique\(\[userId, problemId\]\)/,
    );
    expect(schema).toMatch(
      /model PracticeRunLog \{[\s\S]*?codeHash\s+String\?/,
    );
    expect(schema).toMatch(
      /model PracticeRunLog \{[\s\S]*?executionFingerprint\s+String\?/,
    );
    expect(schema).toMatch(
      /model RunEvidence \{[\s\S]*?reviewAttemptId\s+String\?/,
    );
    expect(schema).toMatch(
      /model RunEvidence \{[\s\S]*?codeHash\s+String\?/,
    );
    expect(schema).toMatch(
      /model RunEvidence \{[\s\S]*?executionFingerprint\s+String\?/,
    );
  });

  it("defines the phase-2 synthesis slot model and strategy validation column", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toContain("model SynthesisSlot {");
    expect(schema).toMatch(
      /model SynthesisSlot \{[\s\S]*?@@unique\(\[userId, slot, synthesisKey, memoryOrigin\]\)/,
    );
    expect(schema).toMatch(
      /model L2MemoryFact \{[\s\S]*?validationJson\s+String\s+@default\("\{\}"\)/,
    );
  });

  it("defines the planner daily dose snapshot model", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );

    expect(schema).toMatch(
      /model PlannerPlanItem \{[\s\S]*?deferredFromDate\s+DateTime\?/,
    );
    expect(schema).toContain("model PlannerDailyDoseItem {");
    expect(schema).toMatch(
      /model PlannerDailyDoseItem \{[\s\S]*?@@unique\(\[goalId, doseDate, problemId\]\)/,
    );
  });
});
