import { Prisma } from "@prisma/client";
import { parseMemoryOrigin, type MemoryOrigin } from "@/server/memory/memory-origin";
import {
  activityEvidenceRoleSchema,
  type ActivityClusterKind,
  type ActivitySourceRef,
  type SealedActivityClusterInput,
} from "./activity-cluster.types";
import {
  type ActivityClusterDb,
  type ActivityClusterTx,
  resolveActivitySource,
  type ResolvedActivitySource,
} from "./activity-source";
import {
  loadSealedActivityClusterInput,
  loadSealedActivityClusterInputTx,
} from "./load-sealed-activity-cluster";

export type SealActivityClusterArgs = {
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  rootReviewAttemptId: string | null;
  kind: ActivityClusterKind;
  sourceKey: string;
  memoryOrigin: MemoryOrigin;
  sourceItems: ActivitySourceRef[];
  boundaryReason: string;
};

export async function sealActivityCluster(
  prisma: ActivityClusterDb,
  args: SealActivityClusterArgs,
): Promise<SealedActivityClusterInput> {
  try {
    return await prisma.$transaction((tx) => sealActivityClusterTx(tx, args));
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await findExistingCluster(prisma, args);
    if (existing) return loadSealedActivityClusterInput(prisma, existing.id);
    throw new Error("activity_source_already_owned_by_another_cluster", {
      cause: error,
    });
  }
}

export async function sealActivityClusterTx(
  tx: ActivityClusterTx,
  args: SealActivityClusterArgs,
) {
  const existing = await findExistingCluster(tx, args);
  if (existing) return loadSealedActivityClusterInputTx(tx, existing.id);

  const refs = deduplicateRefs(args.sourceItems);
  if (refs.length === 0) throw new Error("activity_cluster_requires_items");
  const resolved = await Promise.all(
    refs.map((ref) => resolveActivitySource(tx, ref)),
  );
  for (const source of resolved) assertSourceScope(source, args);

  const sorted = [...resolved].sort(compareSources);
  const startedAt = sorted[0]!.occurredAt;
  const endedAt = sorted.at(-1)!.occurredAt;
  const cluster = await tx.memoryActivityCluster.create({
    data: {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId,
      rootReviewAttemptId: args.rootReviewAttemptId,
      clusterKind: args.kind,
      status: "sealed",
      sourceKey: args.sourceKey,
      memoryOrigin: args.memoryOrigin,
      startedAt,
      endedAt,
    },
  });
  await tx.memoryActivityItem.createMany({
    data: sorted.map((source, ordinal) => ({
      activityClusterId: cluster.id,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      ordinal,
      role: source.role,
      occurredAt: source.occurredAt,
      messageSequence: source.messageSequence,
      contentHash: source.contentHash,
      metadataJson: JSON.stringify({
        ...source.metadata,
        ...originAttestationMetadata(source),
        evidenceRole: activityEvidenceRoleSchema.parse(source.evidenceRole),
        boundaryReason: args.boundaryReason,
      }),
    })),
  });
  return loadSealedActivityClusterInputTx(tx, cluster.id);
}

async function findExistingCluster(
  db: Pick<ActivityClusterTx, "memoryActivityCluster">,
  args: SealActivityClusterArgs,
) {
  if (args.rootReviewAttemptId) {
    const byRoot = await db.memoryActivityCluster.findUnique({
      where: { rootReviewAttemptId: args.rootReviewAttemptId },
      select: { id: true, userId: true, memoryOrigin: true, sourceKey: true },
    });
    if (byRoot) {
      assertExistingIdentity(byRoot, args);
      return byRoot;
    }
  }
  const bySource = await db.memoryActivityCluster.findUnique({
    where: {
      userId_sourceKey_memoryOrigin: {
        userId: args.userId,
        sourceKey: args.sourceKey,
        memoryOrigin: args.memoryOrigin,
      },
    },
    select: { id: true, userId: true, memoryOrigin: true, sourceKey: true },
  });
  if (bySource) assertExistingIdentity(bySource, args);
  return bySource;
}

function assertExistingIdentity(
  existing: {
    userId: string;
    memoryOrigin: string;
    sourceKey: string;
  },
  args: SealActivityClusterArgs,
) {
  if (
    existing.userId !== args.userId ||
    existing.memoryOrigin !== args.memoryOrigin ||
    existing.sourceKey !== args.sourceKey
  ) {
    throw new Error("activity_cluster_idempotency_identity_mismatch");
  }
}

function assertSourceScope(
  source: ResolvedActivitySource,
  args: SealActivityClusterArgs,
) {
  if (source.userId !== args.userId) {
    throw new Error(`activity_source_user_mismatch:${source.sourceId}`);
  }
  if (
    args.problemId &&
    source.problemId &&
    source.problemId !== args.problemId
  ) {
    throw new Error(`activity_source_problem_mismatch:${source.sourceId}`);
  }
  if (
    args.chatSessionId &&
    source.chatSessionId &&
    source.chatSessionId !== args.chatSessionId
  ) {
    throw new Error(`activity_source_session_mismatch:${source.sourceId}`);
  }
  if (!source.memoryOrigin) return;
  const sourceOrigin = parseMemoryOrigin(source.memoryOrigin);
  if (sourceOrigin === args.memoryOrigin) return;
  if (isHistoricallyAttestedLearnerSource(source, args.memoryOrigin)) return;
  throw new Error(`activity_source_origin_mismatch:${source.sourceId}`);
}

function isHistoricallyAttestedLearnerSource(
  source: ResolvedActivitySource,
  expectedOrigin: MemoryOrigin,
) {
  return (
    source.memoryOrigin === "legacy_unknown" &&
    expectedOrigin === "learner" &&
    source.originAttestation?.memoryOrigin === "learner" &&
    source.originAttestation.reason === "historical_replay_attestation"
  );
}

function originAttestationMetadata(source: ResolvedActivitySource) {
  return source.originAttestation
    ? { originAttestation: source.originAttestation }
    : {};
}

function deduplicateRefs(refs: ActivitySourceRef[]) {
  const unique = new Map<string, ActivitySourceRef>();
  for (const ref of refs) {
    const key = `${ref.sourceType}:${ref.sourceId}`;
    if (!unique.has(key)) unique.set(key, ref);
  }
  return [...unique.values()];
}

function compareSources(left: ResolvedActivitySource, right: ResolvedActivitySource) {
  return (
    left.occurredAt.getTime() - right.occurredAt.getTime() ||
    (left.messageSequence ?? Number.MAX_SAFE_INTEGER) -
      (right.messageSequence ?? Number.MAX_SAFE_INTEGER) ||
    left.sourceType.localeCompare(right.sourceType) ||
    left.sourceId.localeCompare(right.sourceId)
  );
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
