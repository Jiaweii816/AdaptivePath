import type { PrismaClient } from "@prisma/client";
import { recomputeOperationalNotes, OPERATIONAL_CONTRACT_VERSION } from "@/server/memory/operational-memory";
import { dispatchRecordedBackgroundJob } from "./background-job-dispatch";

/** One logical rebuild per origin/day/version; recorded before in-process dispatch. */
export async function enqueueOperationalAggregation(args: {
  prisma: PrismaClient;
  originatingTraceRunId: string;
  memoryOrigin: string;
}) {
  const day = new Date().toISOString().slice(0, 10);
  return dispatchRecordedBackgroundJob({
    prisma: args.prisma,
    kind: "operational_aggregation",
    task: "memory.recompute_operational_notes",
    origin: { originatingTraceRunId: args.originatingTraceRunId },
    metadata: { contractVersion: OPERATIONAL_CONTRACT_VERSION },
    options: { dedupeKey: `operational_aggregation:${args.memoryOrigin}:${day}:${OPERATIONAL_CONTRACT_VERSION}` },
    run: () => recomputeOperationalNotes(args.prisma),
  });
}
