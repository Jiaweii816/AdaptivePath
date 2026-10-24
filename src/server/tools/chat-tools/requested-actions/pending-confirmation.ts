import type { DurableWriteToolName } from "../durable-write-types";
import { normalizeActionText } from "./action-lexicon";
import {
  resolveRequestedActions,
  type RequestedAction,
} from "./resolve-requested-actions";

export type PendingRequestedAction = Pick<
  RequestedAction,
  "toolName" | "order" | "evidence"
>;

export type PendingConfirmationResolution = {
  disposition: "confirmed" | "rejected" | "ambiguous" | "discarded";
  promotedTools: readonly DurableWriteToolName[];
  rejectedTools: readonly DurableWriteToolName[];
  unresolvedTools: readonly DurableWriteToolName[];
};

const SINGLE_SHORT_CONFIRMATIONS = new Set([
  "好",
  "好的",
  "可以",
  "行",
  "存吧",
  "保存吧",
  "确认",
  "yes",
  "yep",
  "ok",
  "okay",
  "doit",
]);

const ALL_SHORT_CONFIRMATIONS = new Set([
  "两个都要",
  "两个都保存",
  "都要",
  "都保存",
  "都存吧",
  "全部保存",
  "全都保存",
  "both",
  "saveboth",
  "bothplease",
]);

const ALL_SHORT_REJECTIONS = new Set([
  "不",
  "不要",
  "不用",
  "不用了",
  "算了",
  "取消",
  "别存了",
  "no",
  "nope",
  "cancel",
  "nevermind",
]);

/**
 * Resolve a one-turn confirmation from caller-provided pending actions. This
 * function does not persist state: callers must discard the pending set after
 * this evaluation, regardless of the disposition.
 */
export function resolvePendingConfirmation(input: {
  message: string;
  pending: readonly PendingRequestedAction[];
}): PendingConfirmationResolution {
  const pendingTools = uniqueTools(input.pending);
  if (pendingTools.length === 0) {
    return emptyResolution("discarded");
  }

  const compact = normalizeConfirmationToken(input.message);
  if (ALL_SHORT_REJECTIONS.has(compact)) {
    return {
      disposition: "rejected",
      promotedTools: [],
      rejectedTools: pendingTools,
      unresolvedTools: [],
    };
  }

  const explicit = resolveRequestedActions(input.message).filter((action) =>
    pendingTools.includes(action.toolName),
  );
  const explicitlyRejected = explicit
    .filter((action) => action.decision === "denied")
    .map((action) => action.toolName);
  const explicitlyGranted = explicit
    .filter((action) => action.decision === "granted")
    .map((action) => action.toolName)
    .filter((toolName) => !explicitlyRejected.includes(toolName));

  if (explicitlyRejected.length > 0 || explicitlyGranted.length > 0) {
    const unresolved = pendingTools.filter(
      (toolName) =>
        !explicitlyRejected.includes(toolName) &&
        !explicitlyGranted.includes(toolName),
    );
    return {
      disposition:
        explicitlyGranted.length > 0
          ? "confirmed"
          : unresolved.length > 0
            ? "ambiguous"
            : "rejected",
      promotedTools: explicitlyGranted,
      rejectedTools: explicitlyRejected,
      unresolvedTools: unresolved,
    };
  }

  if (pendingTools.length === 1 && SINGLE_SHORT_CONFIRMATIONS.has(compact)) {
    return {
      disposition: "confirmed",
      promotedTools: pendingTools,
      rejectedTools: [],
      unresolvedTools: [],
    };
  }
  if (pendingTools.length > 1 && ALL_SHORT_CONFIRMATIONS.has(compact)) {
    return {
      disposition: "confirmed",
      promotedTools: pendingTools,
      rejectedTools: [],
      unresolvedTools: [],
    };
  }
  if (pendingTools.length > 1 && SINGLE_SHORT_CONFIRMATIONS.has(compact)) {
    return {
      disposition: "ambiguous",
      promotedTools: [],
      rejectedTools: [],
      unresolvedTools: pendingTools,
    };
  }

  return {
    disposition: "discarded",
    promotedTools: [],
    rejectedTools: [],
    unresolvedTools: [],
  };
}

function normalizeConfirmationToken(message: string) {
  return normalizeActionText(message.trim()).compact.replace(
    /[。！？!?.,，；;]+$/u,
    "",
  );
}

function uniqueTools(pending: readonly PendingRequestedAction[]) {
  return [...new Set(pending.map((action) => action.toolName))].sort(
    (left, right) => {
      const leftOrder =
        pending.find((action) => action.toolName === left)?.order ?? 0;
      const rightOrder =
        pending.find((action) => action.toolName === right)?.order ?? 0;
      return leftOrder - rightOrder;
    },
  );
}

function emptyResolution(
  disposition: PendingConfirmationResolution["disposition"],
): PendingConfirmationResolution {
  return {
    disposition,
    promotedTools: [],
    rejectedTools: [],
    unresolvedTools: [],
  };
}
