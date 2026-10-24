import type { PrismaClient } from "@prisma/client";
import {
  captureNormalizedTraceEvent,
  type CapturedTraceEvent,
  type CaptureTraceEventOptions,
  type PreCaptureTraceEvent,
} from "@/server/observability/runtime-trace-capture";
import {
  finalizeTraceRun,
  flushTraceEvents,
  markTraceRunDegradedBestEffort,
  type TraceFlushResult,
} from "@/server/observability/trace-store";

export type TraceRecorderFinalResult = {
  ok: boolean;
  degraded: boolean;
  traceOverheadMs: number;
  error?: unknown;
};

export class TraceRecorder {
  private readonly buffer: CapturedTraceEvent[] = [];
  private flushChain: Promise<unknown> = Promise.resolve();
  private overheadMs = 0;
  private degraded = false;
  private state: "open" | "finalizing" | "finalized" = "open";

  constructor(
    private readonly args: {
      prisma: PrismaClient;
      traceRunId: string;
      workspaceSessionId?: string;
      capture: CaptureTraceEventOptions;
      now?: () => Date;
      clockMs?: () => number;
      initialOverheadMs?: number;
    },
  ) {
    this.overheadMs = Math.max(0, args.initialOverheadMs ?? 0);
  }

  record(event: PreCaptureTraceEvent) {
    this.assertOpen("record");
    if (event.identity.traceRunId !== this.args.traceRunId) {
      throw new Error(
        `TraceRecorder ${this.args.traceRunId} cannot record event for ${event.identity.traceRunId}.`,
      );
    }
    if (
      event.identity.workspaceSessionId !== this.args.workspaceSessionId
    ) {
      throw new Error(
        `TraceRecorder ${this.args.traceRunId} received a mismatched workspace Session.`,
      );
    }
    const started = this.clockMs();
    this.buffer.push(captureNormalizedTraceEvent(event, this.args.capture));
    this.overheadMs += Math.max(0, this.clockMs() - started);
  }

  get pendingCount() {
    return this.buffer.length;
  }

  get traceOverheadMs() {
    return this.overheadMs;
  }

  /** Records a known telemetry loss without throwing into the product path. */
  markDegraded() {
    this.degraded = true;
  }

  addOverheadMs(durationMs: number) {
    if (Number.isFinite(durationMs) && durationMs > 0) {
      this.overheadMs += durationMs;
    }
  }

  flush(): Promise<TraceFlushResult> {
    this.assertOpen("flush");
    return this.enqueueFlush();
  }

  private enqueueFlush(): Promise<TraceFlushResult> {
    const task = this.flushChain.then(() => this.flushOnce());
    this.flushChain = task.catch(() => undefined);
    return task;
  }

  async flushBestEffort(): Promise<TraceFlushResult | null> {
    try {
      return await this.flush();
    } catch {
      this.degraded = true;
      await markTraceRunDegradedBestEffort(this.args.prisma, this.args.traceRunId);
      return null;
    }
  }

  async finalize(input: {
    status: "succeeded" | "failed" | "degraded";
  }): Promise<TraceRecorderFinalResult> {
    this.assertOpen("finalize");
    this.state = "finalizing";
    try {
      let failure: unknown;
      try {
      // A caller may have already spliced the buffer into an in-flight flush.
      // Finalization must serialize behind that commit before observing an
      // empty buffer or writing finalFlushAt.
        await this.flushChain;
        while (this.buffer.length > 0) {
          const result = await this.enqueueFlush();
          if (result.conflicts.length > 0) this.degraded = true;
        }
      } catch (error) {
        failure = error;
        this.degraded = true;
        await markTraceRunDegradedBestEffort(
          this.args.prisma,
          this.args.traceRunId,
        );
      }

      const finalStarted = this.clockMs();
      try {
        await finalizeTraceRun(this.args.prisma, {
          traceRunId: this.args.traceRunId,
          status: this.degraded ? "degraded" : input.status,
          traceCompleteness: this.degraded ? "degraded" : "complete",
          endedAt: this.now(),
          traceOverheadMs: this.overheadMs,
        });
        this.overheadMs += Math.max(0, this.clockMs() - finalStarted);
        await this.args.prisma.agentTraceRun.update({
          where: { id: this.args.traceRunId },
          data: { traceOverheadMs: Math.max(0, Math.round(this.overheadMs)) },
        });
        return {
          ok: failure === undefined,
          degraded: this.degraded,
          traceOverheadMs: this.overheadMs,
          error: failure,
        };
      } catch (error) {
        this.overheadMs += Math.max(0, this.clockMs() - finalStarted);
        await markTraceRunDegradedBestEffort(
          this.args.prisma,
          this.args.traceRunId,
        );
        return {
          ok: false,
          degraded: true,
          traceOverheadMs: this.overheadMs,
          error: failure ?? error,
        };
      }
    } finally {
      this.state = "finalized";
    }
  }

  private async flushOnce() {
    if (this.buffer.length === 0) {
      return { events: [], insertedCount: 0, duplicateCount: 0, conflicts: [] };
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    const started = this.clockMs();
    try {
      const result = await flushTraceEvents(this.args.prisma, batch);
      if (result.conflicts.length > 0) this.degraded = true;
      return result;
    } catch (error) {
      this.buffer.unshift(...batch);
      throw error;
    } finally {
      this.overheadMs += Math.max(0, this.clockMs() - started);
    }
  }

  private now() {
    return this.args.now?.() ?? new Date();
  }

  private clockMs() {
    return this.args.clockMs?.() ?? performance.now();
  }

  private assertOpen(operation: string) {
    if (this.state !== "open") {
      throw new Error(
        `Cannot ${operation} TraceRecorder ${this.args.traceRunId} while ${this.state}.`,
      );
    }
  }
}
