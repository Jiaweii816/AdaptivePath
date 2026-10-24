import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import { demoProblems, seedDatabase } from "../../prisma/seed";
import { applyPrismaMigrations } from "./prisma-test-utils";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
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

async function createSeededClient() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-seed-"));
  tempDirs.push(dir);

  const databasePath = join(dir, "seed.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();

  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);

  return prisma;
}

describe("PatternCoach seed data", () => {
  it("seeds try with the default development profile", async () => {
    const prisma = await createSeededClient();

    try {
      const user = await prisma.user.findUnique({
        where: { handle: "try" },
        include: { profile: true },
      });

      expect(user?.handle).toBe("try");
      expect(user?.profile?.displayName).toBe("try");
      expect(JSON.parse(user?.profile?.preferredLanguages ?? "[]")).toEqual([
        "Python",
        "C++",
      ]);
      expect(JSON.parse(user?.profile?.strongPatterns ?? "[]")).toEqual(
        expect.arrayContaining(["HashMap", "Dict", "Array traversal"]),
      );
      expect(JSON.parse(user?.profile?.weakPatterns ?? "[]")).toEqual(
        expect.arrayContaining([
          "Binary Search",
          "Binary Search boundaries",
          "Sliding Window shrink condition",
        ]),
      );
      expect(JSON.parse(user?.profile?.outputPreferences ?? "[]")).toEqual(
        expect.arrayContaining([
          "Pseudocode before full code",
          "Python preferred",
          "C++ supported",
        ]),
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  it("seeds generated Hot-150 rows and preserves full demo problem content", async () => {
    const prisma = await createSeededClient();

    try {
      const problems = await prisma.problem.findMany({
        include: {
          testCases: {
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { leetcodeNumber: "asc" },
      });

      expect(problems).toHaveLength(150);
      expect(
        problems
          .map((problem) => problem.leetcodeNumber)
          .sort((left, right) => (left ?? 0) - (right ?? 0)),
      ).toEqual(
        hot150Problems
          .map((problem) => problem.leetcodeNumber)
          .sort((left, right) => left - right),
      );

      for (const seedProblem of demoProblems) {
        const byNumber = await prisma.problem.findUnique({
          where: { leetcodeNumber: seedProblem.leetcodeNumber },
        });
        const bySlug = await prisma.problem.findUnique({
          where: { slug: seedProblem.slug },
        });
        const byTitle = await prisma.problem.findFirst({
          where: { title: seedProblem.title },
        });
        const byTag = await prisma.problem.findFirst({
          where: { tags: { contains: seedProblem.tags[0] } },
        });

        expect(byNumber?.slug).toBe(seedProblem.slug);
        expect(bySlug?.title).toBe(seedProblem.title);
        expect(byTitle?.methodName).toBe(seedProblem.methodName);
        expect(byTag).toBeTruthy();

        const problem = problems.find(
          (item) => item.slug === seedProblem.slug,
        );

        expect(problem?.isDemoSupported).toBe(true);
        expect(problem?.statementMarkdown).toContain("visible sample/custom tests");
        expect(problem?.starterCodePython).toContain(seedProblem.methodName);
        expect(problem?.starterCodeCpp).toContain(seedProblem.methodName);
        expect(JSON.parse(problem?.tags ?? "[]")).toEqual(
          expect.arrayContaining(seedProblem.tags),
        );
        expect(JSON.parse(problem?.examplesJson ?? "[]").length).toBeGreaterThan(
          0,
        );
        expect(JSON.parse(problem?.constraintsJson ?? "[]").length).toBeGreaterThan(
          0,
        );
        expect(problem?.testCases.length).toBeGreaterThanOrEqual(3);
        expect(problem?.testCases.every((testCase) => testCase.isVisible)).toBe(
          true,
        );
      }

      const nonDemo = await prisma.problem.findUniqueOrThrow({
        where: { slug: "merge-sorted-array" },
        include: {
          testCases: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      expect(nonDemo.isDemoSupported).toBe(false);
      expect(nonDemo.statementMarkdown).toContain("Merge nums1 and nums2");
      expect(nonDemo.localRunStatus).toBe("runnable");
      expect(nonDemo.testCases).toHaveLength(3);
      expect(nonDemo.testCases[0]?.expectedSource).toBe("generated");
      expect(nonDemo.testCases[0]?.gtProvenance).toBe("ac_solution");
      expect(JSON.parse(nonDemo.tags)).toEqual(
        expect.arrayContaining(["array", "string", "top-interview-150"]),
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
