import type { PrismaClient } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  ACTIVITY_EXTRACTION_VERSION,
  claimExtractionReceipt,
  completeExtractionReceipt,
  ensureExtractionReceipt,
  failExtractionReceipt,
  loadSealedActivityClusterInput,
} from "@/server/memory/activity-clusters";
import {
  recallClaimRelationCandidates,
  type ClaimRelationCandidateRecall,
} from "@/server/memory/claims/claim-relation-candidate-recall";
import {
  materializeMemoryClaimObservation,
  upsertMemoryClaimObservation,
} from "@/server/memory/claims/open-world-claim-store";
import {
  memoryClaimPolaritySchema,
  memoryClaimTypeSchema,
} from "@/server/memory/claims/open-world-claim-contract";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  stableStringify,
  sha256,
} from "@/server/memory/activity-clusters/activity-source";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import type { VectorStore } from "@/server/memory/store/vector-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import type { EmbedClient } from "@/server/memory/retrieval/embed-client";
import {
  createDeterministicRetrievalTextRefreshProvider,
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";
import {
  createOpenAiCompatibleActivityExtractionProvider,
  type ActivityExtractionProvider,
} from "./activity-extraction-provider";
import { projectSealedActivityForExtraction } from "./project-sealed-activity";
import type {
  ActivityExtractionEnvelope,
  ParsedActivityExtractionInput,
} from "./activity-extraction-contract";
import {
  activityObservationSchema,
  collectDisallowedObservations,
  enforceCoverageStatus,
  isRecallOnlyEvidence,
} from "./activity-extraction-contract";

const LEARNER_EVIDENCE_EVENT_TYPES = new Set([
  "review_attempt",
  "chat_user_message",
  "memory_note",
  "run_evidence",
  "historical_replay_attestation",
  "assisted_repair_chain_closed",
  "self_correction",
  "learner_self_correction",
  "mock_interview_started",
  "mock_interview_turn",
  "mock_interview_run_evidence",
  "mock_interview_code_discussion",
  "mock_interview_feedback",
]);
const MAX_RECALL_LEARNER_TEXT = 600;

export type RunActivityExtractionArgs = {
  activityClusterId: string;
  extractorVersion?: string;
  provider?: ActivityExtractionProvider;
  ftsStore?: FtsStore;
  vectorStore?: VectorStore;
  embedClient?: EmbedClient;
  traceContext?: TraceContext;
  retrievalTextProvider?: RetrievalTextRefreshProvider;
};

export type RunActivityExtractionResult = {
  claimed: boolean;
  receiptId: string;
  receiptStatus: string;
  episodeId?: string;
  observationIds: string[];
  changedFactIds: string[];
  relationFallbacks: Array<{ observationId: string; reason: string }>;
  rejectedObservations: RejectedObservation[];
};

type RejectedObservation = { index: number; reason: string };

export async function runActivityExtraction(
  prisma: PrismaClient,
  args: RunActivityExtractionArgs,
): Promise<RunActivityExtractionResult> {
  const extractorVersion = args.extractorVersion ?? ACTIVITY_EXTRACTION_VERSION;
  const writePolicy = resolveMemoryWritePolicy();
  if (!writePolicy.durableWrites) {
    const receipt = await ensureExtractionReceipt(prisma, {
      activityClusterId: args.activityClusterId,
      extractorVersion,
    });
    const rejected = await prisma.memoryExtractionReceipt.updateMany({
      where: {
        id: receipt.id,
        status: { in: ["queued", "failed"] },
      },
      data: {
        status: "policy_rejected",
        noSemanticReason: `process_origin_not_learner:${writePolicy.origin}`,
        completedAt: new Date(),
      },
    });
    const terminal =
      rejected.count === 1
        ? await prisma.memoryExtractionReceipt.findUniqueOrThrow({
            where: { id: receipt.id },
          })
        : receipt;
    return {
      claimed: false,
      receiptId: terminal.id,
      receiptStatus: terminal.status,
      observationIds: [],
      changedFactIds: [],
      relationFallbacks: [],
      rejectedObservations: [],
    };
  }
  const claim = await claimExtractionReceipt(prisma, {
    activityClusterId: args.activityClusterId,
    extractorVersion,
  });
  if (!claim.claimed) {
    return {
      claimed: false,
      receiptId: claim.receipt.id,
      receiptStatus: claim.receipt.status,
      observationIds: [],
      changedFactIds: [],
      relationFallbacks: [],
      rejectedObservations: [],
    };
  }

  const receiptId = claim.receipt.id;
  try {
    const sealed = await loadSealedActivityClusterInput(
      prisma,
      args.activityClusterId,
    );
    if (
      sealed.cluster.memoryOrigin !== "learner" ||
      !resolveMemoryWritePolicy().durableWrites
    ) {
      // A non-learner cluster normally becomes policy_rejected while ensuring
      // its receipt. This second guard protects against process-origin drift.
      throw new Error("activity_extraction_requires_learner_origin");
    }
    if (claim.receipt.inputHash !== sealed.inputHash) {
      throw new Error("extraction_receipt_input_hash_mismatch");
    }

    const allowedEvidence = collectAllowedLearnerEvidence(sealed.items);
    const problem = sealed.cluster.problemId
      ? await prisma.problem.findUnique({
          where: { id: sealed.cluster.problemId },
          select: { title: true, tags: true },
        })
      : null;
    const initialProjection = projectSealedActivityForExtraction(sealed, {
      allowedLearnerEvidenceTraceIds: allowedEvidence.map((item) => item.id),
      problemTitle: problem?.title,
      problemTags: parseStringArray(problem?.tags),
    });
    const recall = await recallExistingClaims(prisma, initialProjection, {
      ftsStore: args.ftsStore,
      vectorStore: args.vectorStore,
      embedClient: args.embedClient,
      userId: sealed.cluster.userId,
    });
    const extractionInput = projectSealedActivityForExtraction(sealed, {
      allowedLearnerEvidenceTraceIds: allowedEvidence.map((item) => item.id),
      problemTitle: problem?.title,
      problemTags: parseStringArray(problem?.tags),
      existingClaimCandidates: recall.candidates.flatMap((candidate) => {
        const claimType = memoryClaimTypeSchema.safeParse(candidate.claimType);
        const polarity = memoryClaimPolaritySchema.safeParse(
          candidate.polarity,
        );
        return claimType.success && polarity.success
          ? [
              {
                targetFactId: candidate.factId,
                claimType: claimType.data,
                claimText: candidate.claimText,
                polarity: polarity.data,
                scope: candidate.scope,
              },
            ]
          : [];
      }),
    });
    const provider =
      args.provider ?? createOpenAiCompatibleActivityExtractionProvider();
    const output = await provider.extract(extractionInput, args.traceContext);
    const rejectedObservations: RejectedObservation[] =
      collectDisallowedObservations(output, extractionInput);
    for (const rejected of rejectedObservations) {
      await appendRejectedObservationTrace(prisma, {
        sealed,
        index: rejected.index,
        issues: [{ message: rejected.reason }],
        reason: rejected.reason,
      });
    }

    if (
      output.coverage.status === "no_semantic_signal" &&
      rejectedObservations.length === 0
    ) {
      const existingEpisode = await prisma.memoryEpisode.findFirst({
        where: { activityClusterId: sealed.cluster.id },
        orderBy: { createdAt: "asc" },
      });
      if (existingEpisode) {
        const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
          userId: sealed.cluster.userId,
          episodeIds: [existingEpisode.id],
          provider:
            args.retrievalTextProvider ??
            (args.provider?.name.startsWith("mock-")
              ? createDeterministicRetrievalTextRefreshProvider()
              : undefined),
        });
        if (retrievalRefresh.failed.length > 0) {
          throw new Error("retrieval_text_refresh_failed:no_semantic_signal");
        }
        await reconcileLearnerMemoryRetrievalDocuments(prisma, {
          userId: sealed.cluster.userId,
          ftsStore: args.ftsStore ?? getDefaultFtsStore(),
        });
      }
      const outputHash = sha256(stableStringify(output));
      const receipt = await completeExtractionReceipt(prisma, {
        receiptId,
        status: "no_semantic_signal",
        outputHash,
        noSemanticReason:
          output.coverage.noSemanticSignalReason ??
          "No durable learner observation was extracted.",
      });
      return {
        claimed: true,
        receiptId,
        receiptStatus: receipt.status,
        episodeId: existingEpisode?.id,
        observationIds: [],
        changedFactIds: [],
        relationFallbacks: [],
        rejectedObservations: [],
      };
    }

    const episode = await ensureActivityEpisode(prisma, {
      sealed,
      output,
    });
    const evidenceById = new Map(
      allowedEvidence.map((evidence) => [evidence.id, evidence]),
    );
    const observationIds: string[] = [];
    const changedFactIds: string[] = [];
    const relationFallbacks: Array<{
      observationId: string;
      reason: string;
    }> = [];
    const rejectedObservationIndexes = new Set(
      rejectedObservations.map((item) => item.index),
    );

    for (const [index, rawObservation] of output.observations.entries()) {
      if (rejectedObservationIndexes.has(index)) continue;
      const parsed = activityObservationSchema.safeParse(rawObservation);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? "invalid_observation";
        rejectedObservations.push({ index, reason });
        await appendRejectedObservationTrace(prisma, {
          sealed,
          index,
          issues: parsed.error.issues,
          reason,
        });
        continue;
      }
      const extracted = parsed.data;
      // An Episode describes the sealed learner activity. A rejected L2
      // proposal must never erase that independently valid learning record.
      // Treat semantic guard failures as a rejected model observation, just as
      // we already treat schema/allow-list failures above, then keep processing
      // the remaining observations and the Episode retrieval card.
      try {
        validateObservationForExtraction(extracted, extractionInput);
      } catch (error) {
        const reason = errorMessage(error);
        rejectedObservations.push({ index, reason });
        await appendRejectedObservationTrace(prisma, {
          sealed,
          index,
          issues: [{ message: reason }],
          reason,
        });
        continue;
      }
      const observation = await upsertMemoryClaimObservation(prisma, {
        userId: sealed.cluster.userId,
        activityClusterId: sealed.cluster.id,
        problemId: sealed.cluster.problemId ?? undefined,
        episodeId: episode.id,
        claimType: extracted.claimType,
        claimText: extracted.claimText,
        polarity: extracted.polarity,
        scope: extracted.scope,
        mechanismKeys: extracted.mechanismKeys,
        source: "memory_agent_activity_extraction",
        evidenceStrength: extracted.evidenceStrength,
      });
      observationIds.push(observation.id);
      const evidence = extracted.evidenceTraceIds.map((traceId) => {
        const mapped = evidenceById.get(traceId);
        if (!mapped)
          throw new Error(`observation_evidence_not_allowed:${traceId}`);
        return materializationEvidence(mapped, extracted.evidenceStrength);
      });
      let materialized;
      try {
        materialized = await materializeMemoryClaimObservation(prisma, {
          observationId: observation.id,
          relation: extracted.relationProposal
            ? {
                targetClusterFactId: extracted.relationProposal.targetFactId,
                relation: extracted.relationProposal.relation,
                modelConfidence: extracted.relationProposal.modelConfidence,
                rationale: extracted.relationProposal.rationale,
              }
            : undefined,
          evidence,
        });
      } catch (error) {
        if (!extracted.relationProposal || !isMissingRelationTarget(error)) {
          throw error;
        }
        materialized = {
          observationId: observation.id,
          fact: null,
          rejectionReason: errorMessage(error),
        };
      }
      if (materialized.rejectionReason && extracted.relationProposal) {
        relationFallbacks.push({
          observationId: observation.id,
          reason: materialized.rejectionReason,
        });
        materialized = await materializeMemoryClaimObservation(prisma, {
          observationId: observation.id,
          evidence,
        });
      }
      if (materialized.fact) changedFactIds.push(materialized.fact.id);
    }

    // `output.coverage` is derived before semantic guards run. If every model
    // observation is later rejected, this is still a valid Episode-only
    // extraction rather than a failed activity or an L2 claim.
    const effectiveCoverageStatus =
      observationIds.length > 0
        ? "complete"
        : output.coverage.status === "no_semantic_signal"
          ? "no_semantic_signal"
          : "episode_only";
    enforceCoverageStatus(effectiveCoverageStatus, observationIds.length);
    const uniqueChangedFactIds = [...new Set(changedFactIds)];
    const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
      userId: sealed.cluster.userId,
      episodeIds: [episode.id],
      factIds: uniqueChangedFactIds,
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
    // Episode and claim-cluster documents become searchable in the extraction
    // worker only after source-owned retrieval prose is current.
    await reconcileLearnerMemoryRetrievalDocuments(prisma, {
      userId: sealed.cluster.userId,
      ftsStore: args.ftsStore ?? getDefaultFtsStore(),
    });
    const outputHash = sha256(stableStringify(output));
    const receipt = await completeExtractionReceipt(prisma, {
      receiptId,
      status: rejectedObservations.length > 0 ? "partial" : "succeeded",
      outputHash,
    });
    return {
      claimed: true,
      receiptId,
      receiptStatus: receipt.status,
      episodeId: episode.id,
      observationIds,
      changedFactIds: uniqueChangedFactIds,
      relationFallbacks,
      rejectedObservations,
    };
  } catch (error) {
    await failExtractionReceipt(prisma, {
      receiptId,
      errorMessage: errorMessage(error),
    });
    throw error;
  }
}

