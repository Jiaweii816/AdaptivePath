import { parseMemoryOrigin } from "@/server/memory/memory-origin";
import {
  activityClusterKindSchema,
  activityClusterStatusSchema,
  activityEvidenceRoleSchema,
  activitySourceTypeSchema,
  type FrozenActivityItem,
  type SealedActivityClusterInput,
} from "./activity-cluster.types";
import {
  type ActivityClusterDb,
  type ActivityClusterTx,
  resolveActivitySource,
  sha256,
  stableStringify,
} from "./activity-source";

export async function loadSealedActivityClusterInput(
  prisma: ActivityClusterDb,
  clusterId: string,
): Promise<SealedActivityClusterInput> {
  return prisma.$transaction((tx) => loadSealedActivityClusterInputTx(tx, clusterId));
}

export async function loadSealedActivityClusterInputTx(
  tx: ActivityClusterTx,
  clusterId: string,
): Promise<SealedActivityClusterInput> {
  const cluster = await tx.memoryActivityCluster.findUnique({
    where: { id: clusterId },
    include: { items: { orderBy: { ordinal: "asc" } } },
  });
  if (!cluster) throw new Error(`activity_cluster_not_found:${clusterId}`);

  const kind = activityClusterKindSchema.parse(cluster.clusterKind);
  const status = activityClusterStatusSchema.parse(cluster.status);
  const memoryOrigin = parseMemoryOrigin(cluster.memoryOrigin);
  const items: FrozenActivityItem[] = [];

  for (const item of cluster.items) {
    const sourceType = activitySourceTypeSchema.parse(item.sourceType);
    const source = await resolveActivitySource(tx, {
      sourceType,
      sourceId: item.sourceId,
      evidenceRole: activityEvidenceRoleSchema.parse(
        readMetadata(item.metadataJson).evidenceRole,
      ),
    });
    assertFrozenItem(item, source);
    items.push({
      id: item.id,
      sourceType,
      sourceId: item.sourceId,
      evidenceRole: source.evidenceRole,
      ordinal: item.ordinal,
      role: item.role,
      occurredAt: item.occurredAt,
      messageSequence: item.messageSequence,
      contentHash: item.contentHash,
      metadata: readMetadata(item.metadataJson),
      payload: source.payload,
    });
  }

  const sequences = items.flatMap((item) =>
    item.sourceType === "chat_message" && item.messageSequence !== null
      ? [item.messageSequence]
      : [],
  );
  const manifest = {
    version: 1,
    cluster: {
      userId: cluster.userId,
      problemId: cluster.problemId,
      chatSessionId: cluster.chatSessionId,
      rootReviewAttemptId: cluster.rootReviewAttemptId,
      kind,
      status,
      sourceKey: cluster.sourceKey,
      memoryOrigin,
      startedAt: cluster.startedAt.toISOString(),
      endedAt: cluster.endedAt?.toISOString() ?? null,
    },
    items: items.map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      evidenceRole: item.evidenceRole,
      ordinal: item.ordinal,
      role: item.role,
      occurredAt: item.occurredAt.toISOString(),
      messageSequence: item.messageSequence,
      contentHash: item.contentHash,
    })),
  };

  return {
    cluster: {
      id: cluster.id,
      userId: cluster.userId,
      problemId: cluster.problemId,
      chatSessionId: cluster.chatSessionId,
      rootReviewAttemptId: cluster.rootReviewAttemptId,
      kind,
      status,
      sourceKey: cluster.sourceKey,
      memoryOrigin,
      startedAt: cluster.startedAt,
      endedAt: cluster.endedAt,
    },
    messageRange: {
      startSequence: sequences.length > 0 ? Math.min(...sequences) : null,
      endSequence: sequences.length > 0 ? Math.max(...sequences) : null,
    },
    items,
    inputHash: sha256(stableStringify(manifest)),
    independentEvidenceKey: cluster.id,
    independentEvidenceUnitCount: 1,
  };
}

function assertFrozenItem(
  item: {
    sourceType: string;
    sourceId: string;
    occurredAt: Date;
    messageSequence: number | null;
    contentHash: string | null;
  },
  source: Awaited<ReturnType<typeof resolveActivitySource>>,
) {
  if (item.occurredAt.getTime() !== source.occurredAt.getTime()) {
    throw new Error(
      `activity_item_source_time_changed:${item.sourceType}:${item.sourceId}`,
    );
  }
  if (item.messageSequence !== source.messageSequence) {
    throw new Error(
      `activity_item_message_sequence_changed:${item.sourceType}:${item.sourceId}`,
    );
  }
  if (!item.contentHash || item.contentHash !== source.contentHash) {
    throw new Error(
      `activity_item_content_changed:${item.sourceType}:${item.sourceId}`,
    );
  }
}

function readMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("activity_item_metadata_invalid_json");
  }
}
