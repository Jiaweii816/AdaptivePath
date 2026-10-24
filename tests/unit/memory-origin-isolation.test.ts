import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  memoryOriginSchema,
  resolveLearnerActivityLedgerOrigins,
  resolveMemoryOrigin,
  resolveMemoryWritePolicy,
} from "@/server/memory/memory-origin";
import { assertSafeDatabaseForProcess } from "@/server/db/sqlite-path";
import {
  assertLocalDatabaseProfileEnvironment,
  databaseUrlForLocalProfile,
  resolveLocalDatabaseProfile,
} from "@/server/db/sqlite-path";
import { resolveLocalUserHandle } from "@/features/onboarding/profile-defaults";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
} from "./memory-test-helpers";

describe("memory origin policy", () => {
  it("fails closed when origin is not explicitly configured", () => {
    expect(resolveMemoryOrigin({})).toBe("legacy_unknown");
    expect(resolveMemoryWritePolicy({})).toEqual({
      origin: "legacy_unknown",
      durableWrites: false,
    });
  });

  it.each(memoryOriginSchema.options.filter((origin) => origin !== "learner"))(
    "does not grant durable writes to %s",
    (origin) => {
      expect(
        resolveMemoryWritePolicy({ PATTERNCOACH_MEMORY_ORIGIN: origin }),
      ).toEqual({ origin, durableWrites: false });
    },
  );

  it("grants durable writes only to explicit learner traffic", () => {
    expect(
      resolveMemoryWritePolicy({ PATTERNCOACH_MEMORY_ORIGIN: "learner" }),
    ).toEqual({ origin: "learner", durableWrites: true });
  });

  it("shows preserved legacy activity only in the real learner ledger", () => {
    expect(
      resolveLearnerActivityLedgerOrigins({
        PATTERNCOACH_MEMORY_ORIGIN: "learner",
      }),
    ).toEqual(["learner", "legacy_unknown"]);
    expect(
      resolveLearnerActivityLedgerOrigins({
        PATTERNCOACH_MEMORY_ORIGIN: "development",
      }),
    ).toEqual(["development"]);
    expect(
      resolveLearnerActivityLedgerOrigins({
        PATTERNCOACH_MEMORY_ORIGIN: "test",
      }),
    ).toEqual(["test"]);
  });

  it("rejects invalid explicit provenance instead of guessing", () => {
    expect(() =>
      resolveMemoryOrigin({ PATTERNCOACH_MEMORY_ORIGIN: "production" }),
    ).toThrow(/must be one of/);
  });

  it("maps origin to an isolated default handle without inferring origin from handle", () => {
    expect(resolveLocalUserHandle({ PATTERNCOACH_MEMORY_ORIGIN: "learner" })).toBe(
      "Iris904",
    );
    expect(
      resolveLocalUserHandle({ PATTERNCOACH_MEMORY_ORIGIN: "development" }),
    ).toBe("try");
    expect(resolveLocalUserHandle({})).toBe("PatternCoachLegacyUnknown");
    expect(
      resolveLocalUserHandle({
        PATTERNCOACH_MEMORY_ORIGIN: "development",
        PATTERNCOACH_LOCAL_USER_HANDLE: "isolated-dev-42",
      }),
    ).toBe("isolated-dev-42");
  });
});

describe("named local database profiles", () => {
  const cwd = "/workspace/patterncoach";

  it("keeps Iris, guest interview, and try development ownership separate", () => {
    expect(resolveLocalDatabaseProfile("iris", cwd)).toMatchObject({
      databasePath: "/workspace/patterncoach/dev.db",
      handle: "Iris904",
      memoryOrigin: "learner",
    });
    expect(resolveLocalDatabaseProfile("guest", cwd)).toMatchObject({
      databasePath: "/home/iris/patterncoach-data/demo/guest.db",
      handle: "guest",
      memoryOrigin: "learner",
    });
    expect(resolveLocalDatabaseProfile("try", cwd)).toMatchObject({
      databasePath: "/home/iris/patterncoach-data/try/try.db",
      handle: "try",
      memoryOrigin: "development",
    });
  });

  it("fails before opening a known database when its profile identity is wrong", () => {
    expect(() =>
      assertLocalDatabaseProfileEnvironment({
        configuredDatabaseUrl: databaseUrlForLocalProfile("iris", cwd),
        env: {
          PATTERNCOACH_MEMORY_ORIGIN: "development",
          PATTERNCOACH_LOCAL_USER_HANDLE: "try",
        },
        cwd,
      }),
    ).toThrow(/iris database requires/);

    expect(() =>
      assertLocalDatabaseProfileEnvironment({
        configuredDatabaseUrl: databaseUrlForLocalProfile("guest", cwd),
        env: {
          PATTERNCOACH_MEMORY_ORIGIN: "learner",
          PATTERNCOACH_LOCAL_USER_HANDLE: "Iris904",
        },
        cwd,
      }),
    ).toThrow(/guest database requires/);
  });

  it("accepts a correctly configured explicit try profile", () => {
    expect(() =>
      assertLocalDatabaseProfileEnvironment({
        configuredDatabaseUrl: databaseUrlForLocalProfile("try", cwd),
        env: {
          PATTERNCOACH_DATABASE_PROFILE: "try",
          PATTERNCOACH_MEMORY_ORIGIN: "development",
          PATTERNCOACH_LOCAL_USER_HANDLE: "try",
        },
        cwd,
      }),
    ).not.toThrow();
  });
});

