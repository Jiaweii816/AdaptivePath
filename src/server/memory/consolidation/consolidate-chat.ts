import type { PrismaClient } from "@prisma/client";
import { enqueueEmbedBackfill } from "@/server/jobs/enqueue-embed-backfill";
import { enqueueReflection } from "@/server/jobs/enqueue-reflection";
import { normalizeProviderError } from "@/server/llm/provider-error";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { detectToolProtocolLeak } from "@/server/llm/tool-protocol-leak";
import {
  appendTraceEventBestEffort,
  createTraceContext,
  type TraceContext,
} from "@/server/llm/trace-context";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import {
  createMemoryEpisode,
  isSafeEpisodeForIndexing,
} from "@/server/memory/store/episode-store";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import type { FactCandidate } from "@/server/memory/memory.types";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  createDeterministicRetrievalTextRefreshProvider,
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";
import {
  parseMemoryOrigin,
  resolveMemoryWritePolicy,
} from "@/server/memory/memory-origin";
import {
  getChatConsolidationProvider,
  type ChatConsolidationProvider,
} from "./consolidation-provider";

export type RunChatConsolidationArgs = {
  chatSessionId: string;
  triggerReason: string;
  provider?: ChatConsolidationProvider;
  retrievalTextProvider?: RetrievalTextRefreshProvider;
  ftsStore?: FtsStore;
  /** Claimed memory_background child Run supplied by the durable dispatcher. */
  traceContext?: TraceContext;
  /** Foreground root retained across every nested MemoryAgent job. */
  originatingTraceRunId?: string;
  /** Direct parent for nested jobs; the current child Run while executing. */
  parentTraceRunId?: string;
};

export type ChatConsolidationResult = {
  skipped: boolean;
  episodeId?: string;
  acceptedFactIds: string[];
  rejectedFactCount: number;
  nestedJobKinds: Array<"embed_backfill" | "reflection">;
};

