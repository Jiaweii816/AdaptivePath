import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import type { TraceContext } from "@/server/llm/trace-context";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { ChatToolDispatchError } from "@/server/tools/chat-tools/chat-tool-dispatch";
import { chatToolRuntimeMetadata } from "@/server/tools/chat-tools/chat-tool-runtime";
import type {
  ChatToolRuntimeDenialReason,
  ChatToolRuntimeSnapshot,
} from "@/server/tools/chat-tools/chat-tool-runtime";
import { isDurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";
import type {
  DurableWriteFailureReason,
  DurableWriteUnfulfilledReason,
} from "@/server/tools/chat-tools/durable-write-result-semantics";
import { splitRequestedActionClauses } from "@/server/tools/chat-tools/requested-actions";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import type { RequiredActionLedger } from "@/server/tools/chat-tools/required-action-ledger";
import { deriveTurnToolPlan } from "@/server/tools/chat-tools/turn-tool-plan";
import type { TurnToolPlan } from "@/server/tools/chat-tools/turn-tool-plan";
import type { ChatTurnPlan } from "./coach-agent.types";
import type { ChatToolStopReason } from "./chat-reply-contracts";

// These tools are alternative recommendation sources. They must be visible to
// the model, but neither is a prerequisite for the other or a mandate to call
// both: the tool descriptions make the source choice from the learner's words.
const RECOMMENDATION_SOURCE_TOOLS = new Set<ChatToolName>([
  "find_practice_problem",
  "search_interview_variant_candidates",
]);

export function detectStepwiseExecutionWording(message: string) {
  return /(?:一步步|逐步)[^，,。！？!?;；\n]{0,24}(?:执行|运行|跑|测试|验证)/.test(
    message.trim().toLowerCase(),
  );
}

export function deriveChatTurnToolPlan(args: {
  mode: TurnToolPlan["mode"];
  ledger: RequiredActionLedger;
  runtimeSnapshot: ChatToolRuntimeSnapshot;
  chatTurnPlan: ChatTurnPlan;
  batchOpportunityUsed: boolean;
  durableOnly: boolean;
  explicitlyDeniedToolNames: ReadonlySet<ChatToolName>;
  topologyToolOrder: ReadonlyMap<ChatToolName, number>;
  loadedToolNames?: ReadonlySet<ChatToolName>;
}) {
  const allowedToolNames = buildAllowedToolNames(args);
  return deriveTurnToolPlan({
    mode: args.mode,
    ledger: args.ledger,
    limits: runtimeLimits(args.runtimeSnapshot),
    usage: runtimeUsage(args.runtimeSnapshot),
    toolMetadata: chatToolRuntimeMetadata,
    allowedToolNames,
    batchOpportunityUsed: args.batchOpportunityUsed,
    prerequisiteToolName: args.durableOnly
      ? undefined
      : nextUnmetTopologyTool(args, allowedToolNames),
    fallbackToolChoice: "auto",
  });
}

function buildAllowedToolNames(args: {
  ledger: RequiredActionLedger;
  chatTurnPlan: ChatTurnPlan;
  durableOnly: boolean;
  explicitlyDeniedToolNames: ReadonlySet<ChatToolName>;
  loadedToolNames?: ReadonlySet<ChatToolName>;
}) {
  const pending = args.ledger.actions
    .filter((action) => action.status === "pending")
    .map((action) => action.toolName)
    .filter((name) => !args.explicitlyDeniedToolNames.has(name));
  if (args.durableOnly) return new Set<ChatToolName>(pending.filter((name) => !args.loadedToolNames || args.loadedToolNames.has(name)));
  if (args.loadedToolNames) {
    return new Set([...args.loadedToolNames].filter((name) => !args.explicitlyDeniedToolNames.has(name)));
  }
  return new Set<ChatToolName>([
    ...args.chatTurnPlan.toolCapabilities.filter(
      (name) => !args.explicitlyDeniedToolNames.has(name),
    ),
    ...pending,
  ]);
}

function runtimeLimits(snapshot: ChatToolRuntimeSnapshot) {
  return {
    cost: snapshot.costBudget,
    executions: snapshot.executionLimit,
    requests: snapshot.requestLimit,
  };
}

function runtimeUsage(snapshot: ChatToolRuntimeSnapshot) {
  return {
    cost: snapshot.costSpent,
    executions: snapshot.executed,
    requests: snapshot.requested,
    perToolExecutions: snapshot.perToolExecutions,
  };
}

function nextUnmetTopologyTool(args: {
  runtimeSnapshot: ChatToolRuntimeSnapshot;
  topologyToolOrder: ReadonlyMap<ChatToolName, number>;
}, allowedToolNames: ReadonlySet<ChatToolName>): ChatToolName | undefined {
  const candidates = [...args.topologyToolOrder.entries()]
    .filter(
      ([tool]) =>
        allowedToolNames.has(tool) &&
        (args.runtimeSnapshot.perToolRequests[tool] ?? 0) === 0,
    )
    .sort(([leftTool, leftOrder], [rightTool, rightOrder]) =>
      leftOrder - rightOrder || leftTool.localeCompare(rightTool),
    );
  const next = candidates[0]?.[0];
  return next && !RECOMMENDATION_SOURCE_TOOLS.has(next) ? next : undefined;
}

export function hasPendingRequiredAction(
  ledger: RequiredActionLedger,
  toolName: ChatToolName,
) {
  return (
    isDurableWriteToolName(toolName) &&
    ledger.actions.some(
      (action) => action.toolName === toolName && action.status === "pending",
    )
  );
}

export function durableFailureReasonFromRuntimeError(
  error: unknown,
): DurableWriteFailureReason {
  return error instanceof ChatToolDispatchError &&
    error.errorKind === "invalid_result"
    ? "invalid_tool_result"
    : "tool_execution_error";
}

export function runtimeDenialToUnfulfilledReason(
  reason: ChatToolRuntimeDenialReason | "tool_execution_error",
): DurableWriteUnfulfilledReason {
  const values: Partial<Record<typeof reason, DurableWriteUnfulfilledReason>> =
    {
      request_limit_reached: "request_limit",
      execution_limit_reached: "execution_limit",
      cost_budget_exhausted: "cost_budget",
      per_tool_cap_reached: "per_tool_cap_reached",
      tool_not_available_this_turn: "tool_not_available_this_turn",
    };
  return values[reason] ?? "no_available_tools";
}

export function inferNoAvailableToolReason(snapshot: ChatToolRuntimeSnapshot) {
  if (snapshot.requested >= snapshot.requestLimit)
    return "request_limit" as const;
  if (snapshot.executed >= snapshot.executionLimit)
    return "execution_limit" as const;
  if (snapshot.remainingCost <= 0) return "cost_budget" as const;
  return "no_available_tools" as const;
}

export function inferToolStopReason(
  snapshot: ChatToolRuntimeSnapshot,
): ChatToolStopReason {
  return inferNoAvailableToolReason(snapshot);
}

export async function appendRequestedActionResolverTrace(
  traceContext: TraceContext,
  args: { requestedActions: readonly RequestedAction[] },
) {
  const requiredActions = actionNames(args.requestedActions, "granted");
  const explicitProhibitions = actionNames(args.requestedActions, "denied");
  await appendTraceEventBestEffort(traceContext, {
    stage: "requested_action_resolution",
    kind: "guard",
    title: "Resolve durable write obligations and explicit prohibitions",
    status: "succeeded",
    details: {
      output: {
        mode: "obligation_only",
        requestedActions: args.requestedActions,
        requiredActions,
        explicitProhibitions,
      },
      stateDelta: { requiredActions, explicitProhibitions },
      metadata: {
        deterministic: true,
        role: "obligation_and_prohibition_not_positive_authorization",
      },
    },
  });
}

function actionNames(
  actions: readonly RequestedAction[],
  decision: RequestedAction["decision"],
) {
  return actions
    .filter((action) => action.decision === decision)
    .map((action) => action.toolName);
}

export function isPureDurableActionTurn(
  message: string,
  requestedActions: readonly RequestedAction[],
) {
  if (!hasOnlyGrantedDurableIntent(requestedActions)) return false;
  const covered = new Set(
    requestedActions.flatMap((action) =>
      action.evidence.map((evidence) => evidence.clause.trim()),
    ),
  );
  const clauses = splitRequestedActionClauses(message);
  return (
    clauses.length > 0 &&
    clauses.every((clause) => covered.has(clause.text.trim()))
  );
}

function hasOnlyGrantedDurableIntent(actions: readonly RequestedAction[]) {
  return (
    actions.some((action) => action.decision === "granted") &&
    !actions.some(
      (action) =>
        action.decision === "needs_confirmation" ||
        (action.decision === "denied" &&
          action.evidence.some((evidence) => evidence.exclusionId !== "E1")),
    )
  );
}
