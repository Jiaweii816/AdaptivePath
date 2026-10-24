import type { PrismaClient } from "@prisma/client";
import { normalizeProviderError } from "@/server/llm/provider-error";
import {
  appendTraceEventBestEffort,
  createTraceContext,
  type TraceContext,
} from "@/server/llm/trace-context";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { readLearnerClaimSemantics } from "@/server/memory/claims/learner-claim-semantics";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import { isSafeEpisodeForConsumption } from "@/server/memory/store/episode-store";
import {
  normalizeMemoryTag,
  type SlotUpsert,
} from "@/server/memory/memory.types";
import {
  applyStrategyObservations,
  computeStrategyObservations,
  type StrategyObservationInput,
} from "@/server/memory/procedural/strategy-observer";
import {
  arbitrateFactCandidates,
  upsertStrategyCandidate,
} from "@/server/memory/store/fact-store";
import {
  evaluateSynthesisSlotEvidence,
  listActiveSlots,
  upsertSynthesisSlots,
} from "@/server/memory/store/synthesis-store";
import {
  getReflectionProvider,
  type ReflectionProvider,
} from "./reflection-provider";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import type { FtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  createDeterministicRetrievalTextRefreshProvider,
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";

const REFLECTION_EPISODE_WINDOW = 10;
const SIGNAL_EVENT_WINDOW = 5;

export type RunReflectionArgs = {
  userId: string;
  problemId?: string;
  reviewAttemptId?: string;
  changedFactIds?: string[];
  provider?: ReflectionProvider;
  /** Explicit projection target for tests/replay; production injects its DB store. */
  ftsStore?: FtsStore;
  /** Claimed memory_background child Run supplied by the durable dispatcher. */
  traceContext?: TraceContext;
  /** Foreground root retained for durable background-job correlation. */
  originatingTraceRunId?: string;
  /** Direct parent Run; useful to dispatch adapters and nested callers. */
  parentTraceRunId?: string;
  retrievalTextProvider?: RetrievalTextRefreshProvider;
};

export type ReflectionResult = {
  skipped: false;
  episodeCount: number;
  changedFactCount: number;
  strategySignalCount: number;
  strategyObservationCount: number;
  acceptedSlotIds: string[];
  rejectedSlotCount: number;
  acceptedStrategyProposalCount: number;
  rejectedStrategyProposalCount: number;
  auditedFactIds: string[];
  rejectedFactAuditCount: number;
};

type ReflectionFailureTraceWritten = Error & {
  memorySynthesisFailureTraceWritten?: true;
};

export async function runReflection(
  prisma: PrismaClient,
  args: RunReflectionArgs,
): Promise<ReflectionResult> {
  const provider = args.provider ?? getReflectionProvider();
  const startedAt = Date.now();
  const traceContext =
    args.traceContext ??
    createTraceContext({
      prisma,
      userId: args.userId,
      path: "memory",
      task: "memory.reflect",
      problemId: args.problemId,
      reviewAttemptId: args.reviewAttemptId,
    });

  const [
    user,
    episodeRows,
    changedFacts,
    activeSlots,
    consolidationEvents,
    appliedEvents,
    mistakeFactRows,
    hintEvents,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: args.userId } }),
    prisma.memoryEpisode.findMany({
      where: { userId: args.userId, memoryOrigin: "learner" },
      orderBy: { createdAt: "desc" },
      take: REFLECTION_EPISODE_WINDOW,
    }),
    loadChangedFacts(prisma, args),
    listActiveSlots(prisma, { userId: args.userId, take: 10 }),
    loadFormalTraceProjection(prisma, {
      userId: args.userId,
      eventTypes: ["llm_call"],
      sources: ["memory_agent:consolidate_chat"],
      order: "desc",
      take: SIGNAL_EVENT_WINDOW,
    }),
    prisma.l1MemoryEvent.findMany({
      where: {
        userId: args.userId,
        eventType: "strategy_applied",
        memoryOrigin: "learner",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.l2MemoryFact.findMany({
      where: {
        userId: args.userId,
        memoryOrigin: "learner",
        status: { notIn: ["resolved", "stale", "contradicted"] },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 30,
    }),
    loadFormalTraceProjection(prisma, {
      userId: args.userId,
      eventTypes: ["tool_result"],
      sources: ["chat_reply"],
      order: "desc",
      take: 50,
    }),
  ]);
  const episodes = episodeRows.filter(isSafeEpisodeForConsumption);
  // Open-world claims commonly use factType=knowledge_state and carry their
  // learner meaning in polarity. Strategy observation must not silently drop
  // those negative claims just because they do not use a legacy type label.
  const mistakeFacts = mistakeFactRows
    .filter(isTrustedL2FactForConsumption)
    .filter((fact) => readLearnerClaimSemantics(fact).polarity === "negative");

  await appendClaimedReflectionEvent(args.traceContext, {
    stage: "reflection_input",
    kind: "retrieval",
    title: "Load reflection evidence",
    status: "succeeded",
    details: {
      retrieval: {
        episodeIds: episodes.map((episode) => episode.id),
        changedFactIds: changedFacts.map((fact) => fact.id),
        activeSlotIds: activeSlots.map((slot) => slot.id),
      },
      metadata: {
        operation: "load_reflection_evidence",
        episodeCount: episodes.length,
        changedFactCount: changedFacts.length,
        activeSlotCount: activeSlots.length,
        consolidationSignalEventCount: consolidationEvents.length,
        appliedStrategyEventCount: appliedEvents.length,
        mistakeFactCount: mistakeFacts.length,
        hintEventCount: hintEvents.length,
      },
    },
  });

  const strategySignals = consolidationEvents.flatMap(extractStrategySignals);
  const observationBundle = await buildObservationInput(prisma, {
    appliedEvents,
    episodes,
    hintEvents,
    mistakeFacts,
    signals: strategySignals,
  });
  const observations = computeStrategyObservations(observationBundle.input);
  await applyStrategyObservations(prisma, {
    userId: args.userId,
    observations,
    evidenceTraceIdsByTag: observationBundle.evidenceTraceIdsByTag,
  });
  await appendClaimedReflectionEvent(args.traceContext, {
    stage: "strategy_observation",
    kind: "memory",
    title: "Apply deterministic strategy observations",
    status: "succeeded",
    details: {
      input: {
        observationTags: [...observations.keys()],
      },
      output: {
        observationCount: observations.size,
      },
      metadata: {
        operation: "deterministic_strategy_observation",
        llmDecidesConfidence: false,
      },
    },
  });

  const reflectionInput = {
    userHandle: user.handle,
    episodes: episodes.map((episode) => ({
      id: episode.id,
      title: episode.title,
      summary: episode.summary,
      outcome: episode.outcome,
      tags: parseStringArray(episode.tags),
    })),
    changedFacts: changedFacts.map((fact) => ({
      id: fact.id,
      factType: fact.factType,
      tag: fact.tag,
      value: fact.value,
      claimText: fact.claimText,
      polarity: fact.polarity,
      scope: parseClaimScope(fact.scopeJson),
      mechanismKeys: parseStringArray(fact.mechanismKeysJson),
      confidence: fact.confidence,
      evidenceTraceIds: parseStringArray(fact.evidenceTraceIds),
      evidenceClusters:
        readDurableFactIntegrity(fact.validationJson)?.evidenceClusters.map(
          (cluster) => ({
            id: cluster.key,
            problemId: cluster.problemId,
            reviewAttemptId: cluster.reviewAttemptId,
          }),
        ) ?? [],
    })),
    activeSlots: activeSlots.map((slot) => ({
      slot: slot.slot,
      synthesisKey: slot.synthesisKey,
      text: slot.text,
    })),
    strategySignals,
  };

  const output = await provider
    .reflect(reflectionInput, traceContext)
    .catch(async (error) => {
      await appendClaimedReflectionEvent(args.traceContext, {
        stage: "reflection_failure",
        kind: "error",
        title: "Memory reflection failed",
        status: "failed",
        durationMs: Date.now() - startedAt,
        details: {
          output: { error: normalizeProviderError(error) },
          metadata: {
            operation: "memory_reflection",
            provider: provider.name,
          },
        },
      });
      await appendReflectionFailureTrace(prisma, {
        args,
        providerName: provider.name,
        durationMs: Date.now() - startedAt,
        traceRunId: traceContext.traceRunId,
        llmMsTotal: traceContext.llmMsTotal,
        changedFactCount: changedFacts.length,
        episodeCount: episodes.length,
        activeSlotCount: activeSlots.length,
        error,
      });
      throw markReflectionFailureTraceWritten(error);
    });

  const acceptedSlots: SlotUpsert[] = [];
  let rejectedSlotCount = 0;
  for (const upsert of output.slotUpserts) {
    const citedRows = await prisma.l2MemoryFact.findMany({
      where: { id: { in: upsert.evidenceFactIds }, userId: args.userId },
    });
    const cited = citedRows.filter(isTrustedL2FactForConsumption);
    const evidenceDecision = evaluateSynthesisSlotEvidence(upsert.slot, cited);

    if (
      cited.length === upsert.evidenceFactIds.length &&
      evidenceDecision.eligible
    ) {
      acceptedSlots.push(upsert);
    } else {
      rejectedSlotCount += 1;
      await appendL1TraceEvent(prisma, {
        userId: args.userId,
        eventType: "fact_rejected",
        source: "memory_agent:reflect",
        content: `slot ${upsert.slot}/${upsert.synthesisKey}: insufficient independent cross-problem evidence clusters`,
        eventJson: { upsert, evidenceDecision },
      });
    }
  }
  const persistedSlots = await upsertSynthesisSlots(prisma, {
    userId: args.userId,
    upserts: acceptedSlots,
  });

  let acceptedStrategyProposalCount = 0;
  let rejectedStrategyProposalCount = 0;
  for (const proposal of output.strategyProposals) {
    try {
      await upsertStrategyCandidate(prisma, {
        userId: args.userId,
        problemId: args.problemId,
        ...proposal,
      });
      acceptedStrategyProposalCount += 1;
    } catch (error) {
      rejectedStrategyProposalCount += 1;
      await appendL1TraceEvent(prisma, {
        userId: args.userId,
        eventType: "fact_rejected",
        source: "memory_agent:reflect",
        content: error instanceof Error ? error.message : String(error),
        eventJson: { proposal },
      });
    }
  }

  let auditResult: Awaited<ReturnType<typeof arbitrateFactCandidates>> = {
    updated: [],
    rejected: [],
  };
  const auditOpcode = summarizeArbitrationOpcode(output.factAudits);
  await appendClaimedReflectionEvent(args.traceContext, {
    stage: "reflection_arbitration",
    kind: "memory",
    title: "L2 fact audit arbitration",
    status: output.factAudits.length > 0 ? "succeeded" : "skipped",
    details: {
      input: {
        source: "reflection",
        candidates: output.factAudits,
      },
      output:
        output.factAudits.length > 0
          ? { decision: "dispatch_to_deterministic_state_machine" }
          : { decision: "skipped", reason: "no_candidate" },
      metadata: {
        operation: "arbitration",
        source: "reflection",
        opcode: auditOpcode,
        decision: output.factAudits.length > 0 ? "pending" : "skipped",
        reason: output.factAudits.length > 0 ? null : "no_candidate",
        candidateCount: output.factAudits.length,
        finalDecisionOwner: "arbitrateFactCandidates",
        llmDecidesFinalState: false,
      },
    },
  });
  if (output.factAudits.length > 0) {
    auditResult = await arbitrateFactCandidates(prisma, {
      userId: args.userId,
      problemId: args.problemId,
      source: "reflection",
      candidates: output.factAudits,
    });
    await appendClaimedReflectionEvent(args.traceContext, {
      stage: "reflection_arbitration",
      kind: "memory",
      title: "L2 fact audit arbitration result",
      status: "succeeded",
      details: {
        input: {
          source: "reflection",
          candidateCount: output.factAudits.length,
        },
        output: {
          auditedFactIds: auditResult.updated.map((fact) => fact.id),
          rejectedFactAuditCount: auditResult.rejected.length,
        },
        memoryDelta: {
          durableRowIds: auditResult.updated.map((fact) => fact.id),
        },
        metadata: {
          operation:
            auditResult.updated.length > 0
              ? "durable_fact_change"
              : "arbitration_result",
          source: "reflection",
          opcode: auditOpcode,
          decision: auditResult.updated.length > 0 ? "arbitrated" : "no_change",
          acceptedCount: auditResult.updated.length,
          rejectedCount: auditResult.rejected.length,
          finalDecisionOwner: "arbitrateFactCandidates",
          llmDecidesFinalState: false,
        },
      },
    });
  }

  await appendClaimedReflectionEvent(args.traceContext, {
    stage: "reflection_persistence",
    kind: "persistence",
    title: "Persist reflection results",
    status: "succeeded",
    details: {
      input: {
        slotUpsertCount: output.slotUpserts.length,
        strategyProposalCount: output.strategyProposals.length,
        factAuditCount: output.factAudits.length,
      },
      output: {
        acceptedSlotIds: persistedSlots.map((slot) => slot.id),
        rejectedSlotCount,
        acceptedStrategyProposalCount,
        rejectedStrategyProposalCount,
        auditedFactIds: auditResult.updated.map((fact) => fact.id),
        rejectedFactAuditCount: auditResult.rejected.length,
      },
      memoryDelta: {
        durableRowIds: [
          ...persistedSlots.map((slot) => slot.id),
          ...auditResult.updated.map((fact) => fact.id),
        ],
      },
      metadata: {
        operation: "reflection_persistence",
        factAuditChannel: "arbitrateFactCandidates",
        llmDecidesConfidence: false,
      },
    },
  });

  const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
    userId: args.userId,
    factIds: [
      ...new Set([
        ...(args.changedFactIds ?? []),
        ...auditResult.updated.map((fact) => fact.id),
      ]),
    ],
    slotIds: persistedSlots.map((slot) => slot.id),
    provider:
      args.retrievalTextProvider ??
      (args.provider?.name.startsWith("mock-")
        ? createDeterministicRetrievalTextRefreshProvider()
        : undefined),
  });
  if (retrievalRefresh.failed.length > 0) {
    throw new Error(
      `retrieval_text_refresh_failed:${retrievalRefresh.failed
        .map(({ sourceId, reason }) => `${sourceId}:${reason}`)
        .join(",")}`,
    );
  }

  if (args.ftsStore) {
    await reconcileLearnerMemoryRetrievalDocuments(prisma, {
      userId: args.userId,
      ftsStore: args.ftsStore,
    });
  }

  return {
    skipped: false,
    episodeCount: episodes.length,
    changedFactCount: changedFacts.length,
    strategySignalCount: strategySignals.length,
    strategyObservationCount: observations.size,
    acceptedSlotIds: persistedSlots.map((slot) => slot.id),
    rejectedSlotCount,
    acceptedStrategyProposalCount,
    rejectedStrategyProposalCount,
    auditedFactIds: auditResult.updated.map((fact) => fact.id),
    rejectedFactAuditCount: auditResult.rejected.length,
  };
}

