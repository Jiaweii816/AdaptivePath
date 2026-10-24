import type { PrismaClient } from "@prisma/client";
import {
  LEGACY_TELEMETRY_EVENT_TYPES,
  mapLegacyL1TelemetryEvent,
  type LegacyTelemetryEventType,
} from "@/server/observability/runtime-trace-legacy-mapping";
import type { CapturedTraceEvent } from "@/server/observability/runtime-trace-capture";
import { flushTraceEvents } from "@/server/observability/trace-store";

export const LEGACY_MIGRATION_PROCESS_INSTANCE_ID =
  "legacy:l1-telemetry-migration:v1";

type MigrationMode = "dry-run" | "apply";

export type L1TelemetryMigrationOptions = {
  mode: MigrationMode;
  deleteSource?: boolean;
};

export type L1TelemetryMigrationConflict = {
  kind: "source_run_scope" | "existing_run" | "existing_event" | "flush";
  id: string;
  message: string;
};

export type L1TelemetryMigrationSummary = {
  ok: boolean;
  mode: MigrationMode;
  deleteSourceRequested: boolean;
  sourceTotal: number;
  sourceMalformedEventJsonCount: number;
  sourceCounts: Record<LegacyTelemetryEventType, number>;
  requiredRunCount: number;
  syntheticRunCount: number;
  existingRunCount: number;
  existingMatchingEventCount: number;
  pendingRunCount: number;
  pendingEventCount: number;
  insertedRunCount: number;
  insertedEventCount: number;
  replayedEventCount: number;
  deletedSourceCount: number;
  remainingSourceTelemetryCount: number;
  targetCounts: Record<LegacyTelemetryEventType, number>;
  integrity: {
    expectedEventCount: number;
    matchingEventCount: number;
    digestMismatchCount: number;
    missingRunCount: number;
    eventWithoutRunCount: number;
    payloadWithoutEventCount: number;
  };
  conflicts: L1TelemetryMigrationConflict[];
};

type LegacySourceRow = {
  id: string;
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  reviewAttemptId: string | null;
  eventType: string;
  eventJson: string;
  source: string | null;
  occurredAt: Date;
};

type MappedLegacyRow = {
  source: LegacySourceRow;
  eventType: LegacyTelemetryEventType;
  event: CapturedTraceEvent;
};

type LegacyRunPlan = {
  id: string;
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  reviewAttemptId: string | null;
  path: CapturedTraceEvent["scope"]["path"];
  startedAt: Date;
  endedAt: Date;
};

