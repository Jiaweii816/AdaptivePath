import type {
  ActionOutcome,
  ActionOutcomeOptions,
  DurableWriteFailureReason,
  DurableWriteUnfulfilledReason,
} from "./durable-write-result-semantics";
import {
  buildFailedActionOutcome,
  buildUnfulfilledActionOutcome,
  evaluateDurableWriteResult,
} from "./durable-write-result-semantics";
import type { DurableWriteToolName } from "./durable-write-types";

export type RequiredActionStatus =
  "pending" | "completed" | "failed" | "unfulfilled";

export type RequiredActionEvidence = readonly unknown[];

export type RequiredAction = {
  readonly toolName: DurableWriteToolName;
  readonly order: number;
  readonly status: RequiredActionStatus;
  readonly admitted: boolean;
  readonly invalidArgumentFailures: number;
  readonly evidence: RequiredActionEvidence;
  readonly terminalReason?:
    DurableWriteFailureReason | DurableWriteUnfulfilledReason;
  readonly outcome?: ActionOutcome;
};

export type RequiredActionSeed = Pick<
  RequiredAction,
  "toolName" | "order" | "evidence"
>;

export type RequiredActionLedger = {
  readonly actions: readonly RequiredAction[];
};

const MAX_INVALID_ARGUMENT_FAILURES = 2;

export function createRequiredActionLedger(
  seeds: readonly RequiredActionSeed[],
): RequiredActionLedger {
  const seen = new Set<DurableWriteToolName>();
  const actions = [...seeds]
    .sort((left, right) => left.order - right.order)
    .map((seed) => {
      if (seen.has(seed.toolName)) {
        throw new Error(`Duplicate required action for ${seed.toolName}.`);
      }
      seen.add(seed.toolName);
      return {
        ...seed,
        evidence: [...seed.evidence],
        status: "pending" as const,
        admitted: false,
        invalidArgumentFailures: 0,
      };
    });
  return { actions };
}

export function admitRequiredAction(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
): RequiredActionLedger {
  return updatePendingAction(ledger, toolName, (action) => ({
    ...action,
    admitted: true,
  }));
}

export function recordInvalidArguments(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
  options: ActionOutcomeOptions = {},
): { ledger: RequiredActionLedger; retryAllowed: boolean } {
  let retryAllowed = false;
  const nextLedger = updatePendingAction(ledger, toolName, (action) => {
    const invalidArgumentFailures = action.invalidArgumentFailures + 1;
    retryAllowed = invalidArgumentFailures < MAX_INVALID_ARGUMENT_FAILURES;
    if (retryAllowed) {
      return { ...action, invalidArgumentFailures };
    }
    return {
      ...action,
      invalidArgumentFailures,
      status: "failed",
      terminalReason: "invalid_tool_arguments",
      outcome: buildFailedActionOutcome(
        toolName,
        "invalid_tool_arguments",
        options,
      ),
    };
  });
  return { ledger: nextLedger, retryAllowed };
}

export function recordRequiredActionResult(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
  result: unknown,
  options: ActionOutcomeOptions = {},
): RequiredActionLedger {
  return updatePendingAction(ledger, toolName, (action) => {
    const evaluation = evaluateDurableWriteResult(toolName, result, options);
    if (evaluation.status === "completed") {
      return {
        ...action,
        status: "completed",
        outcome: evaluation.outcome,
      };
    }
    return {
      ...action,
      status: "failed",
      terminalReason: evaluation.failureReason,
      outcome: evaluation.outcome,
    };
  });
}

export function markRequiredActionFailed(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
  reason: DurableWriteFailureReason,
  options: ActionOutcomeOptions = {},
): RequiredActionLedger {
  return updatePendingAction(ledger, toolName, (action) => ({
    ...action,
    status: "failed",
    terminalReason: reason,
    outcome: buildFailedActionOutcome(toolName, reason, options),
  }));
}

export function markRequiredActionUnfulfilled(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
  reason: DurableWriteUnfulfilledReason,
  options: ActionOutcomeOptions = {},
): RequiredActionLedger {
  return updatePendingAction(ledger, toolName, (action) => ({
    ...action,
    status: "unfulfilled",
    terminalReason: reason,
    outcome: buildUnfulfilledActionOutcome(toolName, reason, options),
  }));
}

export function markPendingRequiredActionsUnfulfilled(
  ledger: RequiredActionLedger,
  reason: DurableWriteUnfulfilledReason,
  options: ActionOutcomeOptions = {},
): RequiredActionLedger {
  return ledger.actions.reduce(
    (current, action) =>
      action.status === "pending"
        ? markRequiredActionUnfulfilled(
            current,
            action.toolName,
            reason,
            options,
          )
        : current,
    ledger,
  );
}

export function buildActionOutcomes(
  ledger: RequiredActionLedger,
): readonly ActionOutcome[] {
  const pending = ledger.actions.find((action) => action.status === "pending");
  if (pending) {
    throw new Error(
      `Cannot build final action outcomes while ${pending.toolName} is pending.`,
    );
  }
  return ledger.actions.map((action) => {
    if (!action.outcome) {
      throw new Error(
        `Terminal required action ${action.toolName} is missing an outcome.`,
      );
    }
    return action.outcome;
  });
}

export function pendingRequiredActions(ledger: RequiredActionLedger) {
  return ledger.actions.filter((action) => action.status === "pending");
}

function updatePendingAction(
  ledger: RequiredActionLedger,
  toolName: DurableWriteToolName,
  update: (action: RequiredAction) => RequiredAction,
): RequiredActionLedger {
  const index = ledger.actions.findIndex(
    (action) => action.toolName === toolName,
  );
  if (index < 0) {
    throw new Error(
      `Required action ${toolName} does not exist in the ledger.`,
    );
  }
  const current = ledger.actions[index];
  if (current.status !== "pending") {
    throw new Error(
      `Required action ${toolName} is already terminal (${current.status}).`,
    );
  }
  const actions = [...ledger.actions];
  actions[index] = update(current);
  return { actions };
}