async function appendClaimedReflectionEvent(
  traceContext: TraceContext | undefined,
  input: Parameters<typeof appendTraceEventBestEffort>[1],
) {
  if (!traceContext) return;
  await appendTraceEventBestEffort(traceContext, input);
}

function summarizeArbitrationOpcode(
  candidates: Array<{ evidenceKind?: unknown }>,
) {
  const opcodes = [
    ...new Set(
      candidates
        .map((candidate) => candidate.evidenceKind)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
  if (opcodes.length === 0) return "none";
  return opcodes.length === 1 ? opcodes[0] : "mixed";
}

export function hasMemorySynthesisFailureTraceWritten(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as ReflectionFailureTraceWritten).memorySynthesisFailureTraceWritten,
  );
}

async function appendReflectionFailureTrace(
  prisma: PrismaClient,
  input: {
    args: RunReflectionArgs;
    providerName: string;
    durationMs: number;
    traceRunId: string;
    llmMsTotal: number;
    changedFactCount: number;
    episodeCount: number;
    activeSlotCount: number;
    error: unknown;
  },
) {
  await appendL1TraceEvent(prisma, {
    userId: input.args.userId,
    problemId: input.args.problemId,
    reviewAttemptId: input.args.reviewAttemptId,
    eventType: "memory_synthesis_failed",
    source: "memory_agent:reflect",
    content:
      input.error instanceof Error ? input.error.message : String(input.error),
    eventJson: {
      traceRunId: input.traceRunId,
      provider: input.providerName,
      durationMs: input.durationMs,
      changedFactIds: input.args.changedFactIds ?? [],
      changedFactCount: input.changedFactCount,
      episodeCount: input.episodeCount,
      activeSlotCount: input.activeSlotCount,
      timings: {
        totalMs: input.durationMs,
        llmMsTotal: input.llmMsTotal,
      },
      error: normalizeProviderError(input.error),
    },
  });
}

