import { historyRecallToolResultSchema } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { ChatReplyResult } from "./chat-reply-contracts";
import type { TurnUnderstanding } from "./turn-understanding/turn-understanding.types";

export type HistoryRecallScope = "none" | "recall_only" | "compound";

type HistoryRecallGuardBase = {
  reply: string;
  responseLanguage: "zh" | "en";
  toolTrace: ChatReplyResult["toolTrace"];
};

type ScopedHistoryRecallGuardArgs = HistoryRecallGuardBase & {
  recallScope: HistoryRecallScope;
};

/** @deprecated Direct callers should provide a derived recallScope. */
type DirectHistoryRecallGuardArgs = HistoryRecallGuardBase &
  Record<string, unknown>;

export function deriveHistoryRecallScope(
  understanding: Pick<TurnUnderstanding, "operations">,
): HistoryRecallScope {
  const hasRecall = understanding.operations.some(
    ({ family }) => family === "recall",
  );
  if (!hasRecall) return "none";
  return understanding.operations.every(({ family }) => family === "recall")
    ? "recall_only"
    : "compound";
}

export function guardHistoryRecallScopeClaims(
  args: ScopedHistoryRecallGuardArgs | DirectHistoryRecallGuardArgs,
) {
  const recallScope = resolveRecallScope(args);
  if (recallScope !== "recall_only") {
    return unchanged(args.reply);
  }
  if (containsNonHistoryTool(args.toolTrace)) {
    // Compound requests still need the model to synthesize all observations.
    return unchanged(args.reply);
  }
  const recalled = [...args.toolTrace]
    .reverse()
    .find(
      (entry) =>
        entry.name === "past_problem_recall" ||
        entry.name === "past_mistake_recall",
    );
  if (!recalled) return unchanged(args.reply);

  const parsed = historyRecallToolResultSchema.safeParse(recalled.result);
  if (!parsed.success) return unchanged(args.reply);
  const items = parsed.data.items;
  if (items.length === 0) {
    return {
      reply: emptyRecallReply(args.responseLanguage),
      replaced: true,
      itemCount: 0,
    };
  }
  if (
    !containsUnsupportedHistoryClaim(args.reply) &&
    isGroundedTransferReply(args.reply, items)
  ) {
    return {
      reply: args.reply,
      replaced: false,
      itemCount: items.length,
    };
  }
  const rendered = items
    .slice(0, 3)
    .map((item) => `- **${item.title}:** ${item.summary}`)
    .join("\n");
  return {
    reply:
      args.responseLanguage === "zh"
        ? `我找到了以下可引用的历史记录：\n\n${rendered}`
        : `I found the following history I can cite:\n\n${rendered}`,
    replaced: true,
    itemCount: items.length,
  };
}

function containsUnsupportedHistoryClaim(reply: string) {
  return /(?:first session|only remember|cross-session memory (?:is )?unavailable|new recurrence i inferred|you always|you never|every time)|(?:第一次会话|只记得当前|无法跨会话|你总是|你从不|你每次|我新推断出)/iu.test(
    reply,
  );
}

function isGroundedTransferReply(
  reply: string,
  items: Array<{ title: string; summary: string }>,
) {
  const normalizedReply = reply.toLowerCase();
  const grounded = items.some((item) =>
    evidenceAnchors(`${item.title} ${item.summary}`).some((anchor) =>
      normalizedReply.includes(anchor),
    ),
  );
  const hasTransfer = /(?:这次|当前|先|检查|确认|提醒|避免|防止|不代表)|(?:this time|current|check|verify|prevent|avoid|reminder|before you)/iu.test(
    reply,
  );
  return grounded && hasTransfer;
}

function evidenceAnchors(value: string) {
  const lower = value.toLowerCase();
  const latin = lower.match(/[a-z0-9_]{4,}/gu) ?? [];
  const hanChunks = lower.match(/[\p{Script=Han}]{4,}/gu) ?? [];
  const han = hanChunks.flatMap((chunk) => {
    const windows: string[] = [];
    for (let index = 0; index <= chunk.length - 4; index += 1) {
      windows.push(chunk.slice(index, index + 4));
    }
    return windows;
  });
  return [...new Set([...latin, ...han])].filter(
    (anchor) => !GENERIC_HISTORY_ANCHORS.has(anchor),
  );
}

const GENERIC_HISTORY_ANCHORS = new Set([
  "previously",
  "learner",
  "problem",
  "history",
  "之前这次",
]);

function resolveRecallScope(
  args: ScopedHistoryRecallGuardArgs | DirectHistoryRecallGuardArgs,
): HistoryRecallScope {
  if (
    "recallScope" in args &&
    (args.recallScope === "none" ||
      args.recallScope === "recall_only" ||
      args.recallScope === "compound")
  ) {
    return args.recallScope;
  }
  const hasRecallTrace = args.toolTrace.some(isHistoryRecallEntry);
  if (!hasRecallTrace) return "none";
  return containsNonHistoryTool(args.toolTrace) ? "compound" : "recall_only";
}

function isHistoryRecallEntry(
  entry: ChatReplyResult["toolTrace"][number],
): boolean {
  return (
    entry.name === "past_problem_recall" ||
    entry.name === "past_mistake_recall"
  );
}

function containsNonHistoryTool(toolTrace: ChatReplyResult["toolTrace"]) {
  return toolTrace.some(
    (entry) =>
      !isHistoryRecallEntry(entry),
  );
}

function emptyRecallReply(language: "zh" | "en") {
  return language === "zh"
    ? "我检查了可信、可检索的学习记录，但这次没有返回与问题匹配的历史证据。这只表示当前检索没有可引用的匹配项，不能据此推断整体历史范围。"
    : "I checked the trusted, searchable learner memory, but this query returned no matching historical evidence. That means I have no relevant record to cite here; it makes no broader claim about the learner history available.";
}

function unchanged(reply: string) {
  return { reply, replaced: false, itemCount: 0 };
}
