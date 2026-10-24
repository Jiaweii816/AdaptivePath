import { sanitizeToolProtocolText } from "@/server/llm/tool-protocol-leak";
import type { CoachChatLoopMessage } from "./coach-agent.types";
import {
  resolveStoredMessageRevision,
  sameWorkspaceCodeRevision,
  type WorkspaceCodeRevision,
} from "./workspace-revision";

export type StoredChatMessageForProjection = {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  contentMarkdown: string;
  metadataJson: string;
  reviewAttemptId: string | null;
  reviewAttempt: { language: string; codeSnapshot: string } | null;
};

export type HistoryProjectionDecisionReason =
  | "included_same_revision"
  | "included_earlier_revision"
  | "included_unknown_revision"
  | "excluded_before_clear_boundary"
  | "excluded_model_history_budget";

export type HistoryProjectionDecision = {
  messageId: string;
  sequence: number;
  role: "user" | "assistant";
  included: boolean;
  reason: HistoryProjectionDecisionReason;
};

export type ConversationProjection = {
  messages: CoachChatLoopMessage[];
  decisions: HistoryProjectionDecision[];
};

const SAME_REVISION_ASSISTANT_CANDIDATE =
  /(?:```(?:python)?[^`]*\bclass\s+Solution\b[^`]*```|\bclass\s+Solution\s*:?[\s\S]{0,3000}\bdef\s+\w+\s*\()/iu;
export const EARLIER_CODE_REVISION_MARKER = "⟨针对更早的代码版本⟩";
export const UNKNOWN_CODE_REVISION_MARKER = "⟨代码版本未知；仅作对话连续性⟩";

export function hasSameRevisionAssistantCandidate(
  projection: ConversationProjection,
): boolean {
  return projection.messages.some(
    (message) =>
      message.role === "assistant" &&
      typeof message.content === "string" &&
      !message.content.startsWith(EARLIER_CODE_REVISION_MARKER) &&
      !message.content.startsWith(UNKNOWN_CODE_REVISION_MARKER) &&
      SAME_REVISION_ASSISTANT_CANDIDATE.test(message.content),
  );
}

type ProjectionArgs = {
  storedMessages: readonly StoredChatMessageForProjection[];
  currentRevision: WorkspaceCodeRevision | undefined;
  clearedBeforeSequence: number;
  maxModelMessages: number;
};

export function projectCurrentRevisionWindow(
  args: ProjectionArgs,
): ConversationProjection {
  const decisions = applyMessageBudget(
    classifyMessages(args),
    args.maxModelMessages,
  );
  const includedById = new Map(
    decisions
      .filter((item) => item.included)
      .map((item) => [item.messageId, item] as const),
  );
  const messages = [...args.storedMessages]
    .filter((message) => includedById.has(message.id))
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => toLoopMessage(message, includedById.get(message.id)!));

  return {
    messages,
    decisions,
  };
}

function classifyMessages(args: ProjectionArgs) {
  return [...args.storedMessages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => classifyMessage(message, args));
}

function classifyMessage(
  message: StoredChatMessageForProjection,
  args: ProjectionArgs,
): HistoryProjectionDecision {
  if (message.sequence <= args.clearedBeforeSequence) {
    return decision(message, false, "excluded_before_clear_boundary");
  }

  const revision = resolveStoredMessageRevision({
    problemId: args.currentRevision?.problemId ?? "",
    metadataJson: message.metadataJson,
    reviewAttempt: message.reviewAttempt,
  });
  if (!args.currentRevision || !revision) {
    return decision(message, true, "included_unknown_revision");
  }
  if (!sameWorkspaceCodeRevision(revision, args.currentRevision)) {
    return decision(message, true, "included_earlier_revision");
  }
  return decision(message, true, "included_same_revision");
}

function decision(
  message: StoredChatMessageForProjection,
  included: boolean,
  reason: HistoryProjectionDecisionReason,
): HistoryProjectionDecision {
  return {
    messageId: message.id,
    sequence: message.sequence,
    role: message.role,
    included,
    reason,
  };
}

function applyMessageBudget(
  decisions: readonly HistoryProjectionDecision[],
  maxModelMessages: number,
) {
  const included = decisions.filter((item) => item.included);
  const keep = new Set(
    (maxModelMessages > 0 ? included.slice(-maxModelMessages) : []).map(
      (item) => item.messageId,
    ),
  );

  return decisions.map((item): HistoryProjectionDecision =>
    item.included && !keep.has(item.messageId)
      ? { ...item, included: false, reason: "excluded_model_history_budget" }
      : item,
  );
}

function toLoopMessage(
  message: StoredChatMessageForProjection,
  projection: HistoryProjectionDecision,
): CoachChatLoopMessage {
  const marker =
    projection.reason === "included_earlier_revision"
      ? `${EARLIER_CODE_REVISION_MARKER} `
      : projection.reason === "included_unknown_revision"
        ? `${UNKNOWN_CODE_REVISION_MARKER} `
        : "";
  return {
    role: message.role,
    content: `${marker}${modelSafeContent(message)}`,
  };
}

function modelSafeContent(message: StoredChatMessageForProjection) {
  return message.role === "assistant"
    ? sanitizeToolProtocolText(message.contentMarkdown).text
    : message.contentMarkdown;
}
