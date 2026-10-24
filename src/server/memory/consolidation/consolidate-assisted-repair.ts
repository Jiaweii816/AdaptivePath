import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  createDeterministicRetrievalTextRefreshProvider,
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";
import { resolveCanonicalMechanismSignal } from "@/server/problems/hot150-taxonomy";
import {
  getAssistedRepairConsolidationProvider,
  type AssistedRepairConsolidationProvider,
} from "./assisted-repair-provider";
import { verifyAssistedRepairChainClosedEvent } from "./verify-assisted-repair-chain";

export type RunAssistedRepairConsolidationArgs = {
  chainEventId: string;
  provider?: AssistedRepairConsolidationProvider;
  traceContext?: TraceContext;
  ftsStore?: FtsStore;
  retrievalTextProvider?: RetrievalTextRefreshProvider;
};

export type AssistedRepairConsolidationResult = {
  episodeId: string;
  repairKey: string;
  idempotentReplay: boolean;
  attributionStatus?: "attributed" | "uncertain" | "not_attributable";
  canonicalMechanism?: string;
  acceptedFactIds: string[];
  rejectedFactCount: number;
};

export async function runAssistedRepairConsolidation(
  prisma: PrismaClient,
  args: RunAssistedRepairConsolidationArgs,
): Promise<AssistedRepairConsolidationResult> {
  const verified = await verifyAssistedRepairChainClosedEvent(
    prisma,
    args.chainEventId,
  );
  if (
    args.traceContext &&
    (args.traceContext.userId !== verified.userId ||
      args.traceContext.memoryOrigin !== "learner")
  ) {
    throw new Error("Assisted repair consolidation trace scope mismatch.");
  }
  const episodeId = assistedRepairEpisodeId({
    userId: verified.userId,
    repairKey: verified.payload.repairKey,
  });
  const existing = await prisma.memoryEpisode.findUnique({
    where: { id: episodeId },
  });
  if (existing) {
    assertExistingEpisodeMatches(existing, verified);
    await refreshLearnerRetrievalText(prisma, {
      userId: verified.userId,
      episodeIds: [episodeId],
      provider:
        args.retrievalTextProvider ??
        (args.provider?.name.startsWith("mock-")
          ? createDeterministicRetrievalTextRefreshProvider()
          : undefined),
    });
    await reconcileLearnerMemoryRetrievalDocuments(prisma, {
      userId: verified.userId,
      ftsStore: args.ftsStore ?? getDefaultFtsStore(),
    });
    return {
      episodeId,
      repairKey: verified.payload.repairKey,
      idempotentReplay: true,
      acceptedFactIds: [],
      rejectedFactCount: 0,
    };
  }

  const provider = args.provider ?? getAssistedRepairConsolidationProvider();
  // Provider/schema failures intentionally escape so the background job is
  // marked failed; this evidence chain must not degrade to best-effort output.
  const output = await provider.consolidate(
    {
      repairKey: verified.payload.repairKey,
      problemTitle: verified.problemTitle,
      problemTags: verified.problemTags,
      evidenceTraceIds: verified.sourceTraceIds,
      failed: verified.failed,
      userQuestion: verified.userQuestion,
      coachReply: verified.coachReply,
      passed: verified.passed,
    },
    args.traceContext,
  );
  const canonical =
    output.attribution.status === "attributed"
      ? resolveCanonicalMechanismSignal({
          rawTag: output.attribution.canonicalMechanismProposal,
          problemTags: verified.problemTags,
        })
      : undefined;
  const canonicalMechanism =
    canonical?.decision === "canonical" ? canonical : undefined;
  const tags = [
    ...verified.problemTags,
    ...(canonicalMechanism ? [canonicalMechanism.key] : []),
  ];
  const summary = [
    `What went wrong: ${output.mistakeSummary}`,
    `Coach guidance: ${output.coachGuidance}`,
    `Later result: ${output.repairSummary}`,
  ].join("\n");
  const candidates = canonicalMechanism
    ? [
        {
          factType: "weakness",
          tag: canonicalMechanism.key,
          value: `The learner may need more practice with ${canonicalMechanism.label.en}.`,
          evidenceKind: "reinforce" as const,
          observedBehavior: output.mistakeSummary,
          evidenceTraceIds: [verified.chainEvent.id],
        },
      ]
    : [];

  const persisted = await prisma.$transaction(async (tx) => {
    const episode = await createMemoryEpisode(tx, {
      id: episodeId,
      userId: verified.userId,
      problemId: verified.problemId,
      chatSessionId: verified.chatSessionId,
      kind: "assisted_repair",
      title: `Assisted repair on ${verified.problemTitle}`,
      summary,
      outcome: "resolved",
      tags,
      salience: 0.85,
      sourceTraceIds: verified.sourceTraceIds,
      memoryOrigin: "learner",
      createdAt: verified.chainEvent.occurredAt,
    });
    const arbitration = await arbitrateFactCandidates(tx, {
      userId: verified.userId,
      problemId: verified.problemId,
      reviewAttemptId: verified.reviewAttemptId,
      source: "chat_consolidation",
      candidates,
    });
    return { episode, arbitration };
  });
  const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
    userId: verified.userId,
    episodeIds: [persisted.episode.id],
    factIds: persisted.arbitration.updated.map((fact) => fact.id),
    provider:
      args.retrievalTextProvider ??
      (args.provider?.name.startsWith("mock-")
        ? createDeterministicRetrievalTextRefreshProvider()
        : undefined),
  });
  if (retrievalRefresh.failed.length > 0) {
    throw new Error("retrieval_text_refresh_failed:assisted_repair");
  }
  await reconcileLearnerMemoryRetrievalDocuments(prisma, {
    userId: verified.userId,
    ftsStore: args.ftsStore ?? getDefaultFtsStore(),
  });

  return {
    episodeId: persisted.episode.id,
    repairKey: verified.payload.repairKey,
    idempotentReplay: false,
    attributionStatus: output.attribution.status,
    canonicalMechanism: canonicalMechanism?.key,
    acceptedFactIds: persisted.arbitration.updated.map((fact) => fact.id),
    rejectedFactCount: persisted.arbitration.rejected.length,
  };
}

export function assistedRepairEpisodeId(args: {
  userId: string;
  repairKey: string;
}) {
  return `repair_ep_${createHash("sha256")
    .update(`v1|${args.userId}|${args.repairKey}`)
    .digest("hex")}`;
}

function assertExistingEpisodeMatches(
  episode: {
    userId: string;
    problemId: string | null;
    chatSessionId: string | null;
    kind: string;
    outcome: string;
    sourceTraceIds: string;
    memoryOrigin: string;
  },
  verified: Awaited<ReturnType<typeof verifyAssistedRepairChainClosedEvent>>,
) {
  const traceIds = parseStringArray(episode.sourceTraceIds);
  if (
    episode.userId !== verified.userId ||
    episode.problemId !== verified.problemId ||
    episode.chatSessionId !== verified.chatSessionId ||
    episode.kind !== "assisted_repair" ||
    episode.outcome !== "resolved" ||
    episode.memoryOrigin !== "learner" ||
    !traceIds.includes(verified.chainEvent.id)
  ) {
    throw new Error(
      "Stable assisted repair episode id collided with different evidence.",
    );
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