export async function runChatConsolidation(
  prisma: PrismaClient,
  args: RunChatConsolidationArgs,
): Promise<ChatConsolidationResult> {
  const session = await prisma.chatSession.findUniqueOrThrow({
    where: { id: args.chatSessionId },
    include: { problem: true },
  });
  const memoryOrigin = parseMemoryOrigin(session.memoryOrigin);
  if (args.traceContext && args.traceContext.memoryOrigin !== memoryOrigin) {
    throw new Error(
      "Chat consolidation origin does not match its parent turn.",
    );
  }
  const traceContext =
    args.traceContext ??
    createTraceContext({
      prisma,
      userId: session.userId,
      path: "memory",
      task: "memory.consolidate_chat",
      problemId: session.problemId,
      chatSessionId: session.id,
      memoryOrigin,
    });

  const lastConsolidatedSequence = session.lastConsolidatedMessageId
    ? ((
        await prisma.chatMessage.findUnique({
          where: {
            id: session.lastConsolidatedMessageId,
            memoryOrigin,
          },
        })
      )?.sequence ?? 0)
    : 0;
  const cursorSequence = Math.max(
    lastConsolidatedSequence,
    session.clearedBeforeSequence,
  );
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId: session.id,
      memoryOrigin,
      sequence: { gt: cursorSequence },
    },
    orderBy: { sequence: "asc" },
  });
  const consolidatableMessages = messages.filter(
    (message) =>
      !isExcludedFromConsolidation(message.metadataJson) &&
      !(
        message.role === "assistant" &&
        detectToolProtocolLeak(message.contentMarkdown)
      ),
  );

  if (
    messages.length === 0 ||
    !consolidatableMessages.some((message) => message.role === "user")
  ) {
    await appendClaimedWorkerEvent(args.traceContext, {
      stage: "consolidation_input",
      kind: "retrieval",
      title: "Load chat segment for consolidation",
      status: "skipped",
      details: {
        retrieval: {
          messageCount: messages.length,
          consolidatableMessageCount: consolidatableMessages.length,
        },
        metadata: {
          operation: "load_chat_consolidation_segment",
          skipReason:
            messages.length === 0
              ? "no_messages_after_cursor"
              : "no_user_message",
        },
      },
    });
    return {
      skipped: true,
      acceptedFactIds: [],
      rejectedFactCount: 0,
      nestedJobKinds: [],
    };
  }

  const messageIds = new Set(
    consolidatableMessages.map((message) => message.id),
  );
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const traceEvents = await prisma.l1MemoryEvent.findMany({
    where: {
      chatSessionId: session.id,
      eventType: { in: ["chat_user_message", "chat_reply"] },
    },
    orderBy: { createdAt: "asc" },
  });
  const evidence = traceEvents
    .filter((event) => {
      const messageId = parseTraceMessageId(event.eventJson);
      return messageId ? messageIds.has(messageId) : false;
    })
    .sort((a, b) => {
      const aSequence =
        messageById.get(parseTraceMessageId(a.eventJson) ?? "")?.sequence ?? 0;
      const bSequence =
        messageById.get(parseTraceMessageId(b.eventJson) ?? "")?.sequence ?? 0;
      return aSequence - bSequence;
    });
  const allPlannedEvents = await prisma.l1MemoryEvent.findMany({
    where: {
      chatSessionId: session.id,
      eventType: "strategy_planned",
    },
    orderBy: { createdAt: "asc" },
  });
  const plannedStrategies = allPlannedEvents
    .map(parsePlannedStrategy)
    .filter((entry) => entry && messageIds.has(entry.assistantMessageId))
    .filter(
      (entry): entry is { strategyTag: string; assistantMessageId: string } =>
        Boolean(entry),
    );
  const provider = args.provider ?? getChatConsolidationProvider();
  const problemTags = parseTags(session.problem?.tags);
  const startedAt = Date.now();
  await appendClaimedWorkerEvent(args.traceContext, {
    stage: "consolidation_input",
    kind: "retrieval",
    title: "Load chat segment for consolidation",
    status: "succeeded",
    details: {
      retrieval: {
        messageIds: consolidatableMessages.map((message) => message.id),
        evidenceTraceIds: evidence.map((event) => event.id),
        plannedStrategies,
      },
      metadata: {
        operation: "load_chat_consolidation_segment",
        triggerReason: args.triggerReason,
        cursorSequence,
        messageCount: consolidatableMessages.length,
        evidenceCount: evidence.length,
      },
    },
  });

  try {
    const output = await provider.consolidate(
      {
        problemTitle:
          session.problem?.title ?? session.title ?? "unknown problem",
        problemTags,
        triggerReason: args.triggerReason,
        currentRollingSummary: session.rollingSummary ?? undefined,
        evidenceTraceIds: evidence.map((event) => event.id),
        plannedStrategies,
        messages: consolidatableMessages
          .filter(
            (message) =>
              message.role === "user" || message.role === "assistant",
          )
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.contentMarkdown,
          })),
      },
      traceContext,
    );
    const allowedEvidenceTraceIds = new Set(evidence.map((event) => event.id));
    const factCandidates = filterConsolidationFactCandidates(
      output.factCandidates,
      allowedEvidenceTraceIds,
    );
    const arbitrationOpcode = summarizeArbitrationOpcode(factCandidates);
    await appendClaimedWorkerEvent(args.traceContext, {
      stage: "consolidation_arbitration",
      kind: "memory",
      title: "L2 fact candidate arbitration",
      status: factCandidates.length > 0 ? "succeeded" : "skipped",
      details: {
        input: {
          source: "chat_consolidation",
          candidates: factCandidates,
        },
        output:
          factCandidates.length > 0
            ? { decision: "dispatch_to_deterministic_state_machine" }
            : { decision: "skipped", reason: "no_candidate" },
        metadata: {
          operation: "arbitration",
          source: "chat_consolidation",
          opcode: arbitrationOpcode,
          decision: factCandidates.length > 0 ? "pending" : "skipped",
          reason: factCandidates.length > 0 ? null : "no_candidate",
          candidateCount: factCandidates.length,
          finalDecisionOwner: "arbitrateFactCandidates",
          llmDecidesFinalState: false,
        },
      },
    });

    const persisted = await prisma.$transaction(async (tx) => {
      const created = await createMemoryEpisode(tx, {
        userId: session.userId,
        problemId: session.problemId,
        chatSessionId: session.id,
        kind: "chat_segment",
        title: output.episodeSummary.title,
        summary: output.episodeSummary.summary,
        outcome: output.episodeSummary.outcome,
        tags: output.episodeSummary.tags,
        salience: output.episodeSummary.salience,
        sourceTraceIds: evidence.map((event) => event.id),
        memoryOrigin: traceContext.memoryOrigin,
      });

      const arbitration = await arbitrateFactCandidates(tx, {
        userId: session.userId,
        problemId: session.problemId,
        source: "chat_consolidation",
        candidates: factCandidates,
      });
      await tx.chatSession.update({
        where: { id: session.id },
        data: {
          rollingSummary: output.newRollingSummary,
          lastConsolidatedMessageId: messages[messages.length - 1].id,
        },
      });
      const plannedSet = new Set(
        plannedStrategies.map(
          (strategy) =>
            `${strategy.strategyTag}@${strategy.assistantMessageId}`,
        ),
      );
      for (const applied of output.strategiesApplied) {
        if (
          !plannedSet.has(
            `${applied.strategyTag}@${applied.appliedAssistantMessageId}`,
          )
        ) {
          continue;
        }
        const assistantMessage = messageById.get(
          applied.appliedAssistantMessageId,
        );
        if (!assistantMessage || assistantMessage.role !== "assistant") {
          continue;
        }

        await appendL1TraceEvent(tx, {
          userId: session.userId,
          problemId: session.problemId,
          chatSessionId: session.id,
          eventType: "strategy_applied",
          memoryOrigin: traceContext.memoryOrigin,
          traceRunId: traceContext.traceRunId,
          source: "memory_agent:consolidate_chat",
          content: `applied strategy ${applied.strategyTag}`,
          occurredAt: assistantMessage.createdAt,
          eventJson: {
            strategyTag: applied.strategyTag,
            appliedAssistantMessageId: applied.appliedAssistantMessageId,
            assistantSequence: assistantMessage.sequence,
          },
        });
      }

      return { episode: created, arbitration };
    });

    if (factCandidates.length > 0) {
      await appendClaimedWorkerEvent(args.traceContext, {
        stage: "consolidation_arbitration",
        kind: "memory",
        title: "L2 arbitration result",
        status: "succeeded",
        details: {
          input: {
            source: "chat_consolidation",
            candidateCount: factCandidates.length,
          },
          output: {
            acceptedFactIds: persisted.arbitration.updated.map(
              (fact) => fact.id,
            ),
            rejectedFactCount: persisted.arbitration.rejected.length,
          },
          memoryDelta: {
            durableRowIds: persisted.arbitration.updated.map((fact) => fact.id),
          },
          metadata: {
            operation:
              persisted.arbitration.updated.length > 0
                ? "durable_fact_change"
                : "arbitration_result",
            source: "chat_consolidation",
            opcode: arbitrationOpcode,
            decision:
              persisted.arbitration.updated.length > 0
                ? "arbitrated"
                : "no_change",
            acceptedCount: persisted.arbitration.updated.length,
            rejectedCount: persisted.arbitration.rejected.length,
            finalDecisionOwner: "arbitrateFactCandidates",
            llmDecidesFinalState: false,
          },
        },
      });
    }

    const episodeEligibleForIndex =
      resolveMemoryWritePolicy().durableWrites &&
      isSafeEpisodeForIndexing(persisted.episode);
    if (episodeEligibleForIndex) {
      const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
        userId: session.userId,
        episodeIds: [persisted.episode.id],
        factIds: persisted.arbitration.updated.map((fact) => fact.id),
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
      await reconcileLearnerMemoryRetrievalDocuments(prisma, {
        userId: session.userId,
        ftsStore: args.ftsStore ?? getDefaultFtsStore(),
      });
    }
    await appendClaimedWorkerEvent(args.traceContext, {
      stage: "consolidation_persistence",
      kind: "memory",
      title: "Persist consolidated memory",
      status: "succeeded",
      details: {
        input: {
          candidateCount: factCandidates.length,
          strategyAppliedCount: output.strategiesApplied.length,
        },
        output: {
          episodeId: persisted.episode.id,
          acceptedFactIds: persisted.arbitration.updated.map((fact) => fact.id),
          rejectedFactCount: persisted.arbitration.rejected.length,
          rollingSummaryUpdated: true,
        },
        memoryDelta: {
          durableRowIds: [
            persisted.episode.id,
            ...persisted.arbitration.updated.map((fact) => fact.id),
          ],
        },
        metadata: {
          operation: "chat_consolidation_persistence",
          deterministicArbitration: true,
        },
      },
    });

    const nestedJobKinds: ChatConsolidationResult["nestedJobKinds"] = [];
    const reflectionNeeded =
      (episodeEligibleForIndex &&
        factCandidates.some(
          (candidate) => candidate.factType === "unresolved_confusion",
        )) ||
      output.strategySignals.length > 0;
    if (episodeEligibleForIndex) {
      await enqueueEmbedBackfill(prisma, {
        originatingTraceRunId: args.originatingTraceRunId,
        parentTraceRunId: traceContext.traceRunId,
      });
      nestedJobKinds.push("embed_backfill");
    }
    if (reflectionNeeded) {
      await enqueueReflection(prisma, {
        userId: session.userId,
        problemId: session.problemId,
        originatingTraceRunId: args.originatingTraceRunId,
        parentTraceRunId: traceContext.traceRunId,
      });
      nestedJobKinds.push("reflection");
    }

    await appendClaimedWorkerEvent(args.traceContext, {
      stage: "nested_background_jobs",
      kind: "background_job",
      title: "Record nested memory jobs",
      status: "succeeded",
      details: {
        output: { nestedJobKinds },
        metadata: {
          operation: "record_nested_background_jobs",
          originatingTraceRunId: args.originatingTraceRunId ?? null,
          parentTraceRunId: traceContext.traceRunId,
          recordedBeforeParentTerminal: true,
        },
      },
    });

    return {
      skipped: false,
      episodeId: persisted.episode.id,
      acceptedFactIds: persisted.arbitration.updated.map((fact) => fact.id),
      rejectedFactCount: persisted.arbitration.rejected.length,
      nestedJobKinds,
    };
  } catch (error) {
    await appendClaimedWorkerEvent(args.traceContext, {
      stage: "consolidation_failure",
      kind: "error",
      title: "Chat consolidation failed",
      status: "failed",
      durationMs: Date.now() - startedAt,
      details: {
        output: { error: normalizeProviderError(error) },
        metadata: {
          operation: "chat_consolidation",
          provider: provider.name,
          triggerReason: args.triggerReason,
        },
      },
    });
    await appendL1TraceEvent(prisma, {
      userId: session.userId,
      problemId: session.problemId,
      chatSessionId: session.id,
      eventType: "consolidation_failed",
      memoryOrigin: traceContext.memoryOrigin,
      traceRunId: traceContext.traceRunId,
      source: "memory_agent:consolidate_chat",
      content: error instanceof Error ? error.message : String(error),
      eventJson: {
        traceRunId: traceContext.traceRunId,
        provider: provider.name,
        durationMs: Date.now() - startedAt,
        triggerReason: args.triggerReason,
        cursorSequence,
        timings: {
          totalMs: Date.now() - startedAt,
          llmMsTotal: traceContext.llmMsTotal,
        },
        error: normalizeProviderError(error),
      },
    });
    throw error;
  }
}

