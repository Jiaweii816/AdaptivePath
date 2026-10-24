import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  materializeMemoryClaimObservation,
  upsertMemoryClaimObservation,
} from "@/server/memory/claims/open-world-claim-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
let db: MemoryTestDb;

beforeAll(async () => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
  db = await createMemoryTestDb();
});

beforeEach(async () => {
  await db.prisma.memoryEvidenceContribution.deleteMany();
  await db.prisma.memoryClaimRelation.deleteMany();
  await db.prisma.memoryClaimObservation.deleteMany();
  await db.prisma.memoryExtractionReceipt.deleteMany();
  await db.prisma.memoryActivityItem.deleteMany();
  await db.prisma.memoryActivityCluster.deleteMany();
  await db.prisma.l2MemoryFact.deleteMany();
  await db.prisma.l1MemoryEvent.deleteMany();
  await db.prisma.chatSession.deleteMany();
  await db.prisma.problem.deleteMany();
  await db.prisma.user.deleteMany();
});

afterAll(async () => {
  await db.cleanup();
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("open-world claim ledger", () => {
  it("upserts the same observation idempotently inside one activity", async () => {
    const fixture = await seedFixture();
    const input = observationInput(fixture, {
      claimText: "在图遍历中曾遗漏 visited 状态标记。",
    });

    const first = await upsertMemoryClaimObservation(db.prisma, input);
    const replay = await upsertMemoryClaimObservation(db.prisma, input);

    expect(replay.id).toBe(first.id);
    await expect(db.prisma.memoryClaimObservation.count()).resolves.toBe(1);
  });

  it("materializes an unknown natural-language mechanism without a canonical key", async () => {
    const fixture = await seedFixture();
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(fixture, {
        claimText: "The learner mixed up a custom frobnicate anchor label.",
        scope: { level: "mechanism", problemIds: [], topicHints: [] },
        mechanismKeys: [],
      }),
    );
    const trace = await createLearnerTrace(fixture, "chat_user_message");

    const result = await materializeMemoryClaimObservation(db.prisma, {
      observationId: observation.id,
      evidence: [evidence(trace.id)],
    });

    expect(result.fact).toMatchObject({
      claimText: "The learner mixed up a custom frobnicate anchor label.",
      mechanismKeysJson: "[]",
      integrityVersion: 2,
      status: "candidate",
      evidenceCount: 1,
    });
    const validation = JSON.parse(result.fact!.validationJson) as {
      integrity: { version: number };
      claimIntegrity: { version: number; mechanismKeys: string[] };
    };
    expect(validation.integrity.version).toBe(1);
    expect(validation.claimIntegrity).toMatchObject({
      version: 2,
      mechanismKeys: [],
    });
  });

  it("never counts replay or multiple evidence rows from one activity twice", async () => {
    const fixture = await seedFixture();
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(fixture),
    );
    const firstTrace = await createLearnerTrace(fixture, "run_evidence");
    const secondTrace = await createLearnerTrace(fixture, "chat_user_message");
    const input = {
      observationId: observation.id,
      evidence: [
        evidence(firstTrace.id, "execution_failure"),
        evidence(secondTrace.id, "learner_statement"),
      ],
    };

    const first = await materializeMemoryClaimObservation(db.prisma, input);
    const replay = await materializeMemoryClaimObservation(db.prisma, input);

    expect(first.fact?.evidenceCount).toBe(1);
    expect(replay.fact?.evidenceCount).toBe(1);
    await expect(
      db.prisma.memoryEvidenceContribution.count(),
    ).resolves.toBe(2);
  });

  it("activates a non-preference claim only after two independent activities", async () => {
    const fixture = await seedFixture();
    const first = await createMaterializedClaim(fixture);
    expect(first.fact?.status).toBe("candidate");

    const secondCluster = await createCluster(fixture, "activity-2");
    const secondObservation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput({ ...fixture, cluster: secondCluster }),
    );
    const secondTrace = await createLearnerTrace(fixture, "chat_user_message");
    const reinforced = await materializeMemoryClaimObservation(db.prisma, {
      observationId: secondObservation.id,
      relation: {
        targetClusterFactId: first.fact!.id,
        relation: "reinforces",
        modelConfidence: 0.91,
      },
      evidence: [evidence(secondTrace.id)],
    });

    expect(reinforced.fact).toMatchObject({ status: "active", evidenceCount: 2 });
  });

  it("accumulates evidence across two problems that share one canonical mechanism", async () => {
    const fixture = await seedFixture();
    const otherProblem = await db.prisma.problem.create({
      data: {
        slug: "house-robber",
        title: "House Robber",
        methodName: "rob",
        tags: JSON.stringify(["array", "dynamic_programming"]),
      },
    });
    const otherSession = await db.prisma.chatSession.create({
      data: {
        userId: fixture.user.id,
        problemId: otherProblem.id,
        memoryOrigin: "learner",
      },
    });
    const otherFixture = {
      ...fixture,
      problem: otherProblem,
      chatSession: otherSession,
      cluster: await createCluster(
        { ...fixture, problem: otherProblem, chatSession: otherSession },
        "activity-dp-2",
      ),
    };

    for (const current of [fixture, otherFixture]) {
      const observation = await upsertMemoryClaimObservation(
        db.prisma,
        observationInput(current, {
          claimType: "strength",
          claimText: `On ${current.problem.title}, the learner defined the dp state and transition correctly.`,
          polarity: "positive",
          scope: { level: "mechanism", problemIds: [], topicHints: [] },
          mechanismKeys: ["dynamic_programming_state_transition"],
        }),
      );
      const trace = await createLearnerTrace(current, "run_evidence");
      await materializeMemoryClaimObservation(db.prisma, {
        observationId: observation.id,
        evidence: [
          evidence(trace.id, "execution_success", "verified"),
        ],
      });
    }

    const facts = await db.prisma.l2MemoryFact.findMany({
      where: { userId: fixture.user.id, source: "memory_agent_claim" },
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ evidenceCount: 2, status: "active" });
    // The mechanism lives in mechanismKeysJson; `tag` is derived from the
    // clusterKey so it cannot collide on the legacy unique index.
    expect(facts[0].mechanismKeysJson).toContain(
      "dynamic_programming_state_transition",
    );
  });

  it("keeps two polarities of one mechanism as separate clusters", async () => {
    const fixture = await seedFixture();
    const shared = {
      scope: { level: "mechanism" as const, problemIds: [], topicHints: [] },
      mechanismKeys: ["binary_search_invariant"],
    };

    for (const variant of [
      { claimType: "knowledge_state" as const, polarity: "positive" as const },
      { claimType: "knowledge_state" as const, polarity: "negative" as const },
    ]) {
      const observation = await upsertMemoryClaimObservation(
        db.prisma,
        observationInput(fixture, {
          ...shared,
          claimType: variant.claimType,
          polarity: variant.polarity,
          claimText: `Binary search interval handling was ${variant.polarity}.`,
        }),
      );
      const trace = await createLearnerTrace(fixture, "run_evidence");
      await materializeMemoryClaimObservation(db.prisma, {
        observationId: observation.id,
        evidence: [evidence(trace.id, "execution_success", "verified")],
      });
    }

    const facts = await db.prisma.l2MemoryFact.findMany({
      where: { userId: fixture.user.id, source: "memory_agent_claim" },
    });
    expect(facts).toHaveLength(2);
    expect(new Set(facts.map((fact) => fact.tag)).size).toBe(2);
  });

  it("bridges a canonical observation onto a legacy replay fact", async () => {
    const fixture = await seedFixture();
    const trusted = trustedL2FactFixture({
      mechanism: "dynamic_programming_state_transition",
      humanLabel: "DP state transition",
      clusterCount: 2,
    });
    const legacy = await db.prisma.l2MemoryFact.create({
      data: {
        userId: fixture.user.id,
        factType: "strength",
        tag: "dynamic_programming_state_transition",
        label: "DP state transition",
        value: "DP state transition",
        confidence: 0.82,
        evidenceCount: 2,
        lastEvidenceSummary: "Historical replay evidence",
        status: "active",
        source: "historical_replay",
        memoryOrigin: "learner",
        evidenceTraceIds: "[]",
        validationJson: trusted.validationJson,
        integrityVersion: 1,
      },
    });
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(fixture, {
        claimType: "strength",
        claimText: "The learner again wrote the DP transition correctly.",
        polarity: "positive",
        scope: { level: "mechanism", problemIds: [], topicHints: [] },
        mechanismKeys: ["dynamic_programming_state_transition"],
      }),
    );
    const trace = await createLearnerTrace(fixture, "run_evidence");

    const result = await materializeMemoryClaimObservation(db.prisma, {
      observationId: observation.id,
      evidence: [evidence(trace.id, "execution_success", "verified")],
    });
    const facts = await db.prisma.l2MemoryFact.findMany({
      where: { userId: fixture.user.id },
    });

    expect(facts).toHaveLength(1);
    expect(result.fact).toMatchObject({
      id: legacy.id,
      evidenceCount: 3,
      status: "active",
      integrityVersion: 2,
      clusterKey:
        "claim:v2:capability_positive:positive:dynamic_programming_state_transition:mechanism",
    });
  });

  it("reinforces the same negative capability when claimType drifts from knowledge_state to weakness", async () => {
    const fixture = await seedFixture();
    const first = await createMaterializedClaim(fixture, {
      claimType: "knowledge_state",
      claimText: "Visited-state timing was not yet stable in graph DFS.",
      polarity: "negative",
    });
    const secondCluster = await createCluster(fixture, "activity-type-drift-2");
    const secondObservation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(
        { ...fixture, cluster: secondCluster },
        {
          claimType: "weakness",
          claimText: "Visited-state timing remains fragile in graph DFS.",
          polarity: "negative",
        },
      ),
    );
    const trace = await createLearnerTrace(fixture, "run_evidence");
    const reinforced = await materializeMemoryClaimObservation(db.prisma, {
      observationId: secondObservation.id,
      relation: {
        targetClusterFactId: first.fact!.id,
        relation: "reinforces",
      },
      evidence: [evidence(trace.id, "execution_failure", "verified")],
    });

    expect(reinforced.fact).toMatchObject({
      id: first.fact!.id,
      status: "active",
      evidenceCount: 2,
    });
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(1);
  });

  it("requires distinct problems before activating a cross-problem claim", async () => {
    const fixture = await seedFixture();
    const first = await createMaterializedClaim(fixture, {
      scope: {
        level: "cross_problem",
        problemIds: [fixture.problem.id],
        topicHints: ["graph DFS"],
      },
    });
    const sameProblemCluster = await createCluster(fixture, "activity-2");
    const secondObservation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(
        { ...fixture, cluster: sameProblemCluster },
        {
          scope: {
            level: "cross_problem",
            problemIds: [fixture.problem.id],
            topicHints: ["graph DFS"],
          },
        },
      ),
    );
    const secondTrace = await createLearnerTrace(fixture, "chat_user_message");
    const stillCandidate = await materializeMemoryClaimObservation(db.prisma, {
      observationId: secondObservation.id,
      relation: {
        targetClusterFactId: first.fact!.id,
        relation: "reinforces",
      },
      evidence: [evidence(secondTrace.id)],
    });
    expect(stillCandidate.fact?.status).toBe("candidate");

    const otherProblem = await db.prisma.problem.create({
      data: {
        slug: "number-of-islands",
        title: "Number of Islands",
        methodName: "numIslands",
        tags: JSON.stringify(["graph", "depth_first_search"]),
      },
    });
    const otherSession = await db.prisma.chatSession.create({
      data: {
        userId: fixture.user.id,
        problemId: otherProblem.id,
        memoryOrigin: "learner",
      },
    });
    const otherFixture = {
      ...fixture,
      problem: otherProblem,
      chatSession: otherSession,
      cluster: await db.prisma.memoryActivityCluster.create({
        data: {
          userId: fixture.user.id,
          problemId: otherProblem.id,
          chatSessionId: otherSession.id,
          clusterKind: "chat_segment",
          sourceKey: "activity-3",
          status: "sealed",
          memoryOrigin: "learner",
          startedAt: new Date(),
        },
      }),
    };
    const thirdObservation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(otherFixture, {
        scope: {
          level: "cross_problem",
          problemIds: [otherProblem.id],
          topicHints: ["graph DFS"],
        },
      }),
    );
    const thirdTrace = await createLearnerTrace(otherFixture, "run_evidence");
    const activated = await materializeMemoryClaimObservation(db.prisma, {
      observationId: thirdObservation.id,
      relation: {
        targetClusterFactId: first.fact!.id,
        relation: "reinforces",
      },
      evidence: [evidence(thirdTrace.id, "execution_failure")],
    });
    expect(activated.fact).toMatchObject({ status: "active", evidenceCount: 3 });
  });

  it("activates one explicitly stated preference", async () => {
    const fixture = await seedFixture();
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(fixture, {
        claimType: "preference",
        claimText: "用户希望先收到最小提示，不要直接展示完整答案。",
        polarity: "neutral",
        evidenceStrength: "user_explicit",
      }),
    );
    const trace = await createLearnerTrace(fixture, "memory_note");
    const result = await materializeMemoryClaimObservation(db.prisma, {
      observationId: observation.id,
      evidence: [evidence(trace.id, "learner_statement", "explicit")],
    });

    expect(result.fact).toMatchObject({
      factType: "preference",
      status: "active",
      confidence: 0.9,
    });
  });

  it("keeps assistant-only context in the observation but out of L2 evidence", async () => {
    const fixture = await seedFixture();
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(fixture),
    );
    const trace = await createLearnerTrace(fixture, "chat_reply");
    const result = await materializeMemoryClaimObservation(db.prisma, {
      observationId: observation.id,
      evidence: [evidence(trace.id, "assistant_context", "context_only")],
    });

    expect(result).toMatchObject({
      fact: null,
      rejectionReason: "assistant_only_evidence",
    });
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(0);
    await expect(
      db.prisma.memoryClaimObservation.findUniqueOrThrow({
        where: { id: observation.id },
      }),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  it("rejects an equivalent relation with opposite polarity instead of merging", async () => {
    const fixture = await seedFixture();
    const first = await createMaterializedClaim(fixture);
    const secondCluster = await createCluster(fixture, "activity-2");
    const observation = await upsertMemoryClaimObservation(
      db.prisma,
      observationInput(
        { ...fixture, cluster: secondCluster },
        {
          claimType: "strength",
          claimText: "能够稳定维护 visited 状态。",
          polarity: "positive",
        },
      ),
    );
    const trace = await createLearnerTrace(fixture, "run_evidence");
    const result = await materializeMemoryClaimObservation(db.prisma, {
      observationId: observation.id,
      relation: {
        targetClusterFactId: first.fact!.id,
        relation: "equivalent",
        modelConfidence: 0.99,
      },
      evidence: [evidence(trace.id, "execution_success", "verified")],
    });

    expect(result).toMatchObject({
      fact: null,
      rejectionReason: "claim_relation_polarity_mismatch",
    });
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(1);
  });
});

