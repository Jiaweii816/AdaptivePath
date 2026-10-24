import { CHAT_MAX_TOOL_ITERATIONS } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { RuntimeTraceExport } from "@/server/observability/runtime-trace-export";

export const TRACE_ARCHITECTURE_INVARIANTS = [
  "review_exactly_one_llm",
  "review_runner_present",
  "chat_tool_loop_bounded",
  "l2_write_preceded_by_arbitration",
] as const;

export type TraceArchitectureInvariantName =
  (typeof TRACE_ARCHITECTURE_INVARIANTS)[number];
export type TraceInvariantVerdict = "pass" | "fail" | "inconclusive";

export type TraceArchitectureInvariantResult = {
  rootTraceRunId: string;
  path: "review" | "chat";
  invariant: TraceArchitectureInvariantName;
  verdict: TraceInvariantVerdict;
  reason: string;
  relevantTraceRunIds: string[];
  observed?: Record<string, unknown>;
};

export type TraceArchitectureInvariantReport = {
  evaluatedRootCount: number;
  passCount: number;
  failCount: number;
  inconclusiveCount: number;
  passed: boolean;
  results: TraceArchitectureInvariantResult[];
};

type ExportRun = RuntimeTraceExport["runs"][number];
type ExportEvent = RuntimeTraceExport["events"][number];
type InvariantRootRun = ExportRun & { path: "review" | "chat" };

/**
 * Evaluates the frozen architecture against a normalized v3 trace export.
 * Event array order is the export's durable seq order; stepIndex is used only
 * as the fallback for artifacts assembled outside the Session export.
 */