function markReflectionFailureTraceWritten(error: unknown): unknown {
  if (error && typeof error === "object") {
    (
      error as ReflectionFailureTraceWritten
    ).memorySynthesisFailureTraceWritten = true;
  }

  return error;
}

async function loadChangedFacts(
  prisma: Pick<PrismaClient, "l2MemoryFact">,
  args: RunReflectionArgs,
) {
  if (args.changedFactIds && args.changedFactIds.length > 0) {
    const changedFactIds = [...new Set(args.changedFactIds)];
    const seedRows = await prisma.l2MemoryFact.findMany({
      where: { id: { in: changedFactIds }, userId: args.userId },
    });
    const trustedSeedsById = new Map(
      seedRows
        .filter(isTrustedL2FactForConsumption)
        .map((fact) => [fact.id, fact]),
    );
    const seeds = changedFactIds.flatMap((id) => {
      const fact = trustedSeedsById.get(id);
      return fact ? [fact] : [];
    });
    // Reflection is deliberately open-world. The LLM receives the changed
    // claims plus a bounded recent learner set and groups them by meaning. A
    // canonical mechanism (when one happens to exist) is metadata, not a gate.
    const relatedRows = await prisma.l2MemoryFact.findMany({
      where: {
        userId: args.userId,
        id: { notIn: changedFactIds },
        factType: { not: "strategy" },
        memoryOrigin: "learner",
      },
      orderBy: { lastSeenAt: "desc" },
      take: 40,
    });
    const related = relatedRows.filter(isTrustedL2FactForConsumption);
    return [...seeds, ...related];
  }

  const rows = await prisma.l2MemoryFact.findMany({
    where: { userId: args.userId, factType: { not: "strategy" } },
    orderBy: { lastSeenAt: "desc" },
    take: 12,
  });
  return rows.filter(isTrustedL2FactForConsumption);
}

