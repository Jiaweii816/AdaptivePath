import type { Prisma, PrismaClient } from "@prisma/client";

const DEFAULT_RETAIN_FULL_SESSIONS = 20;
const DEFAULT_RETAIN_UNSCOPED_DAYS = 30;
const DEFAULT_PRUNE_BATCH_SIZE = 500;

export type TracePayloadRetentionMode =
  | "enabled"
  | "disabled_until_export";

export type TracePayloadRetentionEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type TracePayloadRetentionOptions = {
  /** Limits scoped maintenance to one learner while preserving per-user ranking. */
  userId?: string;
  mode?: TracePayloadRetentionMode;
  retainFullSessions?: number;
  retainUnscopedDays?: number;
  batchSize?: number;
  now?: Date;
  env?: TracePayloadRetentionEnvironment;
};

export type TracePayloadRetentionResult = {
  mode: TracePayloadRetentionMode;
  skipped: boolean;
  skipReason?: "eval_artifacts_pending_export";
  selectedCount: number;
  prunedCount: number;
  scopedPrunedCount: number;
  unscopedPrunedCount: number;
  batchSize: number;
  hasMoreCandidates: boolean;
};

/**
 * Deletes only disposable trace payloads. Candidate selection, the Event
 * payload-state transition, and Payload deletion share one bounded
 * transaction. Callers must invoke this outside the Workspace Session
 * allocator transaction.
 *
 * Eval callers that have not exported their artifacts yet must explicitly use
 * `disabled_until_export`; production defaults to enabled retention.
 */
