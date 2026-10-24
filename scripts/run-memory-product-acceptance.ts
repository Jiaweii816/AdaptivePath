import { resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import { runReflection } from "@/server/agents/memory-agent/tasks/reflect";
import { createFtsStore } from "@/server/memory/store/fts-store";

const USER_HANDLE = "PatternCoachAcceptance";
const BROWSER_INSTANCE_ID = "memory-product-acceptance-browser";

const scenarios = [
  {
    name: "weakness-a",
    problemSlug: "search-insert-position",
    expectedStatus: "failed",
    mechanism: "binary_search_invariant",
    polarity: "weakness" as const,
    code: [
      "class Solution:",
      "    def searchInsert(self, nums, target):",
      "        left, right = 0, len(nums) - 1",
      "        while left <= right:",
      "            mid = (left + right) // 2",
      "            if nums[mid] < target:",
      "                left = mid + 1",
      "            else:",
      "                right = mid - 2",
      "        return left",
    ].join("\n"),
    userQuestion:
      "Please review the binary-search interval invariant. I suspect one boundary update skips a still-possible answer.",
  },
  {
    name: "weakness-b",
    problemSlug: "search-in-rotated-sorted-array",
    expectedStatus: "failed",
    mechanism: "binary_search_invariant",
    polarity: "weakness" as const,
    code: [
      "class Solution:",
      "    def search(self, nums, target):",
      "        left, right = 0, len(nums) - 1",
      "        while left <= right:",
      "            mid = (left + right) // 2",
      "            if nums[mid] == target:",
      "                return mid",
      "            if nums[left] <= nums[mid]:",
      "                if nums[left] <= target < nums[mid]:",
      "                    right = mid - 2",
      "                else:",
      "                    left = mid + 1",
      "            else:",
      "                if nums[mid] < target <= nums[right]:",
      "                    left = mid + 1",
      "                else:",
      "                    right = mid - 2",
      "        return -1",
    ].join("\n"),
    userQuestion:
      "Please review the same binary-search interval invariant. I think my right-boundary movement can discard the target.",
  },
  {
    name: "strength-a",
    problemSlug: "climbing-stairs",
    expectedStatus: "passed_visible_tests",
    mechanism: "dynamic_programming_state_transition",
    polarity: "strength" as const,
    code: [
      "class Solution:",
      "    def climbStairs(self, n):",
      "        if n <= 2:",
      "            return n",
      "        dp = [0] * (n + 1)",
      "        dp[1], dp[2] = 1, 2",
      "        for step in range(3, n + 1):",
      "            dp[step] = dp[step - 1] + dp[step - 2]",
      "        return dp[n]",
    ].join("\n"),
    userQuestion:
      "Review whether this DP state definition and transition stay consistent with the visible evidence.",
  },
  {
    name: "strength-b",
    problemSlug: "house-robber",
    expectedStatus: "passed_visible_tests",
    mechanism: "dynamic_programming_state_transition",
    polarity: "strength" as const,
    code: [
      "class Solution:",
      "    def rob(self, nums):",
      "        if not nums:",
      "            return 0",
      "        dp = [0] * (len(nums) + 1)",
      "        dp[1] = nums[0]",
      "        for size in range(2, len(nums) + 1):",
      "            dp[size] = max(dp[size - 1], dp[size - 2] + nums[size - 1])",
      "        return dp[-1]",
    ].join("\n"),
    userQuestion:
      "Review whether this DP state definition and transition stay consistent with the visible evidence.",
  },
];

type ReviewResponse = {
  ok: true;
  reviewAttemptId: string;
  chatSessionId: string;
  runResult: { status: string };
  diagnosis: { memoryUpdateCandidate: { facts: Array<{ factType: string; tag: string }> } };
  coachReply: string;
  trace: { traceRunId: string };
};

async function main() {
  const baseUrl = process.env.PATTERNCOACH_ACCEPTANCE_BASE_URL ?? "http://localhost:3000";
  const configuredDb = process.env.DATABASE_URL;
  if (!configuredDb) throw new Error("DATABASE_URL is required.");
  const dbPath = resolveSqliteFilePath(configuredDb);
  if (resolve(dbPath) === resolve(process.cwd(), "dev.db")) {
    throw new Error("Product acceptance refuses workspace dev.db.");
  }
  if (process.env.PATTERNCOACH_MEMORY_ORIGIN !== "learner") {
    throw new Error("Product acceptance requires learner process origin.");
  }
  if (process.env.PATTERNCOACH_LOCAL_USER_HANDLE !== USER_HANDLE) {
    throw new Error(`Product acceptance requires ${USER_HANDLE}.`);
  }
  if (process.env.REFLECTION_PROVIDER === "mock") {
    throw new Error("Product acceptance refuses a mock Reflection provider.");
  }

  const adapter = new PrismaBetterSqlite3({ url: configuredDb });
  const prisma = new PrismaClient({ adapter, log: ["error"] });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { handle: USER_HANDLE },
    });
    const report: Array<Record<string, unknown>> = [];
    for (const [index, scenario] of scenarios.entries()) {
      const testIds = await visibleTestIds(prisma, scenario.problemSlug);
      const response = await postJson<ReviewResponse>(
        `${baseUrl}/api/coach/review`,
        {
          problemSlug: scenario.problemSlug,
          language: "Python",
          code: scenario.code,
          selectedTestCaseIds: testIds,
          userQuestion: scenario.userQuestion,
          responseLanguage: "en",
          browserInstanceId: BROWSER_INSTANCE_ID,
          clientOccurredAt: new Date().toISOString(),
        },
      );
      if (!response.ok || response.runResult.status !== scenario.expectedStatus) {
        throw new Error(
          `${scenario.name}: expected ${scenario.expectedStatus}, got ${response.runResult.status}.`,
        );
      }
      await waitForBackgroundJobs(prisma, response.trace.traceRunId);
      const fact = await findMechanismFact(prisma, user.id, scenario.mechanism, scenario.polarity);
      if (!fact) {
        throw new Error(`${scenario.name}: no ${scenario.polarity} fact for ${scenario.mechanism}.`);
      }
      const integrity = readDurableFactIntegrity(fact.validationJson)!;
      const pairOrdinal = index % 2;
      const expectedPromotion = pairOrdinal === 0 ? "pending" : "trusted";
      const expectedStatus = pairOrdinal === 0 ? "candidate" : "active";
      if (
        integrity.promotionStatus !== expectedPromotion ||
        fact.status !== expectedStatus ||
        integrity.evidenceClusters.length !== pairOrdinal + 1
      ) {
        throw new Error(
          `${scenario.name}: expected ${expectedStatus}/${expectedPromotion}/${pairOrdinal + 1} clusters, got ${fact.status}/${integrity.promotionStatus}/${integrity.evidenceClusters.length}.`,
        );
      }
      report.push({
        scenario: scenario.name,
        problemSlug: scenario.problemSlug,
        runStatus: response.runResult.status,
        reviewAttemptId: response.reviewAttemptId,
        traceRunId: response.trace.traceRunId,
        fact: {
          id: fact.id,
          factType: fact.factType,
          tag: fact.tag,
          status: fact.status,
          promotionStatus: integrity.promotionStatus,
          clusterProblemIds: integrity.evidenceClusters.map((cluster) => cluster.problemId),
        },
        diagnosisFacts: response.diagnosis.memoryUpdateCandidate.facts,
      });
      console.log(`accepted ${scenario.name}: ${response.runResult.status} -> ${fact.status}/${integrity.promotionStatus}`);
    }

    await waitForAllUserBackgroundJobs(prisma, user.id);
    const ftsStore = createFtsStore(dbPath);
    let finalReflection: Awaited<ReturnType<typeof runReflection>>;
    try {
      finalReflection = await runReflection(prisma, {
        userId: user.id,
        ftsStore,
      });
    } finally {
      ftsStore.close();
    }
    const slots = await prisma.synthesisSlot.findMany({
      where: { userId: user.id, memoryOrigin: "learner", status: "active" },
    });
    const weaknessSlot = await findSlotWithPolarity(prisma, slots, "weakness");
    const strengthSlot = await findSlotWithPolarity(prisma, slots, "strength");
    if (!weaknessSlot || !strengthSlot) {
      throw new Error(
        `Reflection did not produce both polarities: weakness=${Boolean(weaknessSlot)} strength=${Boolean(strengthSlot)}.`,
      );
    }

    const chat = await postJson<{
      ok: true;
      coachReply: string;
      trace: { traceRunId: string };
    }>(`${baseUrl}/api/coach/chat`, {
      problemSlug: "house-robber",
      message: "How much do you know about me? Tell me one earned strength and one earned weakness.",
      responseLanguage: "en",
      browserInstanceId: BROWSER_INSTANCE_ID,
      clientOccurredAt: new Date().toISOString(),
    });
    if (!chat.ok) throw new Error("Profile-meta Chat failed.");
    const traceEvidence = await inspectPromptReceipt(prisma, chat.trace.traceRunId);
    if (traceEvidence.intent !== "profile_meta_question") {
      throw new Error(`Expected profile_meta_question intent, got ${traceEvidence.intent}.`);
    }
    if (traceEvidence.cueCount !== 2 || !traceEvidence.receiptsMatch) {
      throw new Error(
        `Expected two matching prompt-receipt cues, got ${traceEvidence.cueCount}, match=${traceEvidence.receiptsMatch}.`,
      );
    }
    if (!traceEvidence.promptContainsAllCues) {
      throw new Error("Provider trace prompt did not contain every selected human cue.");
    }
    if (
      /hardcoded[_ ]returns?|no_search_logic|rotated_sorted_array_approach/i.test(
        chat.coachReply,
      )
    ) {
      throw new Error("Visible Profile-meta reply leaked a blocked/raw tag.");
    }
    if (!/dynamic|state|transition/i.test(chat.coachReply) || !/binary|boundar|interval/i.test(chat.coachReply)) {
      throw new Error(
        `Visible reply did not express both earned polarities: ${chat.coachReply}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          databasePath: dbPath,
          userHandle: user.handle,
          reviews: report,
          reflection: {
            finalRun: finalReflection,
            activeSlotIds: slots.map((slot) => slot.id),
            weaknessSlot,
            strengthSlot,
          },
          profileMeta: {
            traceRunId: chat.trace.traceRunId,
            coachReply: chat.coachReply,
            ...traceEvidence,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function visibleTestIds(prisma: PrismaClient, slug: string) {
  const problem = await prisma.problem.findUniqueOrThrow({
    where: { slug },
    include: { testCases: { where: { isVisible: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (problem.testCases.length === 0) throw new Error(`${slug}: no visible tests.`);
  return problem.testCases.map((test) => test.id);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${payload.error ?? JSON.stringify(payload)}`);
  }
  return payload;
}

