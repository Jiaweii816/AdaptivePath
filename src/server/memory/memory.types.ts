import { z } from "zod";

export const evidenceKindSchema = z.enum([
  "reinforce",
  "weaken",
  "resolve",
  "contradict",
  "preference_set",
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const factCandidateSchema = z.object({
  factType: z.string().trim().min(1),
  tag: z.string().trim().min(1),
  value: z.string().trim().min(1),
  evidenceKind: evidenceKindSchema,
  observedBehavior: z.string().trim().min(1),
  evidenceTraceIds: z.array(z.string().trim().min(1)).min(1),
});
export type FactCandidate = z.infer<typeof factCandidateSchema>;

export const episodeOutcomeSchema = z.enum([
  "passed",
  "failed",
  "resolved",
  "unresolved",
  "abandoned",
]);
export type EpisodeOutcome = z.infer<typeof episodeOutcomeSchema>;

export const episodeSummarySchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(600),
  outcome: episodeOutcomeSchema,
  tags: z.array(z.string()).default([]),
  salience: z.number().min(0).max(1).default(0.5),
});

export const consolidationOutputSchema = z.object({
  episodeSummary: episodeSummarySchema,
  factCandidates: z.array(factCandidateSchema).default([]),
  strategySignals: z
    .array(
      z.object({
        tag: z.string(),
        observation: z.string(),
        polarity: z.enum(["positive", "negative"]),
        userSelfCorrected: z.boolean().optional(),
      }),
    )
    .default([]),
  strategiesApplied: z
    .array(
      z.object({
        strategyTag: z.string(),
        appliedAssistantMessageId: z.string(),
      }),
    )
    .default([]),
  newRollingSummary: z.string().trim().min(1).max(1200),
});
export type ConsolidationOutput = z.infer<typeof consolidationOutputSchema>;

export type FactStatus =
  "active" | "improving" | "resolved" | "stale" | "contradicted";

// Arbitration: opcode chooses the direction, constants choose the magnitude.
export const ARBITRATION_DELTAS = { reinforce: 0.08, weaken: 0.12 } as const;
export const CONTRADICTED_REBUILD_BASE = 0.3;
export const NEW_FACT_BASE_CONFIDENCE = 0.5;
export const PREFERENCE_SET_CONFIDENCE = 0.9;

// Consolidation triggers.
export const CHAT_CONSOLIDATION_TURN_THRESHOLD = 6;
export const CONSOLIDATION_DEBOUNCE_TURNS = 2;
export const SALIENCE_HINT_LEVEL = 2;

// Working memory / retrieval budget. Phase 1 uses rough character budgeting.
export const WORKING_MEMORY_VERBATIM_TURNS = 8;
export const MEMORY_CONTEXT_CHAR_BUDGET = 2800;

export const TAG_ALIASES: Record<string, string> = {
  "binary-search": "binary_search",
  binarysearch: "binary_search",
  binary_search: "binary_search",
  "off-by-one": "off_by_one",
  off_by_one: "off_by_one",
  "hash-map": "hash_map",
  hashmap: "hash_map",
  hash_map: "hash_map",
  "two-pointers": "two_pointers",
  two_pointers: "two_pointers",
  "sliding-window": "sliding_window",
  sliding_window: "sliding_window",
  "dynamic-programming": "dynamic_programming",
  dynamic_programming: "dynamic_programming",
};

export function normalizeMemoryTag(tag: string): string {
  const normalized = tag.trim().toLowerCase().replace(/\s+/g, "_");
  const dashed = normalized.replace(/_/g, "-");
  return (
    TAG_ALIASES[dashed] ??
    TAG_ALIASES[normalized] ??
    normalized.replace(/-/g, "_")
  );
}

export const SYNTHESIS_SLOTS = [
  "weakness_patterns",
  "strengths",
  "teaching_strategy",
  "practice_plan",
  "recent_overview",
] as const;
export type SynthesisSlotName = (typeof SYNTHESIS_SLOTS)[number];