function extractStrategySignals(event: { eventJson: string }) {
  try {
    const payload = JSON.parse(event.eventJson) as {
      strategySignals?: Array<{
        tag: string;
        observation: string;
        polarity: "positive" | "negative";
        userSelfCorrected?: boolean;
      }>;
    };
    return payload.strategySignals ?? [];
  } catch {
    return [];
  }
}

function parseClaimScope(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.level !== "string") return undefined;
    return {
      level: record.level,
      problemIds: Array.isArray(record.problemIds)
        ? record.problemIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      topicHints: Array.isArray(record.topicHints)
        ? record.topicHints.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      context: typeof record.context === "string" ? record.context : undefined,
    };
  } catch {
    return undefined;
  }
}

async function buildObservationInput(
  prisma: Pick<PrismaClient, "chatMessage" | "l1MemoryEvent">,
  args: {
    appliedEvents: Array<{
      eventJson: string;
      chatSessionId: string | null;
    }>;
    episodes: Array<{
      sourceTraceIds: string;
      tags: string;
      outcome: string;
      chatSessionId: string | null;
    }>;
    mistakeFacts: Array<{
      tag: string;
      evidenceTraceIds: string;
    }>;
    hintEvents: Array<{
      chatSessionId: string | null;
      eventJson: string;
    }>;
    signals: StrategyObservationInput["signals"];
  },
): Promise<{
  input: StrategyObservationInput;
  evidenceTraceIdsByTag: Map<string, string[]>;
}> {
  const appliedPayloads = args.appliedEvents.map(extractAppliedStrategy).filter(
    (
      payload,
    ): payload is {
      strategyTag: string;
      appliedAssistantMessageId: string;
      chatSessionId: string;
    } => Boolean(payload),
  );
  const assistantMessages = await prisma.chatMessage.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            appliedPayloads.map((payload) => payload.appliedAssistantMessageId),
          ),
        ],
      },
    },
  });
  const messageById = new Map(
    assistantMessages.map((message) => [message.id, message]),
  );
  const appliedEvents = appliedPayloads
    .map((payload) => {
      const message = messageById.get(payload.appliedAssistantMessageId);
      if (
        !message ||
        message.role !== "assistant" ||
        message.sessionId !== payload.chatSessionId
      ) {
        return undefined;
      }

      return {
        strategyTag: payload.strategyTag,
        appliedAssistantMessageId: payload.appliedAssistantMessageId,
        chatSessionId: message.sessionId,
        anchorSequence: message.sequence,
      };
    })
    .filter(
      (event): event is StrategyObservationInput["appliedEvents"][number] =>
        Boolean(event),
    );
  const mistakeEvidenceTraceIds = args.mistakeFacts.flatMap((fact) =>
    parseStringArray(fact.evidenceTraceIds),
  );
  const anchors = await resolveEpisodeAnchors(
    prisma,
    args.episodes,
    mistakeEvidenceTraceIds,
  );

  const input: StrategyObservationInput = {
    appliedEvents,
    episodesAfter: anchors.episodesAfter,
    repeatMistakeEvidence: args.mistakeFacts.flatMap((fact) =>
      parseStringArray(fact.evidenceTraceIds).flatMap((traceId) => {
        const anchor = anchors.traceAnchorById.get(traceId);
        const payload = anchors.tracePayloadById.get(traceId);
        if (!anchor || !payloadHasMistakeTag(payload, fact.tag)) {
          return [];
        }

        return [
          {
            tag: fact.tag,
            chatSessionId: anchor.chatSessionId,
            sequence: anchor.sequence,
          },
        ];
      }),
    ),
    hintEvents: args.hintEvents
      .map(extractHintEvent)
      .filter(
        (
          event,
        ): event is NonNullable<
          StrategyObservationInput["hintEvents"]
        >[number] => Boolean(event),
      ),
    signals: args.signals,
  };
  const evidenceTraceIdsByTag = new Map<string, string[]>();
  const addEvidence = (tag: string, traceIds: string[]) => {
    const normalized = normalizeMemoryTag(tag);
    evidenceTraceIdsByTag.set(normalized, [
      ...new Set([
        ...(evidenceTraceIdsByTag.get(normalized) ?? []),
        ...traceIds,
      ]),
    ]);
  };

  for (const applied of appliedEvents) {
    const episodeTraceIds = args.episodes.flatMap((episode, index) => {
      const observed = input.episodesAfter[index];
      if (!observed || !isPostApplyObservation(applied, observed)) return [];
      return parseStringArray(episode.sourceTraceIds);
    });
    const postApplyMistakeTraceIds = args.mistakeFacts.flatMap((fact) => {
      if (
        normalizeMemoryTag(fact.tag) !== normalizeMemoryTag(applied.strategyTag)
      ) {
        return [];
      }
      return parseStringArray(fact.evidenceTraceIds).filter((traceId) => {
        const anchor = anchors.traceAnchorById.get(traceId);
        return anchor ? isPostApplyObservation(applied, anchor) : false;
      });
    });
    addEvidence(applied.strategyTag, [
      ...episodeTraceIds,
      ...postApplyMistakeTraceIds,
    ]);
  }

  return { input, evidenceTraceIdsByTag };
}

