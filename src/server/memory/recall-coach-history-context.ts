import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  appendTraceEventBestEffort,
  startTraceStep,
} from "@/server/llm/trace-context";
import type { MemoryOrigin } from "./memory-origin";
import { buildRetrievalQueryPlan } from "./retrieval/build-retrieval-query-plan";
import { retrieveCoachMemoryCandidates } from "./retrieval/retrieve-coach-memory";
import { attachHistoryProvenance } from "./retrieval/history-provenance";
import {
  selectHistoryRecall,
  type HistoryRecallMode,
} from "./retrieval/select-history-recall";
import type { FtsStore } from "./store/fts-store";

export type RetrievalProblemContext = {
  id: string;
  slug: string;
  title: string;
  leetcodeNumber?: number;
  tags: string[];
};

/** Shared, auditable explicit-history read boundary for Chat tools and MCP. */
export async function recallCoachHistoryContext(args: {
  prisma: PrismaClient;
  userId: string;
  memoryOrigin: MemoryOrigin;
  mode: HistoryRecallMode;
  userText: string;
  modelQuery: string;
  searchHints?: string[];
  activeProblem: RetrievalProblemContext;
  ftsStore?: FtsStore;
  vectorMode?: "auto" | "disabled";
  traceContext?: TraceContext;
}) {
  const intent =
    args.mode === "past_mistake_recall"
      ? "past_mistake_recall_request"
      : "past_problem_recall_request";
  const plan = buildRetrievalQueryPlan({
    path: "chat",
    intent,
    userText: args.userText,
    modelQuery: args.modelQuery,
    searchHints: args.searchHints,
    requiredFacet: args.mode === "past_mistake_recall" ? "past_mistake" : "past_problem",
    problem: args.activeProblem,
  });
  // Durable learner memory is deliberately never consumed from an isolated
  // development/test origin. Tests requiring it use an isolated DB plus an
  // explicit learner origin, never the live learner database.
  if (args.memoryOrigin !== "learner") {
    return {
      queryPlan: plan,
      candidates: [],
      items: [],
      decisions: [],
      candidateFingerprint: fingerprint([]),
      retrievalStatus: "lexical_only" as const,
    };
  }
  const retrieved = await retrieveCoachMemoryCandidates(args.prisma, {
    userId: args.userId,
    memoryOrigin: args.memoryOrigin,
    plan,
    ftsStore: args.ftsStore,
    vectorMode: args.vectorMode,
  });
  const candidates = await attachHistoryProvenance(args.prisma, {
    userId: args.userId,
    memoryOrigin: args.memoryOrigin,
    candidates: retrieved.candidates,
  });
  const selected = selectHistoryRecall({
    mode: args.mode,
    query: args.userText,
    searchHints: args.searchHints,
    queryPlan: plan,
    candidates,
    limit: 8,
  });
  const candidateFingerprint = fingerprint(candidates);
  await traceRecall(args.traceContext, {
    mode: args.mode,
    candidateFingerprint,
    candidateCount: candidates.length,
    decisions: selected.decisions,
    retrievalStatus: retrieved.retrievalStatus,
  });
  return {
    queryPlan: plan,
    candidates,
    items: selected.items,
    decisions: selected.decisions,
    candidateFingerprint,
    retrievalStatus: retrieved.retrievalStatus,
  };
}

function fingerprint(candidates: Array<{ id: string; source: string; historyFacets?: string[] }>) {
  return createHash("sha256")
    .update(JSON.stringify(candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      facets: candidate.historyFacets ?? [],
    })).sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex")
    .slice(0, 16);
}

async function traceRecall(
  traceContext: TraceContext | undefined,
  data: {
    mode: HistoryRecallMode;
    candidateFingerprint: string;
    candidateCount: number;
    decisions: Array<{ candidateId: string; selected: boolean; reason: string }>;
    retrievalStatus: string;
  },
) {
  if (!traceContext) return;
  await appendTraceEventBestEffort(traceContext, {
    step: startTraceStep(traceContext, { spanKind: "retrieval" }),
    stage: "context_memory",
    kind: "retrieval",
    title: "History recall retrieval",
    status: data.retrievalStatus === "failed" ? "failed" : "succeeded",
    details: {
      retrieval: { ...data, preHydrationPoolLimit: 80 },
      metadata: { source: "recall_coach_history_context" },
    },
  });
}