describe("automated database isolation", () => {
  it("fails fast when a test has no explicit database", () => {
    expect(() =>
      assertSafeDatabaseForProcess({
        env: { NODE_ENV: "test", PATTERNCOACH_MEMORY_ORIGIN: "test" },
        cwd: "/workspace/patterncoach",
      }),
    ).toThrow(/requires an explicit isolated DATABASE_URL/);
  });

  it("fails fast when test or evaluation resolves workspace dev.db", () => {
    for (const origin of ["test", "evaluation"] as const) {
      expect(() =>
        assertSafeDatabaseForProcess({
          configuredDatabaseUrl: "file:./dev.db",
          env: { PATTERNCOACH_MEMORY_ORIGIN: origin },
          cwd: "/workspace/patterncoach",
        }),
      ).toThrow(/cannot use workspace dev\.db/);
    }
  });

  it("does not let a smoke flag write dev.db even if the shell says learner", () => {
    expect(() =>
      assertSafeDatabaseForProcess({
        configuredDatabaseUrl: "file:./dev.db",
        env: {
          PATTERNCOACH_MEMORY_ORIGIN: "learner",
          PATTERNCOACH_SMOKE_RUN: "1",
        },
        cwd: "/workspace/patterncoach",
      }),
    ).toThrow(/cannot use workspace dev\.db/);
  });

  it("accepts an explicit isolated temporary database", () => {
    expect(() =>
      assertSafeDatabaseForProcess({
        configuredDatabaseUrl: `file:${join("/tmp", "patterncoach-test.db")}`,
        env: { NODE_ENV: "test", PATTERNCOACH_MEMORY_ORIGIN: "test" },
        cwd: "/workspace/patterncoach",
      }),
    ).not.toThrow();
  });
});

describe("semantic-memory origin persistence", () => {
  it("rejects caller-supplied provenance that disagrees with a non-test process", async () => {
    const database = await createMemoryTestDb();
    try {
      const { user } = await seedMinimalUserAndProblem(database.prisma);
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("PATTERNCOACH_MEMORY_ORIGIN", "development");
      await expect(
        appendL1TraceEvent(database.prisma, {
          userId: user.id,
          eventType: "chat_user_message",
          memoryOrigin: "learner",
          content: "spoofed origin",
        }),
      ).rejects.toThrow("must match the current process origin");
      expect(await database.prisma.l1MemoryEvent.count()).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      await database.cleanup();
    }
  });

  it("persists origin and promotes traceRunId out of opaque L1 JSON", async () => {
    const database = await createMemoryTestDb();
    try {
      const { user, problem, chatSession } =
        await seedMinimalUserAndProblem(database.prisma);
      const l1 = await appendL1TraceEvent(database.prisma, {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        eventJson: { traceRunId: "root-learner-1", content: "hello" },
        memoryOrigin: "learner",
      });
      const episode = await createMemoryEpisode(database.prisma, {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        kind: "chat_segment",
        title: "Boundary invariant clarified",
        summary: "The learner explained the invariant in their own words.",
        outcome: "resolved",
        tags: ["binary_search"],
        salience: 0.7,
        sourceTraceIds: [l1.id],
        memoryOrigin: "learner",
      });

      expect(l1).toMatchObject({
        memoryOrigin: "learner",
        traceRunId: "root-learner-1",
      });
      expect(episode.memoryOrigin).toBe("learner");
    } finally {
      await database.cleanup();
    }
  });

  it("keeps learner chat state separate from quarantined legacy state", async () => {
    const database = await createMemoryTestDb();
    try {
      const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
      const quarantined = await database.prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          title: "legacy session",
          memoryOrigin: "legacy_unknown",
        },
      });

      const sessions = await database.prisma.chatSession.findMany({
        where: { userId: user.id, problemId: problem.id },
        orderBy: { createdAt: "asc" },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions.map((session) => session.memoryOrigin).sort()).toEqual([
        "learner",
        "legacy_unknown",
      ]);
      expect(quarantined.id).not.toBe(
        sessions.find((session) => session.memoryOrigin === "learner")?.id,
      );
    } finally {
      await database.cleanup();
    }
  });
});
