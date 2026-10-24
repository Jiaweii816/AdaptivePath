export const LEARNING_EXPERIENCE_CARD_KIND =
  "learning_experience_card" as const;

export type LearningExperiencePolarity = "negative" | "positive";

/**
 * A rebuildable retrieval projection, not a replacement for L1/L2/Episode
 * source records.  The Pilot keeps this intentionally small and explicit.
 */
export type LearningExperienceCard = {
  id: string;
  learnerId: string;
  algorithmTag: string;
  polarity: LearningExperiencePolarity;
  /**
   * Untrusted/legacy cards stay searchable for offline ranking analysis but
   * are never selected into a learner-facing Tool result.
   */
  answerEligible?: boolean;
  evalOnly?: boolean;
  experienceText: string;
  provenance: {
    sourceProblem: string;
    evidenceRefs: string[];
  };
};

export type LearningExperienceCardResult = {
  sourceProblem: string;
  experienceText: string;
  evidenceRefs: string[];
};

export type LearningExperienceRetrievalStatus =
  | "full"
  | "empty"
  | "algorithm_tag_unavailable"
  | "vector_unavailable"
  | "partial_failure";

export type LearningExperienceLaneTrace = {
  polarity: LearningExperiencePolarity;
  vectorQuery?: string;
  ftsCandidateIds: string[];
  vectorCandidateIds: Array<{ id: string; distance: number }>;
  /** Full same-lane ranking, retained for isolated Pilot evaluation only. */
  rankedCandidates: Array<{
    id: string;
    distance: number;
    ftsMatched: boolean;
    answerEligible: boolean;
  }>;
  eligibleIds: string[];
  selectedId?: string;
};

export type LearningExperienceRecall = {
  algorithmTag?: string;
  status: LearningExperienceRetrievalStatus;
  negative?: LearningExperienceCardResult;
  positive?: LearningExperienceCardResult;
  trace: {
    ftsQuery?: string;
    failurePattern?: string;
    successPattern?: string;
    lanes: LearningExperienceLaneTrace[];
    errors: string[];
  };
};
