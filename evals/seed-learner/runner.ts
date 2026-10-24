import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { initializeEvalDatabase, resolveEvalDatabaseConfig } from "../runner/db";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import {
  createMemoryEpisode,
  episodeFtsContent,
} from "@/server/memory/store/episode-store";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import type { EvidenceKind } from "@/server/memory/memory.types";
import type { L1MemoryEventType } from "@/types/memory";
import {
  loadSeedLearnerScenario,
  type SeedLearnerScenario,
  type SeedLearnerScenarioEpisode,
  type SeedLearnerScenarioFact,
} from "./scenario";
import {
  writeSeedLearnerManifest,
  type SeedLearnerManifest,
} from "./manifest";

export const SEED_LEARNER_SUITE_NAME = "seed-learner";

export type RunSeedLearnerOptions = {
  scenarioPath: string;
  dbInput: string;
  outPath: string;
  now?: Date;
  cwd?: string;
  devDatabaseUrl?: string;
};

export type SeedLearnerRunResult = {
  dbPath: string;
  manifestPath: string;
  learnerId: string;
  userId: string;
  factsCount: number;
  episodesCount: number;
  staleOrSupersededFactsCount: number;
  preferenceFactsCount: number;
  arbitrationUsed: boolean;
  realLlmCalls: boolean;
  fixtureOnlyWrites: string[];
};

type SeededProblem = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
};

type SeededEpisode = {
  scenarioKey: string;
  episodeId: string;
  problemId: string;
  problemSlug: string;
  chatSessionId: string;
  reviewAttemptId?: string;
  sourceTraceIds: string[];
  primaryTraceId: string;
  traceIdsByType: Partial<Record<L1MemoryEventType, string>>;
};

type FactManifestDraft = SeedLearnerManifest["facts"][number];
type EpisodeManifestDraft = SeedLearnerManifest["episodes"][number];

