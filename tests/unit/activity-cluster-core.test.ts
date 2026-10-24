import { afterEach, describe, expect, it } from "vitest";
import {
  claimExtractionReceipt,
  completeExtractionReceipt,
  ensureExtractionReceipt,
  failExtractionReceipt,
  loadSealedActivityClusterInput,
  sealChatOnlyActivityCluster,
  sealReviewActivityCluster,
} from "@/server/memory/activity-clusters";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.map((database) => database.cleanup()));
  databases = [];
});

describe("Activity Cluster core", () => {
  it("seals an explicit chat-only range and gives every source one owner", async () => {
    const fixture = await seedChat("learner", "chat-owner");
    const first = await sealChatOnlyActivityCluster(fixture.prisma, {
      chatSessionId: fixture.chatSessionId,
      startMessageSequence: 1,
      endMessageSequence: 2,
      boundaryReason: "explicit_exit",
    });

    expect(first.cluster.kind).toBe("chat_only");
    expect(first.cluster.status).toBe("sealed");
    expect(first.messageRange).toEqual({ startSequence: 1, endSequence: 2 });
    expect(first.items.map((item) => item.sourceType)).toEqual([
      "chat_message",
      "chat_message",
    ]);
    expect(first.independentEvidenceUnitCount).toBe(1);

    await fixture.prisma.chatMessage.createMany({
      data: [
        chatMessage(fixture.chatSessionId, "learner", 3, "我再问一个问题", 3),
        chatMessage(fixture.chatSessionId, "learner", 4, "继续回答", 4, "assistant"),
      ],
    });
    await expect(
      sealChatOnlyActivityCluster(fixture.prisma, {
        chatSessionId: fixture.chatSessionId,
        startMessageSequence: 2,
        endMessageSequence: 4,
        boundaryReason: "chat_clear",
      }),
    ).rejects.toThrow("activity_source_already_owned_by_another_cluster");
    expect(await fixture.prisma.memoryActivityCluster.count()).toBe(1);
  });

  it("seals one review-rooted failure/chat/repair/pass activity idempotently", async () => {
    const fixture = await seedReviewActivity();
    const args = {
      reviewAttemptId: fixture.reviewAttemptId,
      startMessageSequence: 1,
      endMessageSequence: 3,
      additionalSourceItems: fixture.practiceRunIds.map((sourceId) => ({
        sourceType: "practice_run" as const,
        sourceId,
        evidenceRole: "execution_evidence" as const,
      })),
    };

    const first = await sealReviewActivityCluster(fixture.prisma, args);
    const replay = await sealReviewActivityCluster(fixture.prisma, args);

    expect(replay.cluster.id).toBe(first.cluster.id);
    expect(await fixture.prisma.memoryActivityCluster.count()).toBe(1);
    expect(first.cluster.kind).toBe("review_rooted");
    expect(first.messageRange).toEqual({ startSequence: 1, endSequence: 3 });
    expect(
      first.items.filter((item) =>
        ["practice_run", "run_evidence"].includes(item.sourceType),
      ),
    ).toHaveLength(3);
    // Three executions describe one learning activity, not three recurrences.
    expect(first.independentEvidenceKey).toBe(first.cluster.id);
    expect(first.independentEvidenceUnitCount).toBe(1);
    expect(first.items.some((item) => item.sourceType === "diagnosis_result")).toBe(
      true,
    );
  });

  it("never reloads a mutable current CodeDraft as historical cluster input", async () => {
    const fixture = await seedReviewActivity();
    const sealed = await sealReviewActivityCluster(fixture.prisma, {
      reviewAttemptId: fixture.reviewAttemptId,
      startMessageSequence: 1,
      endMessageSequence: 3,
    });
    const before = sealed.inputHash;
    await fixture.prisma.codeDraft.update({
      where: { id: fixture.codeDraftId },
      data: { content: "# unrelated current editor state\nreturn 'changed'" },
    });

    const loaded = await loadSealedActivityClusterInput(
      fixture.prisma,
      sealed.cluster.id,
    );
    expect(loaded.inputHash).toBe(before);
    const review = loaded.items.find(
      (item) => item.sourceType === "review_attempt",
    );
    expect(review?.payload?.codeSnapshot).toContain("visited.add(node)");
    expect(JSON.stringify(loaded)).not.toContain("unrelated current editor state");
  });

  it("fails closed when an owned source row changes after sealing", async () => {
    const fixture = await seedChat("learner", "immutable");
    const cluster = await sealChatOnlyActivityCluster(fixture.prisma, {
      chatSessionId: fixture.chatSessionId,
      startMessageSequence: 1,
      endMessageSequence: 2,
      boundaryReason: "explicit_exit",
    });
    const message = await fixture.prisma.chatMessage.findFirstOrThrow({
      where: { sessionId: fixture.chatSessionId, sequence: 1 },
    });
    await fixture.prisma.chatMessage.update({
      where: { id: message.id },
      data: { contentMarkdown: "mutated after sealing" },
    });

    await expect(
      loadSealedActivityClusterInput(fixture.prisma, cluster.cluster.id),
    ).rejects.toThrow("activity_item_content_changed");
  });

  it("creates one receipt per extractor version and safely claims/retries it", async () => {
    const fixture = await seedChat("learner", "receipt");
    const cluster = await sealChatOnlyActivityCluster(fixture.prisma, {
      chatSessionId: fixture.chatSessionId,
      startMessageSequence: 1,
      endMessageSequence: 2,
      boundaryReason: "problem_changed",
    });
    const key = {
      activityClusterId: cluster.cluster.id,
      extractorVersion: "activity-memory-v1",
    };

    const queued = await ensureExtractionReceipt(fixture.prisma, key);
    const duplicate = await ensureExtractionReceipt(fixture.prisma, key);
    expect(duplicate.id).toBe(queued.id);
    expect(await fixture.prisma.memoryExtractionReceipt.count()).toBe(1);

    const firstClaim = await claimExtractionReceipt(fixture.prisma, key);
    const competingClaim = await claimExtractionReceipt(fixture.prisma, key);
    expect(firstClaim.claimed).toBe(true);
    expect(competingClaim.claimed).toBe(false);
    await failExtractionReceipt(fixture.prisma, {
      receiptId: queued.id,
      errorMessage: "provider unavailable",
    });

    const retry = await claimExtractionReceipt(fixture.prisma, key);
    expect(retry.claimed).toBe(true);
    const completed = await completeExtractionReceipt(fixture.prisma, {
      receiptId: queued.id,
      status: "succeeded",
      outputHash: "output-v1",
    });
    expect(completed.status).toBe("succeeded");
    await expect(
      failExtractionReceipt(fixture.prisma, {
        receiptId: queued.id,
        errorMessage: "late worker",
      }),
    ).rejects.toThrow("extraction_receipt_not_running");
  });

  it("records no-semantic-signal as an explicit terminal extraction result", async () => {
    const fixture = await seedChat("learner", "no-signal");
    const cluster = await sealChatOnlyActivityCluster(fixture.prisma, {
      chatSessionId: fixture.chatSessionId,
      startMessageSequence: 1,
      endMessageSequence: 2,
      boundaryReason: "workbench_navigation",
    });
    const key = {
      activityClusterId: cluster.cluster.id,
      extractorVersion: "activity-memory-v1",
    };
    const claimed = await claimExtractionReceipt(fixture.prisma, key);
    expect(claimed.claimed).toBe(true);
    const completed = await completeExtractionReceipt(fixture.prisma, {
      receiptId: claimed.receipt.id,
      status: "no_semantic_signal",
      noSemanticReason: "navigation_only",
    });

    expect(completed).toMatchObject({
      status: "no_semantic_signal",
      noSemanticReason: "navigation_only",
    });
  });

  it("records a terminal policy receipt for every non-learner cluster", async () => {
    const fixture = await seedChat("development", "policy");
    const cluster = await sealChatOnlyActivityCluster(fixture.prisma, {
      chatSessionId: fixture.chatSessionId,
      startMessageSequence: 1,
      endMessageSequence: 2,
      boundaryReason: "stale_idle",
    });
    const key = {
      activityClusterId: cluster.cluster.id,
      extractorVersion: "activity-memory-v1",
    };

    const receipt = await ensureExtractionReceipt(fixture.prisma, key);
    const claim = await claimExtractionReceipt(fixture.prisma, key);
    expect(receipt.status).toBe("policy_rejected");
    expect(receipt.noSemanticReason).toBe(
      "memory_origin_not_learner:development",
    );
    expect(receipt.completedAt).not.toBeNull();
    expect(claim.claimed).toBe(false);
  });
});