export function evaluateTraceArchitectureInvariants(
  artifact: Pick<RuntimeTraceExport, "runs" | "events">,
  options: {
    rootTraceRunIds?: readonly string[];
    chatMaxToolIterations?: number;
    incompleteVerdict?: Exclude<TraceInvariantVerdict, "pass">;
  } = {},
): TraceArchitectureInvariantReport {
  const rootFilter = options.rootTraceRunIds
    ? new Set(options.rootTraceRunIds)
    : undefined;
  const roots = artifact.runs.filter(
    (run): run is InvariantRootRun =>
      run.workspaceSessionId !== null &&
      run.turnOrdinal !== null &&
      run.parentTraceRunId === null &&
      run.originatingTraceRunId === null &&
      (run.path === "review" || run.path === "chat") &&
      (!rootFilter || rootFilter.has(run.id)),
  );
  const chatMaxToolIterations = normalizeBound(
    options.chatMaxToolIterations ?? CHAT_MAX_TOOL_ITERATIONS,
  );
  const incompleteVerdict = options.incompleteVerdict ?? "fail";
  const eventOrder = new Map(
    artifact.events.map((event, index) => [event.identity.eventId, index]),
  );
  const results: TraceArchitectureInvariantResult[] = [];

  for (const root of roots) {
    const relevantRuns = collectRelevantRuns(artifact.runs, root.id);
    const relevantRunIds = new Set(relevantRuns.map((run) => run.id));
    const relevantEvents = artifact.events.filter((event) =>
      relevantRunIds.has(event.identity.traceRunId),
    );
    const rootEvents = relevantEvents.filter(
      (event) => event.identity.traceRunId === root.id,
    );
    const completenessFailures = collectCompletenessFailures(
      relevantRuns,
      relevantEvents,
    );
    const applicable = applicableInvariants(root, rootEvents);

    if (completenessFailures.length > 0) {
      for (const invariant of applicable) {
        results.push({
          rootTraceRunId: root.id,
          path: root.path,
          invariant,
          verdict: incompleteVerdict,
          reason: `trace_not_complete:${completenessFailures.join(";")}`,
          relevantTraceRunIds: [...relevantRunIds],
        });
      }
      continue;
    }

    if (root.path === "review") {
      const expectsLlm = rootEvents.some(
        (event) =>
          event.scope.kind === "runner" &&
          (event.lifecycle.status === "succeeded" ||
            event.lifecycle.status === "degraded"),
      );
      const llmCount = rootEvents.filter((event) => event.scope.kind === "llm")
        .length;
      if (expectsLlm) {
        results.push({
          rootTraceRunId: root.id,
          path: "review",
          invariant: "review_exactly_one_llm",
          verdict: llmCount === 1 ? "pass" : "fail",
          reason:
            llmCount === 1
              ? "Review with completed executor evidence contains exactly one LLM event"
              : `Review with completed executor evidence contains ${llmCount} LLM events`,
          relevantTraceRunIds: [...relevantRunIds],
          observed: { llmCount, expectsLlm },
        });
      }

      const runnerCount = rootEvents.filter(
        (event) => event.scope.kind === "runner",
      ).length;
      results.push({
        rootTraceRunId: root.id,
        path: "review",
        invariant: "review_runner_present",
        verdict: runnerCount >= 1 ? "pass" : "fail",
        reason:
          runnerCount >= 1
            ? "successful Review contains runner evidence"
            : "successful Review contains no runner event",
        relevantTraceRunIds: [...relevantRunIds],
        observed: { runnerCount },
      });
    }

    if (root.path === "chat") {
      const rootEvents = relevantEvents.filter(
        (event) => event.identity.traceRunId === root.id,
      );
      const llmCount = rootEvents.filter((event) => event.scope.kind === "llm")
        .length;
      const toolEvents = rootEvents.filter(isToolCallEvent);
      const missingIterations = toolEvents
        .filter((event) => event.identity.agentIteration === undefined)
        .map((event) => event.identity.eventId);
      const maxToolIteration = toolEvents.reduce(
        (max, event) =>
          Math.max(max, event.identity.agentIteration ?? Number.POSITIVE_INFINITY),
        -1,
      );
      const bounded =
        llmCount <= chatMaxToolIterations + 1 &&
        missingIterations.length === 0 &&
        maxToolIteration <= chatMaxToolIterations;
      results.push({
        rootTraceRunId: root.id,
        path: "chat",
        invariant: "chat_tool_loop_bounded",
        verdict: bounded ? "pass" : "fail",
        reason: bounded
          ? "Chat LLM/tool iterations stay within the configured bound"
          : `Chat bound exceeded or iteration metadata missing (llm=${llmCount}, maxToolIteration=${formatIteration(maxToolIteration)}, missing=${missingIterations.length})`,
        relevantTraceRunIds: [...relevantRunIds],
        observed: {
          llmCount,
          maximumLlmCalls: chatMaxToolIterations + 1,
          toolCallCount: toolEvents.length,
          maxToolIteration:
            Number.isFinite(maxToolIteration) && maxToolIteration >= 0
              ? maxToolIteration
              : null,
          missingAgentIterationEventIds: missingIterations,
        },
      });
    }

    const arbitrationFailures = findArbitrationFailures(
      relevantEvents,
      eventOrder,
    );
    results.push({
      rootTraceRunId: root.id,
      path: root.path,
      invariant: "l2_write_preceded_by_arbitration",
      verdict: arbitrationFailures.length === 0 ? "pass" : "fail",
      reason:
        arbitrationFailures.length === 0
          ? "every traced durable L2 write is preceded by arbitration in the same Run"
          : `durable L2 writes missing prior arbitration: ${arbitrationFailures.join(",")}`,
      relevantTraceRunIds: [...relevantRunIds],
      observed: { missingArbitrationEventIds: arbitrationFailures },
    });
  }

  return {
    evaluatedRootCount: roots.length,
    passCount: results.filter((result) => result.verdict === "pass").length,
    failCount: results.filter((result) => result.verdict === "fail").length,
    inconclusiveCount: results.filter(
      (result) => result.verdict === "inconclusive",
    ).length,
    passed:
      results.length > 0 &&
      results.every((result) => result.verdict === "pass"),
    results,
  };
}

function applicableInvariants(
  root: InvariantRootRun,
  rootEvents: readonly ExportEvent[],
): TraceArchitectureInvariantName[] {
  if (root.path === "review") {
    const completedRunner = rootEvents.some(
      (event) =>
        event.scope.kind === "runner" &&
        (event.lifecycle.status === "succeeded" ||
          event.lifecycle.status === "degraded"),
    );
    return [
      ...(completedRunner ? (["review_exactly_one_llm"] as const) : []),
      "review_runner_present",
      "l2_write_preceded_by_arbitration",
    ];
  }
  return ["chat_tool_loop_bounded", "l2_write_preceded_by_arbitration"];
}

function collectRelevantRuns(runs: readonly ExportRun[], rootTraceRunId: string) {
  const selected = new Set([rootTraceRunId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of runs) {
      if (selected.has(run.id)) continue;
      if (
        (run.parentTraceRunId && selected.has(run.parentTraceRunId)) ||
        (run.originatingTraceRunId && selected.has(run.originatingTraceRunId))
      ) {
        selected.add(run.id);
        changed = true;
      }
    }
  }
  return runs.filter((run) => selected.has(run.id));
}

