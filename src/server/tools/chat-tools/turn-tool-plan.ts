import {
  buildChatToolManifest,
  type ChatToolManifestEntry,
  type ChatToolName,
} from "./chat-tool-contracts";
import type {
  RequiredAction,
  RequiredActionLedger,
} from "./required-action-ledger";
import {
  admitRequiredAction,
  markRequiredActionUnfulfilled,
} from "./required-action-ledger";

export type TurnToolPlanMode =
  "tool_loop" | "finalize_without_tools" | "tools_disabled" | "deep_reasoning";

export type ToolPlanningMetadata = {
  readonly costUnits: number;
  readonly maxExecutionsPerTurn?: number;
};

export type ToolCapacity = {
  readonly cost: number;
  readonly executions: number;
  readonly requests: number;
};

export type ToolCapacityUsage = ToolCapacity & {
  readonly perToolExecutions?: Partial<Record<ChatToolName, number>>;
};

export type TurnToolPlan = {
  readonly mode: TurnToolPlanMode;
  readonly availableToolNames: ReadonlySet<ChatToolName>;
  readonly manifest: readonly ChatToolManifestEntry[];
  readonly toolChoice: "auto" | ChatToolName | undefined;
  readonly reserved: ToolCapacity;
  readonly requiredActions: readonly RequiredAction[];
  readonly ledger: RequiredActionLedger;
};

export type DeriveTurnToolPlanArgs = {
  mode: TurnToolPlanMode;
  ledger: RequiredActionLedger;
  limits: ToolCapacity;
  usage: ToolCapacityUsage;
  toolMetadata: Partial<Record<ChatToolName, ToolPlanningMetadata>>;
  allowedToolNames: ReadonlySet<ChatToolName>;
  batchOpportunityUsed: boolean;
  prerequisiteToolName?: ChatToolName;
  fallbackToolChoice?: "auto";
};

const NO_CAPACITY: ToolCapacity = { cost: 0, executions: 0, requests: 0 };

export function deriveTurnToolPlan(args: DeriveTurnToolPlanArgs): TurnToolPlan {
  if (args.mode !== "tool_loop") {
    return {
      mode: args.mode,
      availableToolNames: new Set(),
      manifest: [],
      toolChoice: undefined,
      reserved: NO_CAPACITY,
      requiredActions: args.ledger.actions,
      ledger: args.ledger,
    };
  }

  const ledger = admitPendingActions(args);
  const reserved = calculateRequiredReserve(ledger, args.toolMetadata);
  assertReserveFits(args.limits, args.usage, reserved);

  const availableToolNames = new Set<ChatToolName>();
  for (const toolName of args.allowedToolNames) {
    const metadata = args.toolMetadata[toolName];
    if (!metadata || hasReachedPerToolCap(toolName, metadata, args.usage)) {
      continue;
    }

    const requiredAction = ledger.actions.find(
      (action) => action.toolName === toolName,
    );
    if (requiredAction?.status === "pending" && requiredAction.admitted) {
      availableToolNames.add(toolName);
      continue;
    }
    if (
      fitsCapacity(
        args.limits,
        addCapacity(args.usage, reserved, {
          cost: metadata.costUnits,
          executions: 1,
          requests: 1,
        }),
      )
    ) {
      availableToolNames.add(toolName);
    }
  }

  return {
    mode: args.mode,
    availableToolNames,
    manifest: buildChatToolManifest(availableToolNames),
    toolChoice: selectToolLoopChoice({
      requiredActions: ledger.actions,
      availableToolNames,
      batchOpportunityUsed: args.batchOpportunityUsed,
      prerequisiteToolName: args.prerequisiteToolName,
      fallbackToolChoice: args.fallbackToolChoice,
    }),
    reserved,
    requiredActions: ledger.actions,
    ledger,
  };
}

export function selectToolLoopChoice(args: {
  requiredActions: readonly RequiredAction[];
  availableToolNames: ReadonlySet<ChatToolName>;
  batchOpportunityUsed: boolean;
  prerequisiteToolName?: ChatToolName;
  fallbackToolChoice?: "auto";
}): "auto" | ChatToolName | undefined {
  if (args.prerequisiteToolName) {
    return args.availableToolNames.has(args.prerequisiteToolName)
      ? args.prerequisiteToolName
      : undefined;
  }
  const pending = args.requiredActions
    .filter((action) => action.status === "pending" && action.admitted)
    .sort((left, right) => left.order - right.order);
  if (!args.batchOpportunityUsed && pending.length > 0) {
    return "auto";
  }
  const forced = pending.find((action) =>
    args.availableToolNames.has(action.toolName),
  );
  return forced?.toolName ?? args.fallbackToolChoice;
}