export async function migrateL1Telemetry(
  prisma: PrismaClient,
  options: L1TelemetryMigrationOptions,
): Promise<L1TelemetryMigrationSummary> {
  if (options.deleteSource && options.mode !== "apply") {
    throw new Error("--delete-source requires --apply.");
  }

  const sourceRows = await loadLegacySourceRows(prisma);
  const mappedRows = sourceRows.map(mapSourceRow);
  const conflicts: L1TelemetryMigrationConflict[] = [];
  const runPlans = buildRunPlans(mappedRows, conflicts);
  const existingRuns = await prisma.agentTraceRun.findMany({
    where: { id: { in: [...runPlans.keys()] } },
  });
  const existingRunById = new Map(existingRuns.map((run) => [run.id, run]));
  for (const plan of runPlans.values()) {
    const existing = existingRunById.get(plan.id);
    if (!existing) continue;
    if (
      existing.processInstanceId !== LEGACY_MIGRATION_PROCESS_INSTANCE_ID ||
      existing.userId !== plan.userId ||
      existing.problemId !== plan.problemId ||
      existing.workspaceSessionId !== null ||
      existing.path !== plan.path ||
      existing.chatSessionId !== plan.chatSessionId ||
      existing.reviewAttemptId !== plan.reviewAttemptId
    ) {
      conflicts.push({
        kind: "existing_run",
        id: plan.id,
        message: "Existing Trace Run does not match the deterministic legacy plan.",
      });
    }
  }

  const existingEvents = await prisma.agentTraceEvent.findMany({
    where: {
      eventId: { in: mappedRows.map((row) => row.event.identity.eventId) },
    },
    select: {
      eventId: true,
      eventDigest: true,
      traceRunId: true,
      kind: true,
    },
  });
  const expectedEventById = new Map(
    mappedRows.map((row) => [row.event.identity.eventId, row.event]),
  );
  let existingMatchingEventCount = 0;
  for (const existing of existingEvents) {
    const expected = expectedEventById.get(existing.eventId);
    if (
      expected &&
      existing.eventDigest === expected.identity.eventDigest &&
      existing.traceRunId === expected.identity.traceRunId &&
      existing.kind === expected.scope.kind
    ) {
      existingMatchingEventCount += 1;
    } else {
      conflicts.push({
        kind: "existing_event",
        id: existing.eventId,
        message: "Existing Event conflicts with the deterministic legacy digest or scope.",
      });
    }
  }

  const summary = emptySummary({
    mode: options.mode,
    deleteSource: options.deleteSource === true,
    sourceRows,
    mappedRows,
    runPlans,
    existingRunCount: existingRuns.length,
    existingMatchingEventCount,
    conflicts,
  });

  if (conflicts.length > 0 || options.mode === "dry-run") {
    return finalizeSummary(prisma, summary, mappedRows, runPlans);
  }

  for (const plan of runPlans.values()) {
    if (existingRunById.has(plan.id)) continue;
    await prisma.agentTraceRun.create({
      data: {
        id: plan.id,
        userId: plan.userId,
        problemId: plan.problemId,
        chatSessionId: plan.chatSessionId,
        reviewAttemptId: plan.reviewAttemptId,
        path: plan.path,
        status: "degraded",
        processInstanceId: LEGACY_MIGRATION_PROCESS_INSTANCE_ID,
        startedAt: plan.startedAt,
        endedAt: plan.endedAt,
        durationMs: Math.max(
          0,
          plan.endedAt.getTime() - plan.startedAt.getTime(),
        ),
        traceCompleteness: "degraded",
        finalFlushAt: plan.endedAt,
      },
    });
    summary.insertedRunCount += 1;
  }

  for (const batch of chunk(
    mappedRows.map((row) => row.event),
    200,
  )) {
    const result = await flushTraceEvents(prisma, batch);
    summary.insertedEventCount += result.insertedCount;
    summary.replayedEventCount += result.duplicateCount;
    for (const conflict of result.conflicts) {
      summary.conflicts.push({
        kind: "flush",
        id: conflict.eventId,
        message: "Trace repository rejected a conflicting event replay.",
      });
    }
  }

  if (summary.conflicts.length === 0 && options.deleteSource) {
    summary.deletedSourceCount = await deleteVerifiedLegacySources(
      prisma,
      mappedRows,
    );
  }

  return finalizeSummary(prisma, summary, mappedRows, runPlans);
}

async function loadLegacySourceRows(prisma: PrismaClient) {
  return prisma.l1MemoryEvent.findMany({
    where: { eventType: { in: [...LEGACY_TELEMETRY_EVENT_TYPES] } },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      problemId: true,
      chatSessionId: true,
      reviewAttemptId: true,
      eventType: true,
      eventJson: true,
      source: true,
      occurredAt: true,
    },
  });
}

function mapSourceRow(source: LegacySourceRow): MappedLegacyRow {
  const eventType = source.eventType as LegacyTelemetryEventType;
  return {
    source,
    eventType,
    event: mapLegacyL1TelemetryEvent(source),
  };
}

