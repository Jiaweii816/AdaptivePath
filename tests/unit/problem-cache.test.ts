import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LcAuthError } from "@/server/tools/leetcode-api/lc-api-client";
import { getOrFetchProblem } from "@/server/problems/hot150-problem-cache";
import { seedDatabase } from "../../prisma/seed";
import { applyPrismaMigrations } from "./prisma-test-utils";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;
const tempDirs: string[] = [];
const originalSession = process.env.LEETCODE_SESSION;

afterEach(() => {
  if (originalSession === undefined) {
    delete process.env.LEETCODE_SESSION;
  } else {
    process.env.LEETCODE_SESSION = originalSession;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("getOrFetchProblem", () => {
  it("uses generated local Hot-150 content without a LeetCode session", async () => {
    delete process.env.LEETCODE_SESSION;
    const prisma = await createSeededClient();

    try {
      const problem = await getOrFetchProblem("merge-sorted-array", prisma);

      expect(problem.localRunStatus).toBe("runnable");
      expect(problem.statementMarkdown).toContain("Merge nums1 and nums2");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("requires explicit remote opt-in when local generated content is missing", async () => {
    delete process.env.LEETCODE_SESSION;
    const prisma = await createSeededClient();

    try {
      await prisma.problem.update({
        where: { slug: "merge-sorted-array" },
        data: { statementMarkdown: "" },
      });

      await expect(getOrFetchProblem("merge-sorted-array", prisma)).rejects.toBeInstanceOf(
        LcAuthError,
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("fetches, caches, and reuses LeetCode problem content", async () => {
    const prisma = await createSeededClient();
    const getProblem = vi.fn().mockResolvedValue({
      questionId: "88",
      questionFrontendId: "88",
      title: "Merge Sorted Array",
      titleSlug: "merge-sorted-array",
      content: "<p>Merge two sorted arrays.</p>",
      difficulty: "Easy",
      topicTags: [{ name: "Array", slug: "array" }],
      codeSnippets: [
        { lang: "Python3", langSlug: "python3", code: "class Solution:\n    pass" },
        { lang: "C++", langSlug: "cpp", code: "class Solution {};" },
      ],
      exampleTestcases: "[1,2,3,0,0,0]\n3\n[2,5,6]\n3",
      metaData: JSON.stringify({
        name: "merge",
        params: [
          { name: "nums1", type: "integer[]" },
          { name: "m", type: "integer" },
          { name: "nums2", type: "integer[]" },
          { name: "n", type: "integer" },
        ],
      }),
    });

    try {
      await prisma.problem.update({
        where: { slug: "merge-sorted-array" },
        data: { statementMarkdown: "" },
      });
      const fetched = await getOrFetchProblem("merge-sorted-array", prisma, {
        client: { getProblem },
      });
      const cached = await getOrFetchProblem("merge-sorted-array", prisma, {
        client: {
          getProblem: vi.fn().mockRejectedValue(new Error("should not refetch")),
        },
      });
      const tests = await prisma.problemTestCase.findMany({
        where: { problemId: fetched.id, source: "lc_example" },
      });

      expect(fetched.statementMarkdown).toContain("Merge two sorted arrays.");
      expect(cached.id).toBe(fetched.id);
      expect(getProblem).toHaveBeenCalledTimes(1);
      expect(tests).toHaveLength(1);
      expect(JSON.parse(tests[0]?.inputJson ?? "{}")).toEqual({
        m: 3,
        n: 3,
        nums1: [1, 2, 3, 0, 0, 0],
        nums2: [2, 5, 6],
      });
      expect(JSON.parse(tests[0]?.metadataJson ?? "{}")).toEqual({
        dataInput: "[1,2,3,0,0,0]\n3\n[2,5,6]\n3",
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createSeededClient() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-problem-cache-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "problem-cache.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}