async function appendClaimedWorkerEvent(
  traceContext: TraceContext | undefined,
  input: Parameters<typeof appendTraceEventBestEffort>[1],
) {
  // Legacy direct calls keep their historical unscoped LLM trace behavior.
  // The durable dispatcher supplies a claimed child context for full worker
  // instrumentation and owns its final flush/terminal transition.
  if (!traceContext) return;
  await appendTraceEventBestEffort(traceContext, input);
}

function filterConsolidationFactCandidates(
  candidates: FactCandidate[],
  allowedEvidenceTraceIds: Set<string>,
) {
  return candidates.filter((candidate) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return false;
    }

    const evidenceTraceIds = (candidate as { evidenceTraceIds?: unknown })
      .evidenceTraceIds;
    if (!Array.isArray(evidenceTraceIds)) {
      return false;
    }

    return evidenceTraceIds.every(
      (id) => typeof id === "string" && allowedEvidenceTraceIds.has(id),
    );
  });
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

function isExcludedFromConsolidation(metadataJson: string | null | undefined) {
  const metadata = parseJsonObject(metadataJson);
  if (
    metadata?.type === "review_reply" &&
    readEvidenceClass(metadata.evidenceVerdict) === "local_only"
  ) {
    return true;
  }

  if (metadata?.type !== "chat_reply") {
    return false;
  }

  const evidenceBoundary = parseNestedObject(metadata.evidenceBoundary);
  if (
    evidenceBoundary?.containsAdvisoryRunObservations === true &&
    evidenceBoundary.consolidationPolicy === "exclude_assistant_content"
  ) {
    return true;
  }

  const workspace = parseNestedObject(metadata.workspace);
  const observations = workspace?.currentTurnRunObservations;
  return (
    Array.isArray(observations) &&
    observations.some((observation) => {
      const value = parseNestedObject(observation);
      return value?.authority === "advisory";
    })
  );
}

function readEvidenceClass(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const evidenceClass = (value as { evidenceClass?: unknown }).evidenceClass;
  return typeof evidenceClass === "string" ? evidenceClass : undefined;
}

function parseTraceMessageId(eventJson: string): string | undefined {
  try {
    return (JSON.parse(eventJson) as { chatMessageId?: string }).chatMessageId;
  } catch {
    return undefined;
  }
}

function parseJsonObject(
  value: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseNestedObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseTags(value: string | undefined | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function parsePlannedStrategy(event: {
  eventJson: string;
}): { strategyTag: string; assistantMessageId: string } | undefined {
  try {
    const payload = JSON.parse(event.eventJson) as {
      strategyTag?: string;
      assistantMessageId?: string;
    };
    return payload.strategyTag && payload.assistantMessageId
      ? {
          strategyTag: payload.strategyTag,
          assistantMessageId: payload.assistantMessageId,
        }
      : undefined;
  } catch {
    return undefined;
  }
}