function buildRunPlans(
  rows: MappedLegacyRow[],
  conflicts: L1TelemetryMigrationConflict[],
) {
  const plans = new Map<string, LegacyRunPlan>();
  for (const row of rows) {
    const id = row.event.identity.traceRunId;
    const existing = plans.get(id);
    if (!existing) {
      plans.set(id, {
        id,
        userId: row.source.userId,
        problemId: row.source.problemId,
        chatSessionId: row.source.chatSessionId,
        reviewAttemptId: row.source.reviewAttemptId,
        path: row.event.scope.path,
        startedAt: row.source.occurredAt,
        endedAt: row.source.occurredAt,
      });
      continue;
    }

    const problemConflict =
      existing.problemId !== null &&
      row.source.problemId !== null &&
      existing.problemId !== row.source.problemId;
    const chatConflict =
      existing.chatSessionId !== null &&
      row.source.chatSessionId !== null &&
      existing.chatSessionId !== row.source.chatSessionId;
    const reviewConflict =
      existing.reviewAttemptId !== null &&
      row.source.reviewAttemptId !== null &&
      existing.reviewAttemptId !== row.source.reviewAttemptId;
    if (
      existing.userId !== row.source.userId ||
      existing.path !== row.event.scope.path ||
      problemConflict ||
      chatConflict ||
      reviewConflict
    ) {
      conflicts.push({
        kind: "source_run_scope",
        id,
        message: "Legacy rows sharing traceRunId disagree on user/path/product scope.",
      });
      continue;
    }
    existing.problemId ??= row.source.problemId;
    existing.chatSessionId ??= row.source.chatSessionId;
    existing.reviewAttemptId ??= row.source.reviewAttemptId;
    if (row.source.occurredAt < existing.startedAt) {
      existing.startedAt = row.source.occurredAt;
    }
    if (row.source.occurredAt > existing.endedAt) {
      existing.endedAt = row.source.occurredAt;
    }
  }
  return plans;
}

function emptySummary(args: {
  mode: MigrationMode;
  deleteSource: boolean;
  sourceRows: LegacySourceRow[];
  mappedRows: MappedLegacyRow[];
  runPlans: Map<string, LegacyRunPlan>;
  existingRunCount: number;
  existingMatchingEventCount: number;
  conflicts: L1TelemetryMigrationConflict[];
}): L1TelemetryMigrationSummary {
  return {
    ok: args.conflicts.length === 0,
    mode: args.mode,
    deleteSourceRequested: args.deleteSource,
    sourceTotal: args.sourceRows.length,
    sourceMalformedEventJsonCount: args.sourceRows.filter((row) =>
      isMalformedEventJson(row.eventJson),
    ).length,
    sourceCounts: countSourceFamilies(args.sourceRows),
    requiredRunCount: args.runPlans.size,
    syntheticRunCount: new Set(
      args.mappedRows
        .map((row) => row.event.identity.traceRunId)
        .filter((traceRunId) => traceRunId.startsWith("legacy:run:")),
    ).size,
    existingRunCount: args.existingRunCount,
    existingMatchingEventCount: args.existingMatchingEventCount,
    pendingRunCount: args.runPlans.size - args.existingRunCount,
    pendingEventCount:
      args.mappedRows.length - args.existingMatchingEventCount,
    insertedRunCount: 0,
    insertedEventCount: 0,
    replayedEventCount: 0,
    deletedSourceCount: 0,
    remainingSourceTelemetryCount: args.sourceRows.length,
    targetCounts: emptyFamilyCounts(),
    integrity: {
      expectedEventCount: args.mappedRows.length,
      matchingEventCount: args.existingMatchingEventCount,
      digestMismatchCount: 0,
      missingRunCount: args.runPlans.size - args.existingRunCount,
      eventWithoutRunCount: 0,
      payloadWithoutEventCount: 0,
    },
    conflicts: args.conflicts,
  };
}

