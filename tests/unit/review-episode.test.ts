import { afterEach, describe, expect, it } from "vitest";
import { buildReviewEpisode } from "@/server/memory/consolidation/write-review-episode";
import {
  createMemoryEpisode,
  listRecentEpisodes,
} from "@/server/memory/store/episode-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("review episode", () => {
  it("builds a deterministic episode from diagnosis + run result", () => {
    const episode = buildReviewEpisode({
      problemTitle: "Binary Search",
      problemTags: ["binary_search", "array"],
      attemptOrdinal: 2,
      runResult: { status: "failed", passedCount: 1, failedCount: 2 },
      evidenceScope: "local_visible",
      diagnosis: {
        userIssueSummary: "Right boundary excludes the answer.",
        coachSummary: "Walk through the invariant before moving pointers.",
        mistakeTags: ["off_by_one"],
      },
      sourceTraceIds: ["t1", "t2"],
    });

    expect(episode.kind).toBe("review");
    expect(episode.outcome).toBe("failed");
    expect(episode.salience).toBe(0.7);
    expect(episode.title).toBe("Binary Search review #2: needs revision");
    expect(episode.summary).toContain("Right boundary");
    expect(episode.summary).toContain("selected local visible tests only");
    expect(episode.summary).toContain("not an official LeetCode verdict");
    expect(episode.tags).toEqual(["binary_search", "array", "off_by_one"]);
  });

  it("does not persist blocked development labels in episode text or tags", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);

    const created = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      kind: "review",
      title: "Search Insert: no_search_logic",
      summary:
        "The run has unimplemented search logic, a hardcoded return, and returns a constant value. 搜索逻辑尚未实现；搜尋邏輯尚未實現；检索功能还没做；檢索功能還沒做；把返回值写死了；把返回值寫死了；直接返回固定值。",
      outcome: "failed",
      tags: [
        "array",
        "no_search_logic",
        "hardcoded-return",
        "search_implementation",
        "hard coded return",
        "搜索逻辑未完成",
        "搜尋功能還沒寫",
        "返回固定值",
        "回傳固定值",
      ],
      salience: 0.7,
      sourceTraceIds: ["trace-noise"],
    });

    expect(`${created.title} ${created.summary}`).not.toMatch(
      /no_search_logic|unimplemented search logic|hardcoded return|returns a constant value|搜索逻辑尚未实现|搜尋邏輯尚未實現|检索功能还没做|檢索功能還沒做|把返回值写死了|把返回值寫死了|直接返回固定值/i,
    );
    expect(JSON.parse(created.tags)).toEqual(["array"]);
  });

  it("passed runs produce a lower-salience passed episode", () => {
    const episode = buildReviewEpisode({
      problemTitle: "Binary Search",
      problemTags: ["binary_search"],
      attemptOrdinal: 1,
      runResult: {
        status: "passed_visible_tests",
        passedCount: 3,
        failedCount: 0,
      },
      diagnosis: {
        userIssueSummary: "",
        coachSummary: "Clean pass.",
        mistakeTags: [],
      },
      sourceTraceIds: ["t1"],
    });

    expect(episode.outcome).toBe("passed");
    expect(episode.salience).toBe(0.4);
  });

  it("persists and lists episodes", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const created = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      kind: "review",
      title: "t",
      summary: "s",
      outcome: "failed",
      tags: ["binary_search"],
      salience: 0.7,
      sourceTraceIds: ["t1"],
    });

    const listed = await listRecentEpisodes(db.prisma, {
      userId: user.id,
      limit: 5,
    });

    expect(listed[0]?.id).toBe(created.id);
  });
});