function collectAllowedLearnerEvidence(
  items: Awaited<ReturnType<typeof loadSealedActivityClusterInput>>["items"],
) {
  return items.flatMap((item) => {
    if (item.sourceType !== "l1_event") return [];
    const eventType = readString(item.payload, "eventType");
    if (!eventType || !LEARNER_EVIDENCE_EVENT_TYPES.has(eventType)) return [];
    if (eventType === "mock_interview_turn") {
      const event = readRecord(item.payload?.event);
      if (event.role === "assistant" || event.role === "interviewer") return [];
    }
    return [
      {
        id: item.sourceId,
        eventType,
        payload: item.payload ?? {},
        revisionKey: evidenceRevisionKey(item.payload, item.sourceId),
      },
    ];
  });
}

async function recallExistingClaims(
  prisma: PrismaClient,
  input: ParsedActivityExtractionInput,
  args: {
    userId: string;
    ftsStore?: FtsStore;
    vectorStore?: VectorStore;
    embedClient?: EmbedClient;
  },
): Promise<ClaimRelationCandidateRecall> {
  const learnerText = input.items
    .filter((item) => item.speaker === "learner")
    .map((item) => item.text)
    .join(" ")
    .slice(0, MAX_RECALL_LEARNER_TEXT);
  const query = [
    input.cluster.problemTitle ?? "",
    input.cluster.candidateMechanismKeys.join(" ").replace(/_/g, " "),
    learnerText,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return recallClaimRelationCandidates(prisma, {
    userId: args.userId,
    query,
    limit: 12,
    ftsStore: args.ftsStore,
    vectorStore: args.vectorStore,
    embedClient: args.embedClient,
  });
}

async function ensureActivityEpisode(
  prisma: PrismaClient,
  args: {
    sealed: Awaited<ReturnType<typeof loadSealedActivityClusterInput>>;
    output: ActivityExtractionEnvelope;
  },
) {
  const existing = await prisma.memoryEpisode.findFirst({
    where: { activityClusterId: args.sealed.cluster.id },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return prisma.memoryEpisode.create({
    data: {
      userId: args.sealed.cluster.userId,
      problemId: args.sealed.cluster.problemId,
      chatSessionId: args.sealed.cluster.chatSessionId,
      activityClusterId: args.sealed.cluster.id,
      kind: "chat_segment",
      title: args.output.episode.title,
      summary: args.output.episode.summary,
      outcome: normalizeEpisodeOutcome(args.output.episode.outcome),
      tags: JSON.stringify(args.output.episode.tags),
      salience: args.output.episode.salience,
      sourceTraceIds: JSON.stringify(args.output.episode.evidenceTraceIds),
      memoryOrigin: "learner",
      createdAt: args.sealed.cluster.endedAt ?? args.sealed.cluster.startedAt,
    },
  });
}

function validateObservationForExtraction(
  observation: ReturnType<typeof activityObservationSchema.parse>,
  input: ParsedActivityExtractionInput,
) {
  const allowed = new Set(input.allowedLearnerEvidenceTraceIds);
  const targetFactIds = new Set(
    input.existingClaimCandidates.map((candidate) => candidate.targetFactId),
  );
  for (const id of observation.evidenceTraceIds) {
    if (!allowed.has(id))
      throw new Error(`observation_evidence_not_allowed:${id}`);
  }
  if (
    observation.evidenceTraceIds.every((id) => isRecallOnlyEvidence(input, id))
  ) {
    throw new Error("retrieval_intent_cannot_create_l2_observation");
  }
  const relation = observation.relationProposal;
  if (relation && !targetFactIds.has(relation.targetFactId)) {
    throw new Error(`relation_target_not_supplied:${relation.targetFactId}`);
  }
}

async function appendRejectedObservationTrace(
  prisma: PrismaClient,
  args: {
    sealed: Awaited<ReturnType<typeof loadSealedActivityClusterInput>>;
    index: number;
    reason: string;
    issues: unknown;
  },
) {
  await appendL1TraceEvent(prisma, {
    userId: args.sealed.cluster.userId,
    problemId: args.sealed.cluster.problemId ?? undefined,
    chatSessionId: args.sealed.cluster.chatSessionId ?? undefined,
    eventType: "fact_rejected",
    source: "memory_agent:extract_activity",
    content: `observation ${args.index} rejected: ${args.reason}`,
    eventJson: {
      activityClusterId: args.sealed.cluster.id,
      index: args.index,
      issues: args.issues,
    },
    memoryOrigin: "learner",
  });
}

function materializationEvidence(
  evidence: {
    id: string;
    eventType: string;
    payload: Record<string, unknown>;
    revisionKey: string;
  },
  evidenceStrength: "observed" | "inferred" | "user_explicit",
) {
  const status = readNestedString(evidence.payload, "event", "status");
  const execution =
    evidence.eventType === "run_evidence" ||
    evidence.eventType === "historical_replay_attestation" ||
    evidence.eventType === "mock_interview_run_evidence";
  const evidenceRole =
    evidence.eventType === "assisted_repair_chain_closed"
      ? ("assisted_repair" as const)
      : evidence.eventType.includes("self_correction")
        ? ("self_correction" as const)
        : execution
          ? status === "passed_visible_tests"
            ? ("execution_success" as const)
            : ("execution_failure" as const)
          : ("learner_statement" as const);
  const authority =
    execution || evidenceRole === "assisted_repair"
      ? ("verified" as const)
      : evidenceStrength === "user_explicit" ||
          evidence.eventType === "memory_note"
        ? ("explicit" as const)
        : ("observed" as const);
  return {
    evidenceRole,
    authority,
    revisionKey: evidence.revisionKey,
    evidenceTraceIds: [evidence.id],
  };
}

function evidenceRevisionKey(
  payload: Record<string, unknown> | undefined,
  fallback: string,
) {
  return (
    readNestedString(payload, "event", "executionFingerprint") ??
    readNestedString(payload, "event", "codeHash") ??
    readNestedString(payload, "event", "revisionKey") ??
    fallback
  );
}

function normalizeEpisodeOutcome(
  outcome: ActivityExtractionEnvelope["episode"]["outcome"],
) {
  if (outcome === "improved" || outcome === "informational") return "resolved";
  return outcome;
}

function readString(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNestedString(
  value: Record<string, unknown> | undefined,
  parent: string,
  key: string,
) {
  return readString(readRecord(value?.[parent]), key);
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isMissingRelationTarget(error: unknown) {
  return errorMessage(error) === "claim_relation_target_not_found";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