async function seedChat(origin: "learner" | "development", suffix: string) {
  const database = await newDatabase();
  const user = await database.prisma.user.create({
    data: { handle: `activity-${suffix}` },
  });
  const problem = await database.prisma.problem.create({
    data: {
      slug: `graph-${suffix}`,
      title: "Graph DFS",
      statementMarkdown: "Traverse a graph.",
      methodName: "dfs",
      tags: JSON.stringify(["graph"]),
    },
  });
  const session = await database.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: origin,
      title: problem.title,
    },
  });
  await database.prisma.chatMessage.createMany({
    data: [
      chatMessage(session.id, origin, 1, "我上次在图 DFS 哪里栽坑？", 1),
      chatMessage(
        session.id,
        origin,
        2,
        "上次遗漏了 visited 标记。",
        2,
        "assistant",
      ),
    ],
  });
  return {
    prisma: database.prisma,
    chatSessionId: session.id,
  };
}

async function seedReviewActivity() {
  const database = await newDatabase();
  const user = await database.prisma.user.create({
    data: { handle: "activity-review" },
  });
  const problem = await database.prisma.problem.create({
    data: {
      slug: "graph-review",
      title: "Graph DFS",
      statementMarkdown: "Traverse a graph.",
      methodName: "dfs",
      tags: JSON.stringify(["graph"]),
    },
  });
  const session = await database.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      title: problem.title,
    },
  });
  const codeDraft = await database.prisma.codeDraft.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      language: "Python",
      content: "visited.add(node)",
    },
  });
  const practiceRuns = await Promise.all(
    [1, 2].map((runOrdinal) =>
      database.prisma.practiceRunLog.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          codeDraftId: codeDraft.id,
          language: "Python",
          codeSnapshot: `def dfs(node):\n    # missing visited ${runOrdinal}`,
          codeHash: `failed-hash-${runOrdinal}`,
          executionFingerprint: `failed-fingerprint-${runOrdinal}`,
          runOrdinal,
          status: "failed",
          passedCount: 0,
          totalCount: 1,
          summary: "failed visible test",
          provider: "local_hot150",
        },
      }),
    ),
  );
  await database.prisma.chatMessage.createMany({
    data: [
      chatMessage(session.id, "learner", 1, "为什么一直重复访问？", 10),
      chatMessage(
        session.id,
        "learner",
        2,
        "检查节点第一次进入时是否标记 visited。",
        11,
        "assistant",
      ),
    ],
  });
  const review = await database.prisma.reviewAttempt.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: session.id,
      codeDraftId: codeDraft.id,
      language: "Python",
      codeSnapshot: "def dfs(node):\n    visited.add(node)",
      memoryOrigin: "learner",
    },
  });
  await database.prisma.chatMessage.create({
    data: {
      ...chatMessage(
        session.id,
        "learner",
        3,
        "这次通过了可见测试。",
        14,
        "assistant",
      ),
      reviewAttemptId: review.id,
    },
  });
  await database.prisma.runEvidence.create({
    data: {
      reviewAttemptId: review.id,
      chatSessionId: session.id,
      source: "review",
      codeHash: "passed-hash",
      executionFingerprint: "passed-fingerprint",
      status: "passed_visible_tests",
      passedCount: 1,
      failedCount: 0,
      memoryOrigin: "learner",
    },
  });
  await database.prisma.diagnosisResult.create({
    data: {
      reviewAttemptId: review.id,
      diagnosisJson: JSON.stringify({ issue: "visited was missing" }),
      userIssueSummary: "The failed revision omitted visited marking.",
      coachSummary: "The learner repaired it after a state-invariant hint.",
    },
  });
  return {
    prisma: database.prisma,
    reviewAttemptId: review.id,
    practiceRunIds: practiceRuns.map((run) => run.id),
    codeDraftId: codeDraft.id,
  };
}

function chatMessage(
  sessionId: string,
  memoryOrigin: string,
  sequence: number,
  contentMarkdown: string,
  secondOffset: number,
  role = "user",
) {
  return {
    sessionId,
    memoryOrigin,
    sequence,
    role,
    contentMarkdown,
    createdAt: new Date(`2026-07-20T12:00:${String(secondOffset).padStart(2, "0")}Z`),
  };
}

async function newDatabase() {
  const database = await createMemoryTestDb();
  databases.push(database);
  return database;
}
