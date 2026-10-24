import { historyRecallToolResultSchema } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { ChatReplyResult } from "./chat-reply-contracts";

export function buildHistoryRecallApplicationTrace(args: {
  toolTrace: ChatReplyResult["toolTrace"];
  appliedGuards: readonly string[];
}) {
  const recalled = [...args.toolTrace]
    .reverse()
    .find(
      (entry) =>
        entry.name === "past_problem_recall" ||
        entry.name === "past_mistake_recall",
    );
  if (!recalled) return undefined;
  const parsed = historyRecallToolResultSchema.safeParse(recalled.result);
  if (!parsed.success) {
    return {
      selected: { status: "invalid_tool_result" },
      applied: { status: "unknown" },
      visibleClaim: { status: "unknown" },
    };
  }
  const selectedTitles = parsed.data.items.map((item) => item.title);
  const deterministicProjection = args.appliedGuards.includes(
    "history_recall_scope_claim",
  );
  const visibleTitles = deterministicProjection
    ? selectedTitles.slice(0, 3)
    : undefined;
  return {
    selected: {
      status: "history_selector_output",
      count: selectedTitles.length,
      titles: selectedTitles,
    },
    applied: deterministicProjection
      ? {
          status: "deterministic_history_projection",
          count: visibleTitles?.length ?? 0,
        }
      : { status: "unknown" },
    visibleClaim: deterministicProjection
      ? {
          status: "verified_from_visible_projection",
          count: visibleTitles?.length ?? 0,
          titles: visibleTitles,
        }
      : { status: "unknown" },
  };
}
