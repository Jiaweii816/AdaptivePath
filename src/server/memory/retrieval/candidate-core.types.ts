export type AutomaticMemoryIntent =
  | "review"
  | "concept_question"
  | "hint_request"
  | "anxiety_or_stuck"
  | "run_case_request"
  | "execute_failed_ask"
  | "debug_followup"
  | "optimization_request"
  | "full_code_request"
  | "practice_request"
  | "api_reference_question"
  | "past_problem_recall_request"
  | "past_mistake_recall_request"
  | "profile_meta_question"
  | "general_followup";

export type CandidateSource =
  | "l2_fact"
  | "onboarding_profile"
  | "synthesis"
  | "episode"
  | "problem_history"
  | "knowledge_note"
  | "mistake_book"
  | "domain_kb";

export type CandidateTruthClass =
  | "learner_state"
  | "self_reported_profile"
  | "historical_evidence"
  | "study_artifact"
  | "domain_reference";

export type TeachableMemoryKind =
  | "successful_transfer"
  | "recurring_mistake"
  | "saved_knowledge"
  | "saved_mistake_guide"
  | "learning_preference";

export type MemoryCandidateRole = TeachableMemoryKind | "domain_reference";

export type HistoryRecallFacet = "past_problem" | "past_mistake";

export type MemoryApplicability =
  | "exact_pattern"
  | "related_pattern"
  | "teaching_style_only";

export type ConceptOrigin =
  | "user_text"
  | "current_mechanism"
  | "code_structure"
  | "none";

export type QueryTermOrigin =
  | "user_concept"
  | "problem_metadata"
  | "problem_concept"
  | "current_mechanism"
  | "code_structure"
  | "taxonomy_expansion"
  | "search_hint"
  | "intent_facet"
  | "question_mechanism"
  | "model_query";

export type RetrievalQueryTerm = {
  value: string;
  origin: QueryTermOrigin;
};

export type SourceBudget = {
  candidateLimit: number;
  selectionPriority: "primary" | "supporting";
  reservedRoleSlots?: Partial<Record<MemoryCandidateRole, number>>;
};

export type MistakeRecallBasis =
  | { kind: "durable_negative_claim"; evidenceTraceIds: string[] }
  | { kind: "accepted_negative_observation"; observationIds: string[] }
  | { kind: "learner_confirmed_artifact"; entryId: string }
  | {
      kind: "validated_negative_synthesis";
      supportingFactIds: string[];
      evidenceTraceIds: string[];
    };

export type RetrievalQueryPlan = {
  mode: "automatic_personalization";
  path: "review" | "chat";
  intent: AutomaticMemoryIntent;
  userText: string;
  /** Natural-language query used for semantic recall, including active-problem context. */
  semanticQuery: string;
  semanticQueryPlan: {
    learnerRequest?: string;
    problemContext?: string;
  };
  /** Stable receipt for the open-world active-problem context used in semantic recall. */
  activeProblemSemanticFingerprint: {
    value: string;
    text: string;
    sourceTerms: string[];
  };
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber?: number;
  };
  searchHints: string[];
  modelQuery?: string;
  requiredFacet?: HistoryRecallFacet;
  /** Canonical Hot-150 mechanism keys implied by the active problem's tags. */
  canonicalMechanisms: string[];
  concepts: {
    candidate: Array<{ tag: string; tier: "concept" | "generic" }>;
    active: string[];
    activeOrigin: ConceptOrigin;
    droppedTags: string[];
  };
  queryTerms: RetrievalQueryTerm[];
  currentSignal?: {
    mechanism?: string;
    stuckLayer?: string;
    failedCaseSummary?: string;
  };
  language: "Python";
  selectionThreshold: "normal" | "raised";
  sourcePolicy: Partial<Record<CandidateSource, SourceBudget>>;
};

export type MemoryCandidate = {
  id: string;
  source: CandidateSource;
  truthClass: CandidateTruthClass;
  role: MemoryCandidateRole;
  /** Explicit-history views supported by a historical candidate. */
  historyFacets?: HistoryRecallFacet[];
  mistakeRecallBasis?: MistakeRecallBasis;
  title: string;
  /** Human-readable teaching text. A raw tag is not valid teaching text. */
  teachingText: string;
  concepts: string[];
  sourceProblem?: { slug: string; title: string };
  outcome?: string;
  confidence?: number;
  status?: string;
  saveCount?: number;
  historyProvenance?: {
    executionAuthority: "official" | "local_visible" | "mixed" | "not_applicable" | "unknown";
    resolutionStatus: "active" | "improving" | "resolved" | "unknown";
  };
  evidenceRefs: string[];
  updatedAt?: Date;
  retrievalSignals: {
    lexicalRank?: number;
    vectorRank?: number;
    /** Deterministic relevance tier. Selection eligibility depends on this, not on recall membership. */
    matchTier: "mechanism" | "concept" | "lexical_only" | "none";
    /** Cosine distance of the accepted vector hit, when one exists. Ranking input only. */
    vectorDistance?: number;
    conceptMatch: "active" | "candidate" | "generic" | "none";
    mechanismMatch: boolean;
    intentFit: number;
  };
};

export type TeachableMemory = {
  kind: TeachableMemoryKind;
  cue: string;
  sourceLabel: string;
  /** Distinguishes learner claims from earned evidence and learner-saved notes. */
  learnerSignalBasis: "earned_evidence" | "self_reported" | "saved_by_learner";
  /** How strongly this memory may influence the reply. teaching_style_only must never drive code diagnosis. */
  applicability: MemoryApplicability;
  /** Trace-only explanation; prompt projection must omit it. */
  whyRelevant: string;
  evidenceRefs: string[];
};

export type CompactReference = {
  title: string;
  content: string;
  sourceLabel: string;
};

export type CoachMemoryBrief = {
  profileId: string;
  teachableMemories: TeachableMemory[];
  outputPreferences: string[];
  teachingStrategy?: string;
  domainReferences: CompactReference[];
  retrievalStatus:
    | "full"
    | "lexical_only"
    | "partial_failure"
    | "failed"
    /** Chat-only opt-in Pilot bypass; never represents a successful recall. */
    | "disabled";
};

export type CandidateSelectionDecision = {
  candidateId: string;
  selected: boolean;
  reason: string;
};

export type AutomaticMemorySelection = {
  brief: CoachMemoryBrief;
  decisions: CandidateSelectionDecision[];
};
