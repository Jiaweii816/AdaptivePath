import type {
  AutomaticMemoryIntent,
  CandidateSource,
} from "./candidate-core.types";

export type RetrievalProfileId =
  | "review_debug"
  | "concept_chat"
  | "stuck_chat"
  | "history_or_practice";

export type RetrievalProfile = {
  id: RetrievalProfileId;
  objective: string;
  primarySources: CandidateSource[];
  /** Candidate-generation budgets, never fact-type eligibility filters. */
  budgets: { episodes: number; facts: number; kb: number };
};

export const RETRIEVAL_PROFILES: Record<RetrievalProfileId, RetrievalProfile> = {
  review_debug: {
    id: "review_debug",
    objective: "Explain one current blocker using aligned historical mechanisms.",
    primarySources: ["l2_fact", "episode"],
    budgets: { episodes: 8, facts: 8, kb: 4 },
  },
  concept_chat: {
    id: "concept_chat",
    objective: "Teach the requested concept with minimal learner adaptation.",
    primarySources: ["domain_kb", "episode"],
    budgets: { episodes: 8, facts: 8, kb: 4 },
  },
  stuck_chat: {
    id: "stuck_chat",
    objective: "Transfer a demonstrated success or one relevant hint.",
    primarySources: ["episode", "l2_fact", "domain_kb"],
    budgets: { episodes: 8, facts: 8, kb: 4 },
  },
  history_or_practice: {
    id: "history_or_practice",
    objective: "Recall learner history broadly before ranking for the request.",
    primarySources: ["problem_history", "episode", "l2_fact", "mistake_book"],
    budgets: { episodes: 8, facts: 8, kb: 0 },
  },
};

const CHAT_INTENT_TO_PROFILE: Partial<
  Record<AutomaticMemoryIntent | string, RetrievalProfileId>
> = {
  execute_failed_ask: "review_debug",
  debug_followup: "review_debug",
  run_case_request: "review_debug",
  optimization_request: "review_debug",
  concept_question: "concept_chat",
  api_reference_question: "concept_chat",
  full_code_request: "concept_chat",
  general_followup: "concept_chat",
  profile_meta_question: "concept_chat",
  anxiety_or_stuck: "stuck_chat",
  hint_request: "stuck_chat",
  practice_request: "history_or_practice",
  past_problem_recall_request: "history_or_practice",
  past_mistake_recall_request: "history_or_practice",
};

export type RetrievalEntry =
  | { kind: "review" }
  | { kind: "kickoff" }
  | { kind: "chat"; intent: string }
  | { kind: "recall_tool" };

export function resolveRetrievalProfile(entry: RetrievalEntry) {
  if (entry.kind === "review" || entry.kind === "kickoff") {
    return RETRIEVAL_PROFILES.review_debug;
  }
  if (entry.kind === "recall_tool") {
    return RETRIEVAL_PROFILES.history_or_practice;
  }
  return RETRIEVAL_PROFILES[
    CHAT_INTENT_TO_PROFILE[entry.intent] ?? "concept_chat"
  ];
}

export function primarySourcesForIntent(intent: AutomaticMemoryIntent) {
  if (intent === "review") {
    return new Set(RETRIEVAL_PROFILES.review_debug.primarySources);
  }
  if (intent === "profile_meta_question") {
    return new Set<CandidateSource>([
      "onboarding_profile",
      "l2_fact",
      "synthesis",
    ]);
  }
  return new Set(resolveRetrievalProfile({ kind: "chat", intent }).primarySources);
}
