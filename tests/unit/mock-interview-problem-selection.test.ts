import { afterEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { selectMockInterviewProblem } from "@/server/mock-interview/mock-interview-utils";
import { createMemoryTestDb } from "./memory-test-helpers";

const originalProvider = process.env.CODE_RUNNER_PROVIDER;
const originalSession = process.env.LEETCODE_SESSION;

afterEach(() => {
  restoreEnv("CODE_RUNNER_PROVIDER", originalProvider);
  restoreEnv("LEETCODE_SESSION", originalSession);
});

describe("mock interview problem selection", () => {
  it("allows runnable local Hot-150 problems when no LeetCode session is present", async () => {
    process.env.CODE_RUNNER_PROVIDER = "lc";
    delete process.env.LEETCODE_SESSION;
    const db = await createMemoryTestDb();

    try {
      await seedDatabase(db.prisma);

      const problem = await selectMockInterviewProblem(db.prisma, {
        problemSlug: "merge-sorted-array",
      });

      expect(problem.slug).toBe("merge-sorted-array");
      expect(problem.localRunStatus).toBe("runnable");
    } finally {
      await db.cleanup();
    }
  });

  it("falls back to a demo problem in local mode", async () => {
    delete process.env.CODE_RUNNER_PROVIDER;
    delete process.env.LEETCODE_SESSION;
    const db = await createMemoryTestDb();

    try {
      await seedDatabase(db.prisma);
      const problem = await selectMockInterviewProblem(db.prisma, {});

      expect(problem.isDemoSupported).toBe(true);
      expect(problem.slug).toBe("longest-substring-without-repeating-characters");
    } finally {
      await db.cleanup();
    }
  });

  it("uses the Interview Hot 150 catalog order in LeetCode mode", async () => {
    process.env.CODE_RUNNER_PROVIDER = "lc";
    process.env.LEETCODE_SESSION = "fake-session";
    const db = await createMemoryTestDb();

    try {
      await seedDatabase(db.prisma);
      const problem = await selectMockInterviewProblem(db.prisma, {});

      expect(problem.slug).toBe("merge-sorted-array");
      expect(problem.leetcodeNumber).toBe(88);
    } finally {
      await db.cleanup();
    }
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