export async function runSeedLearner(
  options: RunSeedLearnerOptions,
): Promise<SeedLearnerRunResult> {
  if (!options.dbInput) {
    throw new Error("Seed learner requires an explicit --db <sqlite-db-path>.");
  }
  if (!options.outPath) {
    throw new Error("Seed learner requires an explicit --out <manifest-path>.");
  }

  const cwd = options.cwd ?? process.cwd();
  const timestamp = options.now ?? new Date();
  const scenarioPath = resolve(cwd, options.scenarioPath);
  const manifestPath = resolve(cwd, options.outPath);
  const scenario = loadSeedLearnerScenario({ scenarioPath });
  assertEvaluationFixtureOnlyScenario(scenario);
  const database = resolveEvalDatabaseConfig({
    suiteName: SEED_LEARNER_SUITE_NAME,
    dbInput: options.dbInput,
    timestamp,
    cwd,
    devDatabaseUrl: options.devDatabaseUrl,
  });

  const prisma = initializeEvalDatabase(database);
  try {
    const seeded = await seedScenario(prisma, scenario, {
      scenarioPath,
      dbPath: database.dbPath,
      generatedAt: timestamp,
    });
    writeSeedLearnerManifest(manifestPath, seeded.manifest);

    return {
      dbPath: database.dbPath,
      manifestPath,
      learnerId: scenario.learnerProfile.learnerId,
      userId: scenario.learnerProfile.userId,
      factsCount: seeded.manifest.counts.facts,
      episodesCount: seeded.manifest.counts.episodes,
      staleOrSupersededFactsCount: seeded.manifest.counts.staleOrSupersededFacts,
      preferenceFactsCount: seeded.manifest.counts.preferenceFacts,
      arbitrationUsed: seeded.manifest.arbitration.used,
      realLlmCalls: seeded.manifest.realLlmCalls,
      fixtureOnlyWrites: seeded.manifest.arbitration.fixtureOnlyWrites,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function seedScenario(
  prisma: PrismaClient,
  scenario: SeedLearnerScenario,
  context: { scenarioPath: string; dbPath: string; generatedAt: Date },
) {
  await seedUser(prisma, scenario);
  const problems = await seedProblems(prisma, scenario);
  const sessionSequences = new Map<string, number>();
  const episodes = new Map<string, SeededEpisode>();
  const episodeManifest: EpisodeManifestDraft[] = [];
  const ftsStore = createFtsStore(context.dbPath);

  try {
    for (const episode of scenario.episodes) {
      const seededEpisode = await seedEpisode(prisma, {
        scenario,
        episode,
        problem: requireProblem(problems, episode.problemSlug),
        sessionSequences,
        ftsStore,
      });
      episodes.set(episode.key, seededEpisode);
      episodeManifest.push({
        scenarioEpisodeKey: episode.key,
        episodeId: seededEpisode.episodeId,
        kind: episode.kind,
        problemSlug: episode.problemSlug,
        problemPath: `/workbench?problem=${episode.problemSlug}`,
        title: episode.title,
        summary: episode.summary,
        outcome: episode.outcome,
        expectedRetrievable: episode.expectedRetrievable,
        sourceTraceIds: seededEpisode.sourceTraceIds,
      });
    }
  } finally {
    ftsStore.close();
  }

  const deterministicIdUpdates: string[] = [];
  const fixtureOnlyWrites: string[] = [];
  const arbitrationSources = new Set<string>();
  const factManifest: FactManifestDraft[] = [];
  let rejectedCandidateCount = 0;

  for (const fact of scenario.facts) {
    const seededFact = await seedFactThroughArbitration(prisma, {
      scenario,
      fact,
      episodes,
      deterministicIdUpdates,
      arbitrationSources,
    });
    rejectedCandidateCount += seededFact.rejectedCandidateCount;
    factManifest.push(seededFact.manifestFact);
  }

  const staleFacts = factManifest
    .filter((fact) => isStaleOrSuperseded(fact))
    .map((fact) => ({
      scenarioFactKey: fact.scenarioFactKey,
      factId: fact.factId,
      dbStatus: fact.dbStatus,
      scenarioStatus: fact.scenarioStatus,
      reason:
        scenario.facts.find((item) => item.key === fact.scenarioFactKey)
          ?.staleReason ?? "Marked non-current in seed scenario.",
    }));

  const preferences = factManifest
    .filter((fact) => fact.factType === "preference")
    .map((fact) => ({
      scenarioFactKey: fact.scenarioFactKey,
      factId: fact.factId,
      tag: fact.tag,
      label: fact.label,
      expectedRetrievable: fact.expectedRetrievable,
    }));

  const manifest: SeedLearnerManifest = {
    manifestVersion: "seed-learner-manifest-v1",
    generatedAt: context.generatedAt.toISOString(),
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion,
    scenarioPath: context.scenarioPath,
    dbPath: context.dbPath,
    learnerId: scenario.learnerProfile.learnerId,
    userId: scenario.learnerProfile.userId,
    humanReviewStatus: scenario.humanReviewStatus,
    counts: {
      facts: factManifest.length,
      episodes: episodeManifest.length,
      staleOrSupersededFacts: staleFacts.length,
      preferenceFacts: preferences.length,
    },
    facts: factManifest,
    episodes: episodeManifest,
    staleFacts,
    preferences,
    arbitration: {
      used: scenario.facts.length > 0,
      sources: [...arbitrationSources].sort(),
      rejectedCandidateCount,
      deterministicIdUpdates,
      fixtureOnlyWrites,
    },
    realLlmCalls: false,
    notes: scenario.notes,
    limitations: scenario.limitations,
  };

  return { manifest };
}

async function seedUser(prisma: PrismaClient, scenario: SeedLearnerScenario) {
  const profile = scenario.learnerProfile;
  await prisma.user.create({
    data: {
      id: profile.userId,
      handle: profile.handle,
      profile: {
        create: {
          id: stableDbId("profile", profile.learnerId),
          displayName: profile.displayName,
          interviewGoal: profile.interviewGoal,
          preferredLanguages: JSON.stringify(profile.preferredLanguages),
          strongPatterns: JSON.stringify(profile.strongPatterns),
          weakPatterns: JSON.stringify(profile.weakPatterns),
          explanationStyle: JSON.stringify(profile.explanationStyle),
          outputPreferences: JSON.stringify(profile.outputPreferences),
        },
      },
    },
  });
}

async function seedProblems(
  prisma: PrismaClient,
  scenario: SeedLearnerScenario,
) {
  const problems = new Map<string, SeededProblem>();

  for (const problem of scenario.practicedProblems) {
    const id = problem.problemId ?? stableDbId("problem", problem.slug);
    const created = await prisma.problem.create({
      data: {
        id,
        leetcodeNumber: problem.leetcodeNumber,
        slug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: JSON.stringify(problem.tags),
        methodName: problem.methodName,
        isDemoSupported: problem.isDemoSupported,
        localRunStatus: problem.isDemoSupported ? "ready" : "not_ready",
      },
    });
    problems.set(problem.slug, {
      id: created.id,
      slug: created.slug,
      title: created.title,
      tags: problem.tags,
    });
  }

  return problems;
}

async function seedEpisode(
  prisma: PrismaClient,
  args: {
    scenario: SeedLearnerScenario;
    episode: SeedLearnerScenarioEpisode;
    problem: SeededProblem;
    sessionSequences: Map<string, number>;
    ftsStore: FtsStore;
  },
): Promise<SeededEpisode> {
  const { scenario, episode, problem, sessionSequences, ftsStore } = args;
  const chatSession = await getOrCreateChatSession(prisma, scenario, problem);
  const traceIdsByType: Partial<Record<L1MemoryEventType, string>> = {};
  const sourceTraceIds: string[] = [];
  let reviewAttemptId: string | undefined;
  let primaryTraceId: string | undefined;

  if (episode.kind === "review") {
    const review = episode.review;
    if (!review) {
      throw new Error(`Review episode ${episode.key} is missing review details.`);
    }

    reviewAttemptId = stableDbId("review", episode.key);
    const reviewAttempt = await prisma.reviewAttempt.create({
      data: {
        id: reviewAttemptId,
        userId: scenario.learnerProfile.userId,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        language: review.language,
        userState: review.userState,
        userQuestion: review.userQuestion,
        codeSnapshot: review.codeSnapshot,
        selectedTestCaseIds: "[]",
        selectedTestsJson: "[]",
        coachReplyMarkdown: review.coachReplyMarkdown,
        memoryOrigin: "evaluation",
        createdAt: parseScenarioDate(episode.scriptedAt),
      },
    });

    const reviewTrace = await createTraceEvent(prisma, {
      id: stableDbId("trace", `${episode.key}.review_attempt`),
      scenario,
      episode,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      reviewAttemptId: reviewAttempt.id,
      eventType: "review_attempt",
      source: "seed_learner",
      content: episode.summary,
      eventJson: {
        language: review.language,
        userState: review.userState,
      },
    });
    traceIdsByType.review_attempt = reviewTrace.id;
    sourceTraceIds.push(reviewTrace.id);

    if (review.run) {
      await prisma.runEvidence.create({
        data: {
          id: stableDbId("run", episode.key),
          reviewAttemptId: reviewAttempt.id,
          source: "review",
          status: review.run.status,
          passedCount: review.run.passedCount,
          failedCount: review.run.failedCount,
          durationMs: review.run.durationMs,
          actualOutput: review.run.actualOutput,
          expectedOutput: review.run.expectedOutput,
          firstFailedCaseJson: JSON.stringify(review.run.firstFailedCase ?? null),
          rawResultJson: JSON.stringify({
            seededBy: scenario.scenarioId,
            scenarioEpisodeKey: episode.key,
          }),
          memoryOrigin: "evaluation",
        },
      });
      const runTrace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.run_evidence`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        reviewAttemptId: reviewAttempt.id,
        eventType: "run_evidence",
        source: "seed_learner",
        content: `${review.run.status}: ${episode.summary}`,
        eventJson: {
          status: review.run.status,
          passedCount: review.run.passedCount,
          failedCount: review.run.failedCount,
          firstFailedCase: review.run.firstFailedCase,
        },
      });
      traceIdsByType.run_evidence = runTrace.id;
      sourceTraceIds.push(runTrace.id);
    }

    if (review.diagnosis) {
      await prisma.diagnosisResult.create({
        data: {
          id: stableDbId("diagnosis", episode.key),
          reviewAttemptId: reviewAttempt.id,
          diagnosisJson: JSON.stringify({
            problemSlug: problem.slug,
            runStatus: review.run?.status ?? "no_tests",
            userIssueSummary: review.diagnosis.userIssueSummary,
            coachSummary: review.diagnosis.coachSummary,
            mistakeTags: review.diagnosis.mistakeTags,
            skillTags: review.diagnosis.skillTags,
          }),
          memoryUpdateCandidateJson: JSON.stringify({
            seededBy: scenario.scenarioId,
            scenarioEpisodeKey: episode.key,
          }),
          mistakeTags: JSON.stringify(review.diagnosis.mistakeTags),
          skillTags: JSON.stringify(review.diagnosis.skillTags),
          userIssueSummary: review.diagnosis.userIssueSummary,
          coachSummary: review.diagnosis.coachSummary,
        },
      });
      const diagnosisTrace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.diagnosis`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        reviewAttemptId: reviewAttempt.id,
        eventType: "diagnosis",
        source: "seed_learner",
        content: review.diagnosis.userIssueSummary,
        eventJson: {
          mistakeTags: review.diagnosis.mistakeTags,
          skillTags: review.diagnosis.skillTags,
        },
      });
      traceIdsByType.diagnosis = diagnosisTrace.id;
      sourceTraceIds.push(diagnosisTrace.id);
      primaryTraceId = diagnosisTrace.id;
    }

    await prisma.problemHistory.create({
      data: {
        id: stableDbId("history", episode.key),
        userId: scenario.learnerProfile.userId,
        problemId: problem.id,
        reviewAttemptId: reviewAttempt.id,
        chatSessionId: chatSession.id,
        language: review.language,
        userState: review.userState,
        problemTags: JSON.stringify(problem.tags),
        runStatus: review.run?.status ?? "no_tests",
        failedCaseSummary: review.run?.firstFailedCase
          ? JSON.stringify(review.run.firstFailedCase)
          : undefined,
        userIssueSummary: review.diagnosis?.userIssueSummary,
        coachSummary: review.diagnosis?.coachSummary,
        memoryUpdateSummary: episode.summary,
        memoryOrigin: "evaluation",
      },
    });

    if (review.coachReplyMarkdown) {
      await prisma.chatMessage.create({
        data: {
          id: stableDbId("message", `${episode.key}.assistant`),
          sessionId: chatSession.id,
          reviewAttemptId: reviewAttempt.id,
          role: "assistant",
          contentMarkdown: review.coachReplyMarkdown,
          metadataJson: JSON.stringify({
            type: "review_reply",
            scenarioEpisodeKey: episode.key,
          }),
          sequence: nextSequence(sessionSequences, chatSession.id),
          memoryOrigin: "evaluation",
        },
      });
      const replyTrace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.coach_reply`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        reviewAttemptId: reviewAttempt.id,
        eventType: "coach_reply",
        source: "seed_learner",
        content: review.coachReplyMarkdown,
        eventJson: {
          type: "review_reply",
        },
      });
      traceIdsByType.coach_reply = replyTrace.id;
      sourceTraceIds.push(replyTrace.id);
    }
  } else {
    const chat = episode.chat;
    if (!chat) {
      throw new Error(`Chat episode ${episode.key} is missing chat details.`);
    }

    for (const [index, message] of chat.userMessages.entries()) {
      await prisma.chatMessage.create({
        data: {
          id: stableDbId("message", `${episode.key}.user.${index}`),
          sessionId: chatSession.id,
          role: "user",
          contentMarkdown: message,
          metadataJson: JSON.stringify({ scenarioEpisodeKey: episode.key }),
          sequence: nextSequence(sessionSequences, chatSession.id),
          memoryOrigin: "evaluation",
        },
      });
      const trace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.chat_user.${index}`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        source: "seed_learner",
        content: message,
        eventJson: { messageIndex: index },
      });
      traceIdsByType.chat_user_message ??= trace.id;
      sourceTraceIds.push(trace.id);
      primaryTraceId ??= trace.id;
    }

    for (const [index, message] of chat.assistantMessages.entries()) {
      await prisma.chatMessage.create({
        data: {
          id: stableDbId("message", `${episode.key}.assistant.${index}`),
          sessionId: chatSession.id,
          role: "assistant",
          contentMarkdown: message,
          metadataJson: JSON.stringify({ scenarioEpisodeKey: episode.key }),
          sequence: nextSequence(sessionSequences, chatSession.id),
          memoryOrigin: "evaluation",
        },
      });
      const trace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.chat_reply.${index}`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        source: "seed_learner",
        content: message,
        eventJson: { messageIndex: index },
      });
      traceIdsByType.chat_reply ??= trace.id;
      sourceTraceIds.push(trace.id);
    }

    if (chat.memoryNote) {
      const trace = await createTraceEvent(prisma, {
        id: stableDbId("trace", `${episode.key}.memory_note`),
        scenario,
        episode,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "memory_note",
        source: "seed_learner",
        content: chat.memoryNote.value,
        eventJson: {
          tag: chat.memoryNote.tag,
        },
      });
      traceIdsByType.memory_note = trace.id;
      sourceTraceIds.push(trace.id);
      primaryTraceId = trace.id;
    }
  }

  const memoryEpisode = await createMemoryEpisode(prisma, {
    id: stableDbId("episode", episode.key),
    userId: scenario.learnerProfile.userId,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    kind: episode.kind,
    title: episode.title,
    summary: episode.summary,
    outcome: episode.outcome,
    tags: episode.tags,
    salience: episode.salience,
    sourceTraceIds,
    memoryOrigin: "evaluation",
  });
  ftsStore.indexMemoryDocument({
    kind: "episode",
    refId: memoryEpisode.id,
    content: episodeFtsContent({
      title: memoryEpisode.title,
      summary: memoryEpisode.summary,
      tags: memoryEpisode.tags,
    }),
  });

  return {
    scenarioKey: episode.key,
    episodeId: memoryEpisode.id,
    problemId: problem.id,
    problemSlug: problem.slug,
    chatSessionId: chatSession.id,
    reviewAttemptId,
    sourceTraceIds,
    primaryTraceId: primaryTraceId ?? sourceTraceIds[0],
    traceIdsByType,
  };
}

async function seedFactThroughArbitration(
  prisma: PrismaClient,
  args: {
    scenario: SeedLearnerScenario;
    fact: SeedLearnerScenarioFact;
    episodes: Map<string, SeededEpisode>;
    deterministicIdUpdates: string[];
    arbitrationSources: Set<string>;
  },
) {
  const {
    scenario,
    fact,
    episodes,
    deterministicIdUpdates,
    arbitrationSources,
  } = args;
  const stableFactId = stableDbId("fact", fact.key);
  const arbitrationPath: FactManifestDraft["arbitrationPath"] = [];
  let rejectedCandidateCount = 0;

  for (const arbitrationEvent of fact.arbitration) {
    const episode = requireEpisode(episodes, arbitrationEvent.episodeKey);
    const source = arbitrationEvent.source ?? fact.source;
    const evidenceTraceIds = selectEvidenceTraceIds(
      episode,
      source,
      arbitrationEvent.evidenceKind,
    );
    arbitrationSources.add(source);

    const result = await arbitrateFactCandidates(prisma, {
      userId: scenario.learnerProfile.userId,
      problemId: episode.problemId,
      reviewAttemptId: episode.reviewAttemptId,
      source,
      now: parseScenarioDate(
        scenario.episodes.find((item) => item.key === arbitrationEvent.episodeKey)
          ?.scriptedAt,
      ),
      candidates: [
        {
          factType: fact.factType,
          tag: fact.tag,
          value: arbitrationEvent.value ?? fact.label,
          evidenceKind: arbitrationEvent.evidenceKind,
          observedBehavior: arbitrationEvent.observedBehavior,
          evidenceTraceIds,
        },
      ],
    });

    rejectedCandidateCount += result.rejected.length;
    if (result.rejected.length > 0 || result.updated.length !== 1) {
      throw new Error(
        `Failed to seed fact ${fact.key}: ${
          result.rejected[0]?.reason ?? "arbitration did not update exactly one fact"
        }`,
      );
    }

    const updated = result.updated[0];
    if (updated.id !== stableFactId) {
      await prisma.l2MemoryFact.update({
        where: { id: updated.id },
        data: { id: stableFactId },
      });
      deterministicIdUpdates.push(`${fact.key}->${stableFactId}`);
    }

    arbitrationPath.push({
      episodeKey: arbitrationEvent.episodeKey,
      evidenceKind: arbitrationEvent.evidenceKind,
      source,
      evidenceTraceIds,
    });
  }

  if (fact.status === "stale") {
    throw new Error(
      `Scenario fact ${fact.key} uses status=stale, but v1 seed runner does not bypass arbitration to write stale DB status. Use a supported arbitration path or add a product opcode first.`,
    );
  }

  const row = await prisma.l2MemoryFact.findUniqueOrThrow({
    where: { id: stableFactId },
  });
  const sourceEpisode = requireEpisode(episodes, fact.sourceEpisodeKey);
  const manifestFact: FactManifestDraft = {
    scenarioFactKey: fact.key,
    factId: row.id,
    factType: row.factType,
    tag: row.tag,
    label: row.label,
    value: row.value,
    dbStatus: row.status,
    scenarioStatus: fact.status,
    confidence: row.confidence,
    expectedRetrievable: fact.expectedRetrievable,
    relatedProblemSlugs: fact.relatedProblemSlugs,
    sourceEpisodeKey: fact.sourceEpisodeKey,
    sourceEpisodeId: sourceEpisode.episodeId,
    source: row.source,
    evidenceTraceIds: parseStringArray(row.evidenceTraceIds),
    arbitrationPath,
  };

  return { manifestFact, rejectedCandidateCount };
}

async function getOrCreateChatSession(
  prisma: PrismaClient,
  scenario: SeedLearnerScenario,
  problem: SeededProblem,
) {
  return prisma.chatSession.upsert({
    where: {
      userId_problemId_memoryOrigin: {
        userId: scenario.learnerProfile.userId,
        problemId: problem.id,
        memoryOrigin: "evaluation",
      },
    },
    create: {
      id: stableDbId("session", `${scenario.scenarioId}.${problem.slug}`),
      userId: scenario.learnerProfile.userId,
      problemId: problem.id,
      title: problem.title,
      primaryLanguage: scenario.learnerProfile.preferredLanguages[0],
      isActive: true,
      memoryOrigin: "evaluation",
    },
    update: {
      title: problem.title,
      primaryLanguage: scenario.learnerProfile.preferredLanguages[0],
      isActive: true,
    },
  });
}

async function createTraceEvent(
  prisma: PrismaClient,
  input: {
    id: string;
    scenario: SeedLearnerScenario;
    episode: SeedLearnerScenarioEpisode;
    problemId: string;
    chatSessionId?: string;
    reviewAttemptId?: string;
    eventType: L1MemoryEventType;
    source: string;
    content?: string;
    eventJson?: Record<string, unknown>;
  },
) {
  return prisma.l1MemoryEvent.create({
    data: {
      id: input.id,
      userId: input.scenario.learnerProfile.userId,
      problemId: input.problemId,
      chatSessionId: input.chatSessionId,
      reviewAttemptId: input.reviewAttemptId,
      eventType: input.eventType,
      source: input.source,
      content: input.content,
      eventJson: JSON.stringify({
        scenarioId: input.scenario.scenarioId,
        scenarioEpisodeKey: input.episode.key,
        ...input.eventJson,
      }),
      memoryOrigin: "evaluation",
      occurredAt: parseScenarioDate(input.episode.scriptedAt),
    },
  });
}

function selectEvidenceTraceIds(
  episode: SeededEpisode,
  source: string,
  evidenceKind: EvidenceKind,
) {
  if (evidenceKind === "preference_set" && episode.traceIdsByType.memory_note) {
    return [episode.traceIdsByType.memory_note];
  }
  if (evidenceKind === "resolve" && episode.traceIdsByType.run_evidence) {
    return [episode.traceIdsByType.run_evidence];
  }
  if (source === "review_diagnosis" && episode.traceIdsByType.diagnosis) {
    return [episode.traceIdsByType.diagnosis];
  }
  if (source === "user_explicit" && episode.traceIdsByType.memory_note) {
    return [episode.traceIdsByType.memory_note];
  }
  if (source === "chat_consolidation") {
    const chatTrace =
      episode.traceIdsByType.chat_reply ?? episode.traceIdsByType.chat_user_message;
    if (chatTrace) {
      return [chatTrace];
    }
  }
  if (episode.primaryTraceId) {
    return [episode.primaryTraceId];
  }

  throw new Error(`Episode ${episode.scenarioKey} has no evidence trace ids.`);
}

function nextSequence(sequences: Map<string, number>, sessionId: string) {
  const next = (sequences.get(sessionId) ?? 0) + 1;
  sequences.set(sessionId, next);
  return next;
}

function requireProblem(problems: Map<string, SeededProblem>, slug: string) {
  const problem = problems.get(slug);
  if (!problem) {
    throw new Error(`Scenario references unseeded problem slug: ${slug}`);
  }
  return problem;
}

function requireEpisode(episodes: Map<string, SeededEpisode>, key: string) {
  const episode = episodes.get(key);
  if (!episode) {
    throw new Error(`Scenario references unseeded episode key: ${key}`);
  }
  return episode;
}

function stableDbId(prefix: string, key: string) {
  return `seed_${prefix}_${key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

function assertEvaluationFixtureOnlyScenario(scenario: SeedLearnerScenario) {
  if (scenario.episodes.length === 0 && scenario.facts.length === 0) {
    return;
  }

  throw new Error(
    [
      `Evaluation origin cannot seed earned learner memory for scenario ${scenario.scenarioId}.`,
      `Found ${scenario.episodes.length} history episode(s) and ${scenario.facts.length} durable fact candidate(s).`,
      "Use a fixture-only scenario containing profile/problem/test metadata and no earned episodes or L2 facts.",
    ].join(" "),
  );
}

function parseScenarioDate(value: string | undefined) {
  return value ? new Date(value) : undefined;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isStaleOrSuperseded(fact: FactManifestDraft) {
  return (
    fact.scenarioStatus === "stale" ||
    fact.scenarioStatus === "superseded" ||
    fact.dbStatus === "stale" ||
    fact.dbStatus === "contradicted" ||
    fact.dbStatus === "resolved"
  );
}