function collectCompletenessFailures(
  runs: readonly ExportRun[],
  events: readonly ExportEvent[],
) {
  const failures: string[] = [];
  for (const run of runs) {
    if (run.traceCompleteness !== "complete") {
      failures.push(`${run.id}:${run.traceCompleteness}`);
    }
    if (run.finalFlushAt === null) failures.push(`${run.id}:missing_final_flush`);
    const runEvents = events.filter(
      (event) => event.identity.traceRunId === run.id,
    );
    const llmCount = runEvents.filter((event) => event.scope.kind === "llm")
      .length;
    if (llmCount !== run.llmCallCount) {
      failures.push(
        `${run.id}:llm_rollup_mismatch(${run.llmCallCount}/${llmCount})`,
      );
    }
    const toolCallCount = runEvents.filter(isToolCallEvent).length;
    if (toolCallCount !== run.toolCallCount) {
      failures.push(
        `${run.id}:tool_rollup_mismatch(${run.toolCallCount}/${toolCallCount})`,
      );
    }
  }
  return failures;
}

function findArbitrationFailures(
  events: readonly ExportEvent[],
  eventOrder: ReadonlyMap<string, number>,
) {
  const byRun = new Map<string, ExportEvent[]>();
  for (const event of events) {
    const list = byRun.get(event.identity.traceRunId) ?? [];
    list.push(event);
    byRun.set(event.identity.traceRunId, list);
  }
  const failures: string[] = [];
  for (const runEvents of byRun.values()) {
    const ordered = [...runEvents].sort((left, right) =>
      compareEventOrder(left, right, eventOrder),
    );
    for (const [index, event] of ordered.entries()) {
      if (!isDurableL2WriteEvent(event)) continue;
      const hasPriorArbitration = ordered
        .slice(0, index)
        .some(isAuthorizingArbitrationEvent);
      if (!hasPriorArbitration) failures.push(event.identity.eventId);
    }
  }
  return failures;
}

function isDurableL2WriteEvent(event: ExportEvent) {
  if (event.scope.kind !== "memory") return false;
  const metadata = event.details?.metadata;
  const output = asRecord(event.details?.output);
  const persistedFactIds = [
    ...readStringArray(output?.acceptedFactIds),
    ...readStringArray(output?.auditedFactIds),
    ...readStringArray(output?.updatedFactIds),
    ...readStringArray(output?.l2FactIds),
  ];
  return (
    metadata?.operation === "durable_fact_change" ||
    metadata?.durableFactWrite === true ||
    metadata?.memoryStore === "l2_fact" ||
    persistedFactIds.length > 0
  );
}

function isAuthorizingArbitrationEvent(event: ExportEvent) {
  if (event.scope.kind !== "memory" || event.lifecycle.status === "skipped") {
    return false;
  }
  const metadata = event.details?.metadata;
  const opcode = metadata?.opcode;
  const decision = metadata?.decision;
  return (
    metadata?.operation === "arbitration" &&
    typeof opcode === "string" &&
    opcode.length > 0 &&
    typeof decision === "string" &&
    decision.length > 0 &&
    decision !== "skipped"
  );
}

function isToolCallEvent(event: ExportEvent) {
  if (event.scope.kind !== "tool") return false;
  const eventRole = event.details?.metadata?.eventRole;
  if (eventRole === "call") return true;
  if (eventRole === "result") return false;
  return (
    event.lifecycle.status === "started" ||
    /tool call/i.test(event.scope.title)
  );
}

function compareEventOrder(
  left: ExportEvent,
  right: ExportEvent,
  eventOrder: ReadonlyMap<string, number>,
) {
  const leftExportIndex = eventOrder.get(left.identity.eventId);
  const rightExportIndex = eventOrder.get(right.identity.eventId);
  if (leftExportIndex !== undefined && rightExportIndex !== undefined) {
    return leftExportIndex - rightExportIndex;
  }
  const leftStep = left.identity.stepIndex;
  const rightStep = right.identity.stepIndex;
  if (leftStep !== undefined && rightStep !== undefined) {
    return leftStep - rightStep;
  }
  return left.lifecycle.occurredAt.localeCompare(right.lifecycle.occurredAt);
}

function normalizeBound(value: number) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function formatIteration(value: number) {
  return Number.isFinite(value) ? String(value) : "missing";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
