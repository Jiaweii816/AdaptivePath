import { z } from "zod";

export const runtimeTraceActionRequestFields = {
  browserInstanceId: z.string().trim().min(8).max(200).optional(),
  clientOccurredAt: z.string().datetime({ offset: true }).optional(),
} satisfies z.ZodRawShape;

export type RuntimeTraceActionRequest = {
  browserInstanceId?: string;
  clientOccurredAt?: string;
};

export type WorkspaceTraceTurnInfo = {
  workspaceSessionId: string;
  traceRunId: string;
  turnOrdinal: number;
};

export function isTraceStoreCutoverEnabled(
  _env: Readonly<Record<string, string | undefined>> = process.env,
) {
  // Phase 3 completed the atomic writer cutover. This remains as a temporary
  // compatibility export for callers/tests; runtime env can no longer disable
  // the new trace store.
  void _env;
  return true;
}

export function requireRuntimeTraceActionContext(
  value: RuntimeTraceActionRequest,
  context: z.RefinementCtx,
) {
  if (!value.browserInstanceId) {
    context.addIssue({
      code: "custom",
      path: ["browserInstanceId"],
      message: "browserInstanceId is required while trace-store cutover is enabled.",
    });
  }
  if (!value.clientOccurredAt) {
    context.addIssue({
      code: "custom",
      path: ["clientOccurredAt"],
      message: "clientOccurredAt is required while trace-store cutover is enabled.",
    });
  }
}