async function findMechanismFact(
  prisma: PrismaClient,
  userId: string,
  mechanism: string,
  polarity: "strength" | "weakness",
) {
  const rows = await prisma.l2MemoryFact.findMany({
    where: { userId, memoryOrigin: "learner" },
  });
  return rows.find((fact) => {
    const factPolarity = ["strength", "skill"].includes(fact.factType)
      ? "strength"
      : ["weakness", "mistake"].includes(fact.factType)
        ? "weakness"
        : "other";
    return (
      factPolarity === polarity &&
      readDurableFactIntegrity(fact.validationJson)?.mechanism === mechanism
    );
  });
}

async function waitForBackgroundJobs(prisma: PrismaClient, traceRunId: string) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const jobs = await prisma.backgroundJob.findMany({
      where: { originatingTraceRunId: traceRunId },
    });
    if (jobs.length >= 2 && jobs.every((job) => ["succeeded", "failed"].includes(job.status))) {
      const failed = jobs.filter((job) => job.status === "failed");
      if (failed.length > 0) {
        throw new Error(
          `Background jobs failed for ${traceRunId}: ${failed.map((job) => `${job.kind}:${job.failureReason}`).join(", ")}`,
        );
      }
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for background jobs for ${traceRunId}.`);
}

async function waitForAllUserBackgroundJobs(prisma: PrismaClient, userId: string) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const jobs = await prisma.backgroundJob.findMany({
      where: { originatingTraceRun: { userId } },
    });
    if (jobs.every((job) => ["succeeded", "failed"].includes(job.status))) {
      const failed = jobs.filter((job) => job.status === "failed");
      if (failed.length > 0) throw new Error(`User has ${failed.length} failed background jobs.`);
      return;
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for user background jobs.");
}

async function findSlotWithPolarity(
  prisma: PrismaClient,
  slots: Array<{ id: string; slot: string; text: string; evidenceFactIds: string }>,
  polarity: "strength" | "weakness",
) {
  for (const slot of slots) {
    const factIds = parseStrings(slot.evidenceFactIds);
    const facts = await prisma.l2MemoryFact.findMany({ where: { id: { in: factIds } } });
    if (
      facts.length === factIds.length &&
      facts.every(isTrustedL2FactForConsumption) &&
      facts.every((fact) =>
        polarity === "strength"
          ? ["strength", "skill"].includes(fact.factType)
          : ["weakness", "mistake"].includes(fact.factType),
      )
    ) {
      return { id: slot.id, slot: slot.slot, text: slot.text, factIds };
    }
  }
  return undefined;
}

async function inspectPromptReceipt(prisma: PrismaClient, traceRunId: string) {
  const events = await prisma.agentTraceEvent.findMany({
    where: { traceRunId },
    include: { payload: true },
    orderBy: { stepIndex: "asc" },
  });
  const retrieval = events.find((event) => event.kind === "retrieval" && event.title === "Coach memory assembly");
  const llm = [...events].reverse().find((event) => event.kind === "llm" && event.status === "succeeded");
  if (!retrieval || !llm) throw new Error("Chat trace lacks retrieval or successful LLM event.");
  const retrievalMetadata = {
    ...parseRecord(retrieval.payload?.detailMetadataJson),
    ...parseRecord(retrieval.metadataJson),
  };
  const llmMetadata = {
    ...parseRecord(llm.payload?.detailMetadataJson),
    ...parseRecord(llm.metadataJson),
  };
  const application = parseRecord(retrievalMetadata.application);
  const retrievalReceipt = parseRecord(application.memoryPromptReceipt);
  const llmReceipt = parseRecord(llmMetadata.memoryPromptReceipt);
  const retrievalPayload = parseRecord(retrieval.payload?.retrievalJson);
  const queryPlan = parseRecord(retrievalPayload.queryPlan);
  const selectedCandidates = Array.isArray(retrievalPayload.candidates)
    ? retrievalPayload.candidates
        .map(parseRecord)
        .filter((candidate) => candidate.selected === true)
    : [];
  const synthesisIds = selectedCandidates.flatMap((candidate) =>
    candidate.source === "synthesis" && typeof candidate.candidateId === "string"
      ? [candidate.candidateId]
      : [],
  );
  const synthesisRows = await prisma.synthesisSlot.findMany({
    where: { id: { in: synthesisIds } },
  });
  const synthesisTextById = new Map(
    synthesisRows.map((slot) => [slot.id, slot.text]),
  );
  const cues = selectedCandidates.flatMap((candidate) => {
    const id = candidate.candidateId;
    return typeof id === "string" && synthesisTextById.has(id)
      ? [synthesisTextById.get(id)!]
      : [];
  });
  const prompt = llm.payload?.promptJson ?? "";
  return {
    intent: queryPlan.intent,
    cueCount: retrievalReceipt.cueCount,
    selectedSources: selectedCandidates.map((candidate) => candidate.source),
    selectedCues: cues,
    retrievalReceipt,
    providerReceipt: llmReceipt,
    receiptsMatch: JSON.stringify(retrievalReceipt) === JSON.stringify(llmReceipt),
    promptContainsAllCues: cues.length === 2 && cues.every((cue) => prompt.includes(cue)),
    providerModel: llm.model,
    providerResponseModel: llm.responseModel,
  };
}

function parseStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function delay(milliseconds: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