export function calculateRequiredReserve(
  ledger: RequiredActionLedger,
  toolMetadata: Partial<Record<ChatToolName, ToolPlanningMetadata>>,
): ToolCapacity {
  return ledger.actions.reduce<ToolCapacity>((reserved, action) => {
    if (action.status !== "pending" || !action.admitted) {
      return reserved;
    }
    const metadata = toolMetadata[action.toolName];
    if (!metadata) {
      throw new Error(`Missing planning metadata for ${action.toolName}.`);
    }
    return addCapacity(reserved, {
      cost: metadata.costUnits,
      executions: 1,
      requests: Math.max(1, 2 - action.invalidArgumentFailures),
    });
  }, NO_CAPACITY);
}

function admitPendingActions(
  args: DeriveTurnToolPlanArgs,
): RequiredActionLedger {
  let ledger = args.ledger;
  let reserved = calculateRequiredReserve(ledger, args.toolMetadata);
  assertReserveFits(args.limits, args.usage, reserved);

  for (const action of [...ledger.actions].sort(
    (left, right) => left.order - right.order,
  )) {
    if (action.status !== "pending" || action.admitted) {
      continue;
    }
    const metadata = args.toolMetadata[action.toolName];
    if (!metadata || !args.allowedToolNames.has(action.toolName)) {
      ledger = markRequiredActionUnfulfilled(
        ledger,
        action.toolName,
        "tool_not_available_this_turn",
      );
      continue;
    }
    if (hasReachedPerToolCap(action.toolName, metadata, args.usage)) {
      ledger = markRequiredActionUnfulfilled(
        ledger,
        action.toolName,
        "per_tool_cap_reached",
      );
      continue;
    }
    const actionReserve = {
      cost: metadata.costUnits,
      executions: 1,
      requests: Math.max(1, 2 - action.invalidArgumentFailures),
    };
    const nextReserved = addCapacity(reserved, actionReserve);
    const failure = capacityFailureReason(
      args.limits,
      addCapacity(args.usage, nextReserved),
    );
    if (failure) {
      ledger = markRequiredActionUnfulfilled(ledger, action.toolName, failure);
      continue;
    }
    ledger = admitRequiredAction(ledger, action.toolName);
    reserved = nextReserved;
  }
  return ledger;
}

function assertReserveFits(
  limits: ToolCapacity,
  usage: ToolCapacityUsage,
  reserved: ToolCapacity,
) {
  const failure = capacityFailureReason(limits, addCapacity(usage, reserved));
  if (failure) {
    throw new Error(
      `Previously admitted required-action reserve no longer fits (${failure}).`,
    );
  }
}

function hasReachedPerToolCap(
  toolName: ChatToolName,
  metadata: ToolPlanningMetadata,
  usage: ToolCapacityUsage,
) {
  return (
    metadata.maxExecutionsPerTurn !== undefined &&
    (usage.perToolExecutions?.[toolName] ?? 0) >= metadata.maxExecutionsPerTurn
  );
}

function capacityFailureReason(limits: ToolCapacity, usage: ToolCapacity) {
  if (usage.cost > limits.cost) {
    return "capacity_cost" as const;
  }
  if (usage.executions > limits.executions) {
    return "capacity_execution" as const;
  }
  if (usage.requests > limits.requests) {
    return "capacity_request" as const;
  }
  return undefined;
}

function fitsCapacity(limits: ToolCapacity, usage: ToolCapacity) {
  return capacityFailureReason(limits, usage) === undefined;
}

function addCapacity(...values: readonly ToolCapacity[]): ToolCapacity {
  return values.reduce<ToolCapacity>(
    (sum, value) => ({
      cost: sum.cost + value.cost,
      executions: sum.executions + value.executions,
      requests: sum.requests + value.requests,
    }),
    NO_CAPACITY,
  );
}