export const slotUpsertSchema = z.object({
  slot: z.enum(SYNTHESIS_SLOTS),
  synthesisKey: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(400),
  evidenceFactIds: z.array(z.string().trim().min(1)).min(1),
  confidence: z.number().min(0).max(1).default(0.5),
  status: z.enum(["active", "stale", "resolved"]).default("active"),
});
export type SlotUpsert = z.infer<typeof slotUpsertSchema>;

export const strategyObservableSchema = z.enum([
  "reviewTransition",
  "repeatMistakeRate",
  "hintEscalation",
  "selfCorrection",
]);

export const strategyProposalSchema = z.object({
  tag: z.string().trim().min(1),
  hypothesis: z.string().trim().min(1).max(300),
  expectedObservable: strategyObservableSchema,
  evidenceTraceIds: z.array(z.string().trim().min(1)).min(1),
});
export type StrategyProposal = z.infer<typeof strategyProposalSchema>;

export const reflectionOutputSchema = z.object({
  slotUpserts: z.array(slotUpsertSchema).default([]),
  strategyProposals: z.array(strategyProposalSchema).default([]),
  factAudits: z.array(factCandidateSchema).default([]),
});
export type ReflectionOutput = z.infer<typeof reflectionOutputSchema>;

export type StrategyStatus = "candidate" | "validated" | "demoted";
export const STRATEGY_CANDIDATE_CONFIDENCE = 0.4;
export const STRATEGY_VALIDATION_MIN_APPLIES = 2;
export const ACTIVE_STRATEGY_CAP = 5;
export const STRATEGY_TRIAL_MAX_PLANNED = 3;

export type StrategyValidation = {
  applied: number;
  positive: number;
  negative: number;
  deterministicPositive: number;
};

export const EMPTY_STRATEGY_VALIDATION: StrategyValidation = {
  applied: 0,
  positive: 0,
  negative: 0,
  deterministicPositive: 0,
};

export function decideStrategyTransition(args: {
  status: string;
  validation: StrategyValidation;
}): StrategyStatus {
  const { applied, positive, negative, deterministicPositive } =
    args.validation;

  if (applied >= STRATEGY_VALIDATION_MIN_APPLIES && positive === 0) {
    return "demoted";
  }
  if (applied > 0 && negative >= positive && negative > 0) {
    return "demoted";
  }
  if (
    applied >= STRATEGY_VALIDATION_MIN_APPLIES &&
    positive >= 2 &&
    positive > negative &&
    deterministicPositive >= 1
  ) {
    return "validated";
  }

  return args.status === "demoted" ? "demoted" : "candidate";
}

export function parseStrategyValidation(
  value: string | null | undefined,
): StrategyValidation {
  if (!value) {
    return { ...EMPTY_STRATEGY_VALIDATION };
  }

  try {
    const parsed = JSON.parse(value) as Partial<StrategyValidation>;
    return {
      applied: parsed.applied ?? 0,
      positive: parsed.positive ?? 0,
      negative: parsed.negative ?? 0,
      deterministicPositive: parsed.deterministicPositive ?? 0,
    };
  } catch {
    return { ...EMPTY_STRATEGY_VALIDATION };
  }
}

export const sessionPlanSchema = z.object({
  candidateFingerprint: z.string().min(8),
  focusCues: z
    .array(
      z.object({
        candidateRef: z.string(),
        cue: z.string(),
        sourceLabel: z.string(),
        learnerSignalBasis: z.enum([
          "earned_evidence",
          "self_reported",
          "saved_by_learner",
        ]),
      }),
    )
    .max(2),
  strategies: z
    .array(
      z.object({
        tag: z.string(),
        text: z.string(),
        status: z.enum(["validated", "candidate"]),
        candidateRef: z.string().optional(),
      }),
    )
    .max(3),
  openingMove: z.object({
    text: z.string().min(1),
    candidateRefs: z.array(z.string()).max(2),
  }),
  builtAt: z.string(),
});
export type SessionPlan = z.infer<typeof sessionPlanSchema>;
