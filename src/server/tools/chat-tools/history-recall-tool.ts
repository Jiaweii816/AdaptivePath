import {
  appendTraceEventBestEffort,
  startTraceStep,
} from "@/server/llm/trace-context";
import { projectCandidateForTrace } from "@/server/memory/retrieval/candidate-trace-projection";
import { recallCoachHistoryContext } from "@/server/memory/recall-coach-history-context";
import type { MemoryCandidate } from "@/server/memory/retrieval/candidate-core.types";
import type {
  ChatToolArgs,
  ChatToolResult,
} from "./chat-tool-contracts";
import type { ChatToolExecutionContext } from "./chat-tool-dispatch";

export async function pastProblemRecallChatTool(
  args: ChatToolArgs<"past_problem_recall">,
  context: ChatToolExecutionContext,
): Promise<ChatToolResult<"past_problem_recall">> {
  return recall("past_problem_recall", args, context);
}

export async function pastMistakeRecallChatTool(
  args: ChatToolArgs<"past_mistake_recall">,
  context: ChatToolExecutionContext,
): Promise<ChatToolResult<"past_mistake_recall">> {
  return recall("past_mistake_recall", args, context);
}

async function recall(
  mode: "past_problem_recall" | "past_mistake_recall",
  args:
    | ChatToolArgs<"past_problem_recall">
    | ChatToolArgs<"past_mistake_recall">,
  context: ChatToolExecutionContext,
) {
  const runtimeQuery = context.userMessageContent?.trim() || args.query;
  const recalled = await recallCoachHistoryContext({
    prisma: context.prisma,
    userId: context.userId,
    memoryOrigin: context.memoryOrigin,
    mode,
    userText: runtimeQuery,
    modelQuery: args.query,
    searchHints: args.searchHints,
    activeProblem: {
      ...context.problem,
      leetcodeNumber: context.problem.leetcodeNumber ?? undefined,
      tags: context.problemTags,
    },
    ftsStore: context.ftsStore,
    traceContext: context.traceContext,
  });
  await traceHistoryRecallSelection(context, {
    mode,
    query: runtimeQuery,
    modelQuery: args.query,
    searchHints: args.searchHints,
    decisions: recalled.decisions,
    candidates: recalled.candidates,
    candidateFingerprint: recalled.candidateFingerprint,
  });
  return {
    items: recalled.items.map((item) => ({
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      sourceProblem: item.sourceProblem?.title,
      outcome: item.outcome ? humanize(item.outcome) : undefined,
      mechanisms: item.mechanisms,
      evidenceBasis: item.evidenceBasis,
      executionAuthority: item.executionAuthority,
      resolutionStatus: item.resolutionStatus,
      relationToCurrent: item.relationToCurrent,
    })),
  };
}

async function traceHistoryRecallSelection(
  context: ChatToolExecutionContext,
  args: {
    mode: "past_problem_recall" | "past_mistake_recall";
    query: string;
    modelQuery: string;
    searchHints?: string[];
    decisions: Array<{ candidateId: string; selected: boolean; reason: string }>;
    candidates: MemoryCandidate[];
    candidateFingerprint: string;
  },
) {
  if (!context.traceContext) return;
  const candidateById = new Map(
    args.candidates.map((candidate) => [candidate.id, candidate]),
  );
  await appendTraceEventBestEffort(context.traceContext, {
    step: startTraceStep(context.traceContext, { spanKind: "retrieval" }),
    stage: "context_memory",
    kind: "retrieval",
    title: "History recall selection",
    status: "succeeded",
    details: {
      input: {
        mode: args.mode,
        query: args.query,
        modelQuery: args.modelQuery,
        queryAuthority: "runtime_user_message",
        searchHints: args.searchHints ?? [],
      },
      retrieval: {
        candidateFingerprint: args.candidateFingerprint,
        candidates: args.decisions.flatMap((decision) => {
          const candidate = candidateById.get(decision.candidateId);
          return candidate
            ? [projectCandidateForTrace(candidate, decision)]
            : [];
        }),
        decisions: args.decisions,
      },
      metadata: {
        source: "history_recall_tool",
        selector: "recall_first",
      },
    },
  });
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").trim();
}