function isPostApplyObservation(
  applied: StrategyObservationInput["appliedEvents"][number],
  observed: {
    chatSessionId: string | null;
    sequence?: number | null;
    startSequence?: number | null;
  },
) {
  const sequence = observed.sequence ?? observed.startSequence;
  return (
    observed.chatSessionId === applied.chatSessionId &&
    sequence !== undefined &&
    sequence !== null &&
    sequence > applied.anchorSequence
  );
}

async function resolveEpisodeAnchors(
  prisma: Pick<PrismaClient, "chatMessage" | "l1MemoryEvent">,
  episodes: Array<{
    sourceTraceIds: string;
    tags: string;
    outcome: string;
    chatSessionId: string | null;
  }>,
  extraTraceIds: string[] = [],
) {
  const episodeSourceTraceIds = episodes.map((episode) =>
    parseStringArray(episode.sourceTraceIds),
  );
  const traceIds = [
    ...new Set([...episodeSourceTraceIds.flat(), ...extraTraceIds]),
  ];
  const traces =
    traceIds.length > 0
      ? await prisma.l1MemoryEvent.findMany({ where: { id: { in: traceIds } } })
      : [];
  const tracePayloads = traces.map((trace) => ({
    trace,
    payload: parseRecord(trace.eventJson),
  }));
  const tracePayloadById = new Map(
    tracePayloads.map(({ trace, payload }) => [trace.id, payload]),
  );
  const messageIds = [
    ...new Set(
      tracePayloads
        .map(({ payload }) => readString(payload.chatMessageId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const messages =
    messageIds.length > 0
      ? await prisma.chatMessage.findMany({ where: { id: { in: messageIds } } })
      : [];
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const directTraceAnchorById = new Map<
    string,
    { chatSessionId: string; sequence: number }
  >();

  for (const { trace, payload } of tracePayloads) {
    const messageId = readString(payload.chatMessageId);
    const message = messageId ? messageById.get(messageId) : undefined;
    if (message) {
      directTraceAnchorById.set(trace.id, {
        chatSessionId: message.sessionId,
        sequence: message.sequence,
      });
      continue;
    }

    const sequence =
      readNumber(payload.assistantSequence) ?? readNumber(payload.sequence);
    if (trace.chatSessionId && sequence !== undefined) {
      directTraceAnchorById.set(trace.id, {
        chatSessionId: trace.chatSessionId,
        sequence,
      });
    }
  }

  const traceAnchorById = new Map(directTraceAnchorById);
  const episodesAfter = episodes.map((episode, index) => {
    const sourceIds = episodeSourceTraceIds[index] ?? [];
    const anchors = sourceIds
      .map((traceId) => directTraceAnchorById.get(traceId))
      .filter(
        (anchor): anchor is { chatSessionId: string; sequence: number } =>
          anchor !== undefined &&
          anchor.chatSessionId === episode.chatSessionId,
      );
    const startSequence =
      anchors.length > 0
        ? Math.min(...anchors.map((anchor) => anchor.sequence))
        : null;

    if (episode.chatSessionId && startSequence !== null) {
      for (const traceId of sourceIds) {
        traceAnchorById.set(traceId, {
          chatSessionId: episode.chatSessionId,
          sequence: startSequence,
        });
      }
    }

    return {
      tags: parseStringArray(episode.tags),
      outcome: episode.outcome,
      chatSessionId: episode.chatSessionId,
      startSequence,
    };
  });

  return { episodesAfter, traceAnchorById, tracePayloadById };
}

function extractAppliedStrategy(event: {
  eventJson: string;
  chatSessionId: string | null;
}):
  | {
      strategyTag: string;
      appliedAssistantMessageId: string;
      chatSessionId: string;
    }
  | undefined {
  try {
    const payload = JSON.parse(event.eventJson) as {
      strategyTag?: string;
      appliedAssistantMessageId?: string;
    };
    return payload.strategyTag &&
      payload.appliedAssistantMessageId &&
      event.chatSessionId
      ? {
          strategyTag: payload.strategyTag,
          appliedAssistantMessageId: payload.appliedAssistantMessageId,
          chatSessionId: event.chatSessionId,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function extractHintEvent(event: {
  chatSessionId: string | null;
  eventJson: string;
}): NonNullable<StrategyObservationInput["hintEvents"]>[number] | undefined {
  const payload = parseRecord(event.eventJson);
  if (readString(payload.toolName) !== "get_algorithm_hint") {
    return undefined;
  }

  const result = asRecord(payload.result);
  const level = readNumber(result?.level);
  const sequence =
    readNumber(payload.assistantSequence) ?? readNumber(payload.sequence);
  if (!event.chatSessionId || level === undefined || sequence === undefined) {
    return undefined;
  }

  return {
    chatSessionId: event.chatSessionId,
    sequence,
    level,
  };
}

function payloadHasMistakeTag(
  payload: Record<string, unknown> | undefined,
  tag: string,
) {
  const diagnosis = asRecord(payload?.diagnosis);
  const mistakeTags = readStringArray(diagnosis?.mistakeTags).map(
    normalizeMemoryTag,
  );
  return mistakeTags.includes(normalizeMemoryTag(tag));
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
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