async function seedFixture() {
  const base = await seedMinimalUserAndProblem(db.prisma);
  const cluster = await createCluster(base, "activity-1");
  return { ...base, cluster };
}

async function createCluster(
  fixture: Awaited<ReturnType<typeof seedMinimalUserAndProblem>>,
  sourceKey: string,
) {
  return db.prisma.memoryActivityCluster.create({
    data: {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      clusterKind: "chat_segment",
      sourceKey,
      status: "sealed",
      memoryOrigin: "learner",
      startedAt: new Date(),
    },
  });
}

function observationInput(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  overrides: Partial<Parameters<typeof upsertMemoryClaimObservation>[1]> = {},
): Parameters<typeof upsertMemoryClaimObservation>[1] {
  return {
    userId: fixture.user.id,
    activityClusterId: fixture.cluster.id,
    problemId: fixture.problem.id,
    claimType: "weakness",
    claimText: "图 DFS 中的 visited 状态维护曾出现遗漏。",
    polarity: "negative",
    scope: {
      level: "mechanism",
      problemIds: [fixture.problem.id],
      topicHints: ["graph DFS", "visited state"],
    },
    mechanismKeys: [],
    source: "memory_agent_activity_extraction",
    evidenceStrength: "observed",
    ...overrides,
  };
}

async function createLearnerTrace(
  fixture: {
    user: { id: string };
    problem: { id: string };
    chatSession: { id: string };
  },
  eventType: string,
) {
  return db.prisma.l1MemoryEvent.create({
    data: {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      eventType,
      memoryOrigin: "learner",
    },
  });
}

function evidence(
  traceId: string,
  evidenceRole:
    | "learner_statement"
    | "execution_failure"
    | "execution_success"
    | "assisted_repair"
    | "self_correction"
    | "assistant_context" = "learner_statement",
  authority: "explicit" | "verified" | "observed" | "context_only" =
    "observed",
) {
  return {
    evidenceRole,
    authority,
    revisionKey: "revision-1",
    evidenceTraceIds: [traceId],
  };
}

async function createMaterializedClaim(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  overrides: Partial<Parameters<typeof upsertMemoryClaimObservation>[1]> = {},
) {
  const observation = await upsertMemoryClaimObservation(
    db.prisma,
    observationInput(fixture, overrides),
  );
  const trace = await createLearnerTrace(fixture, "run_evidence");
  return materializeMemoryClaimObservation(db.prisma, {
    observationId: observation.id,
    evidence: [evidence(trace.id, "execution_failure", "verified")],
  });
}