export async function runTracePayloadRetentionMaintenance(
  prisma: PrismaClient,
  options: TracePayloadRetentionOptions = {},
): Promise<TracePayloadRetentionResult> {
  const policy = resolveTracePayloadRetentionPolicy(options);
  if (policy.mode === "disabled_until_export") {
    return {
      mode: policy.mode,
      skipped: true,
      skipReason: "eval_artifacts_pending_export",
      selectedCount: 0,
      prunedCount: 0,
      scopedPrunedCount: 0,
      unscopedPrunedCount: 0,
      batchSize: policy.batchSize,
      hasMoreCandidates: false,
    };
  }

  return prisma.$transaction(async (tx) => {
    const protectedRecentSessionIds = await loadRecentTerminalSessionIds(
      tx,
      options.userId,
      policy.retainFullSessions,
    );
    const unscopedCutoff = new Date(
      policy.now.getTime() - policy.retainUnscopedDays * 24 * 60 * 60 * 1000,
    );

    const candidateWindow = await tx.agentTracePayload.findMany({
      where: {
        OR: [
          {
            workspaceSessionId: {
              not: null,
              ...(protectedRecentSessionIds.length > 0
                ? { notIn: protectedRecentSessionIds }
                : {}),
            },
            traceEvent: {
              workspaceSession: {
                is: {
                  ...(options.userId ? { userId: options.userId } : {}),
                  foregroundStatus: { in: ["closed", "abandoned"] },
                  backgroundStatus: { not: "pending" },
                  backgroundJobs: {
                    none: { status: { in: ["pending", "running"] } },
                  },
                  traceRuns: {
                    none: {
                      OR: [
                        { traceCompleteness: "open" },
                        { finalFlushAt: null },
                      ],
                    },
                  },
                },
              },
            },
          },
          {
            workspaceSessionId: null,
            traceEvent: {
              occurredAt: { lt: unscopedCutoff },
              ...(options.userId
                ? { traceRun: { is: { userId: options.userId } } }
                : {}),
            },
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: policy.batchSize + 1,
      select: {
        id: true,
        traceEventId: true,
        workspaceSessionId: true,
      },
    });
    const candidates = candidateWindow.slice(0, policy.batchSize);

    if (candidates.length === 0) {
      return {
        mode: policy.mode,
        skipped: false,
        selectedCount: 0,
        prunedCount: 0,
        scopedPrunedCount: 0,
        unscopedPrunedCount: 0,
        batchSize: policy.batchSize,
        hasMoreCandidates: false,
      };
    }

    const payloadIds = candidates.map((candidate) => candidate.id);
    const traceEventIds = candidates.map((candidate) => candidate.traceEventId);
    await tx.agentTraceEvent.updateMany({
      where: { id: { in: traceEventIds } },
      data: { payloadState: "pruned" },
    });
    const deleted = await tx.agentTracePayload.deleteMany({
      where: { id: { in: payloadIds } },
    });
    if (deleted.count !== candidates.length) {
      throw new Error(
        `Trace payload retention selected ${candidates.length} rows but deleted ${deleted.count}.`,
      );
    }

    const scopedPrunedCount = candidates.filter(
      (candidate) => candidate.workspaceSessionId !== null,
    ).length;
    return {
      mode: policy.mode,
      skipped: false,
      selectedCount: candidates.length,
      prunedCount: deleted.count,
      scopedPrunedCount,
      unscopedPrunedCount: candidates.length - scopedPrunedCount,
      batchSize: policy.batchSize,
      hasMoreCandidates: candidateWindow.length > policy.batchSize,
    };
  });
}

type RetentionTransaction = Prisma.TransactionClient;

async function loadRecentTerminalSessionIds(
  tx: RetentionTransaction,
  userId: string | undefined,
  retainFullSessions: number,
) {
  if (retainFullSessions === 0) return [];

  const users = userId
    ? [{ userId }]
    : await tx.problemWorkspaceSession.findMany({
        where: { foregroundStatus: { in: ["closed", "abandoned"] } },
        distinct: ["userId"],
        select: { userId: true },
      });
  const protectedIds: string[] = [];
  for (const user of users) {
    const sessions = await tx.problemWorkspaceSession.findMany({
      where: {
        userId: user.userId,
        foregroundStatus: { in: ["closed", "abandoned"] },
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: retainFullSessions,
      select: { id: true },
    });
    protectedIds.push(...sessions.map((session) => session.id));
  }
  return protectedIds;
}

function resolveTracePayloadRetentionPolicy(
  options: TracePayloadRetentionOptions,
) {
  const env = options.env ?? process.env;
  return {
    mode: options.mode ?? "enabled",
    retainFullSessions: resolveNonNegativeInteger(
      options.retainFullSessions,
      env.TRACE_RETAIN_FULL_SESSIONS,
      DEFAULT_RETAIN_FULL_SESSIONS,
      "TRACE_RETAIN_FULL_SESSIONS",
    ),
    retainUnscopedDays: resolveNonNegativeNumber(
      options.retainUnscopedDays,
      env.TRACE_RETAIN_UNSCOPED_DAYS,
      DEFAULT_RETAIN_UNSCOPED_DAYS,
      "TRACE_RETAIN_UNSCOPED_DAYS",
    ),
    batchSize: resolvePositiveInteger(
      options.batchSize,
      env.TRACE_PRUNE_BATCH_SIZE,
      DEFAULT_PRUNE_BATCH_SIZE,
      "TRACE_PRUNE_BATCH_SIZE",
    ),
    now: options.now ?? new Date(),
  };
}

function resolveNonNegativeInteger(
  explicit: number | undefined,
  configured: string | undefined,
  fallback: number,
  name: string,
) {
  const value = explicit ?? (configured === undefined ? fallback : Number(configured));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function resolvePositiveInteger(
  explicit: number | undefined,
  configured: string | undefined,
  fallback: number,
  name: string,
) {
  const value = explicit ?? (configured === undefined ? fallback : Number(configured));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function resolveNonNegativeNumber(
  explicit: number | undefined,
  configured: string | undefined,
  fallback: number,
  name: string,
) {
  const value = explicit ?? (configured === undefined ? fallback : Number(configured));
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}
