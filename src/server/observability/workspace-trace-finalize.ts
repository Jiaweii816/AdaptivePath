import type { PrismaClient } from "@prisma/client";
import {
  finalizeTraceRun,
  markTraceRunDegradedBestEffort,
} from "@/server/observability/trace-store";
import type { TraceContext } from "@/server/llm/trace-context";
import { recordProcessMemorySample } from "@/server/llm/trace-context";
import type { TraceRecorderFinalResult } from "@/server/observability/trace-recorder";
import type {
  EnsureWorkspaceTraceTurnInput,
  WorkspaceTraceDisabled,
  WorkspaceTraceTurn,
} from "@/server/observability/workspace-session";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import { runTracePayloadRetentionMaintenance } from "@/server/observability/runtime-trace-retention";

export async function ensureWorkspaceTraceTurnBestEffort(
  prisma: PrismaClient,
  input: EnsureWorkspaceTraceTurnInput,
): Promise<
  | (WorkspaceTraceTurn & { initialTraceOverheadMs: number })
  | WorkspaceTraceDisabled
> {
  const startedAt = performance.now();
  try {
    const turn = await ensureWorkspaceTraceTurn(prisma, input);
    if (!turn.enabled) return turn;
    const initialTraceOverheadMs = Math.max(0, performance.now() - startedAt);
    // Retention is deliberately not awaited: it owns a separate bounded
    // transaction and must never extend or fail the foreground action.
    void runTracePayloadRetentionMaintenance(prisma, {
      userId: input.userId,
      env: input.env,
    }).catch((error) => {
      console.warn("Unable to prune retained Runtime Trace payloads.", error);
    });
    return {
      ...turn,
      initialTraceOverheadMs,
    };
  } catch (error) {
    console.warn(
      `Unable to allocate ${input.action} Workspace Trace Turn; continuing without new-store telemetry.`,
      error,
    );
    return { enabled: false };
  }
}

export type ForegroundTraceOutcome = {
  status: "succeeded" | "failed" | "degraded";
};

/**
 * Performs the required final foreground flush without throwing into Review,
 * Chat, or Practice Run. The Run duration remains the action-to-visible-result
 * wall time; recorder overhead is reported separately on the same Run.
 */
export async function finalizeForegroundWorkspaceTrace(
  prisma: PrismaClient,
  turn: WorkspaceTraceTurn | WorkspaceTraceDisabled,
  traceContext: TraceContext | undefined,
  outcome: ForegroundTraceOutcome,
): Promise<TraceRecorderFinalResult | undefined> {
  if (!turn.enabled) return undefined;

  if (
    traceContext?.traceRunId === turn.traceRunId &&
    traceContext.workspaceSessionId === turn.workspaceSessionId &&
    traceContext.recorder
  ) {
    recordProcessMemorySample(traceContext, "end");
    return traceContext.recorder.finalize({ status: outcome.status });
  }

  // An allocated foreground Run without its recorder is observably incomplete.
  // Finalize it as degraded so it does not remain open or masquerade as proof.
  try {
    await finalizeTraceRun(prisma, {
      traceRunId: turn.traceRunId,
      status: "degraded",
      traceCompleteness: "degraded",
      endedAt: new Date(),
      traceOverheadMs: 0,
    });
    return { ok: false, degraded: true, traceOverheadMs: 0 };
  } catch (error) {
    console.warn(
      `Unable to finalize foreground Workspace Trace Run ${turn.traceRunId}.`,
      error,
    );
    await markTraceRunDegradedBestEffort(prisma, turn.traceRunId);
    return { ok: false, degraded: true, traceOverheadMs: 0, error };
  }
}