async function finalizeSummary(
  prisma: PrismaClient,
  summary: L1TelemetryMigrationSummary,
  mappedRows: MappedLegacyRow[],
  runPlans: Map<string, LegacyRunPlan>,
) {
  const targetEvents = await prisma.agentTraceEvent.findMany({
    where: {
      eventId: { in: mappedRows.map((row) => row.event.identity.eventId) },
    },
    select: { eventId: true, eventDigest: true },
  });
  const targetById = new Map(
    targetEvents.map((event) => [event.eventId, event.eventDigest]),
  );
  summary.targetCounts = emptyFamilyCounts();
  summary.integrity.matchingEventCount = 0;
  summary.integrity.digestMismatchCount = 0;
  for (const row of mappedRows) {
    const digest = targetById.get(row.event.identity.eventId);
    if (digest === row.event.identity.eventDigest) {
      summary.integrity.matchingEventCount += 1;
      summary.targetCounts[row.eventType] += 1;
    } else if (digest !== undefined) {
      summary.integrity.digestMismatchCount += 1;
    }
  }
  const existingRunCount = await prisma.agentTraceRun.count({
    where: { id: { in: [...runPlans.keys()] } },
  });
  summary.integrity.missingRunCount = runPlans.size - existingRunCount;
  summary.integrity.eventWithoutRunCount = await countRaw(
    prisma,
    `SELECT COUNT(*) AS count
       FROM AgentTraceEvent event
       LEFT JOIN AgentTraceRun run ON run.id = event.traceRunId
      WHERE run.id IS NULL`,
  );
  summary.integrity.payloadWithoutEventCount = await countRaw(
    prisma,
    `SELECT COUNT(*) AS count
       FROM AgentTracePayload payload
       LEFT JOIN AgentTraceEvent event ON event.id = payload.traceEventId
      WHERE event.id IS NULL`,
  );
  summary.remainingSourceTelemetryCount = await prisma.l1MemoryEvent.count({
    where: { eventType: { in: [...LEGACY_TELEMETRY_EVENT_TYPES] } },
  });
  summary.ok =
    summary.conflicts.length === 0 &&
    (summary.mode === "dry-run" ||
      (summary.integrity.matchingEventCount === mappedRows.length &&
        summary.integrity.digestMismatchCount === 0 &&
        summary.integrity.missingRunCount === 0 &&
        summary.integrity.eventWithoutRunCount === 0 &&
        summary.integrity.payloadWithoutEventCount === 0));
  return summary;
}

async function deleteVerifiedLegacySources(
  prisma: PrismaClient,
  mappedRows: MappedLegacyRow[],
) {
  return prisma.$transaction(async (tx) => {
    const currentSources = await tx.l1MemoryEvent.findMany({
      where: {
        id: { in: mappedRows.map((row) => row.source.id) },
        eventType: { in: [...LEGACY_TELEMETRY_EVENT_TYPES] },
      },
      select: {
        id: true,
        userId: true,
        problemId: true,
        chatSessionId: true,
        reviewAttemptId: true,
        eventType: true,
        eventJson: true,
        source: true,
        occurredAt: true,
      },
    });
    if (currentSources.length !== mappedRows.length) {
      throw new Error(
        "Source telemetry changed after validation; refusing deletion.",
      );
    }
    const currentMapped = currentSources.map(mapSourceRow);
    const targets = await tx.agentTraceEvent.findMany({
      where: {
        eventId: {
          in: currentMapped.map((row) => row.event.identity.eventId),
        },
      },
      select: { eventId: true, eventDigest: true },
    });
    const targetDigestById = new Map(
      targets.map((event) => [event.eventId, event.eventDigest]),
    );
    for (const row of currentMapped) {
      if (
        targetDigestById.get(row.event.identity.eventId) !==
        row.event.identity.eventDigest
      ) {
        throw new Error(
          `Target ${row.event.identity.eventId} was not verified; refusing source deletion.`,
        );
      }
    }
    const deleted = await tx.l1MemoryEvent.deleteMany({
      where: {
        id: { in: currentMapped.map((row) => row.source.id) },
        eventType: { in: [...LEGACY_TELEMETRY_EVENT_TYPES] },
      },
    });
    return deleted.count;
  });
}

function countSourceFamilies(rows: LegacySourceRow[]) {
  const counts = emptyFamilyCounts();
  for (const row of rows) {
    counts[row.eventType as LegacyTelemetryEventType] += 1;
  }
  return counts;
}

function emptyFamilyCounts(): Record<LegacyTelemetryEventType, number> {
  return Object.fromEntries(
    LEGACY_TELEMETRY_EVENT_TYPES.map((eventType) => [eventType, 0]),
  ) as Record<LegacyTelemetryEventType, number>;
}

function isMalformedEventJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return !parsed || typeof parsed !== "object" || Array.isArray(parsed);
  } catch {
    return true;
  }
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function countRaw(prisma: PrismaClient, sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    sql,
  );
  return Number(rows[0]?.count ?? 0);
}
