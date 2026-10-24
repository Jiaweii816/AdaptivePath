import type { ReviewDatasetCase, ReviewEvidenceMarker } from "./review-dataset";

export type ReviewRunForScoring = {
  caseId: string;
  repeatIndex: number;
  bugCategory: string;
  predictedTags: string[];
  goldenTags: string[];
  coachReply: string;
};

export type PrecisionRecallF1 = {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
};

export type ReviewCaseScore = {
  caseId: string;
  repeatIndex: number;
  bugCategory: string;
  rawPredictedTags: string[];
  predictedTags: string[];
  goldenTags: string[];
  precision: number | null;
  recall: number | null;
  f1: number | null;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  evidenceGrounded: boolean;
  matchedEvidenceMarkers: string[];
};

export type ReviewSuiteScore = {
  scoredRunCount: number;
  micro: PrecisionRecallF1;
  perBugCategory: Array<
    PrecisionRecallF1 & {
      bugCategory: string;
      runCount: number;
    }
  >;
  evidenceGrounded: {
    groundedCount: number;
    total: number;
    rate: number | null;
  };
  cases: ReviewCaseScore[];
};

export function normalizeReviewTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

export function canonicalizeReviewTags(args: {
  tags: string[];
  bugCategory: string;
}): string[] {
  const aliases = REVIEW_TAG_ALIASES_BY_BUG_CATEGORY[args.bugCategory] ?? {};

  return normalizeReviewTags(
    args.tags.map((tag) => {
      const normalized = tag.trim();
      return aliases[normalized] ?? normalized;
    }),
  );
}

export function computeReviewSuiteScore(args: {
  runs: ReviewRunForScoring[];
  cases: ReviewDatasetCase[];
}): ReviewSuiteScore {
  const casesById = new Map(args.cases.map((reviewCase) => [reviewCase.caseId, reviewCase]));
  const caseScores: ReviewCaseScore[] = args.runs.map((run) => {
    const reviewCase = casesById.get(run.caseId);
    if (!reviewCase) {
      throw new Error(`Cannot score unknown review case ${run.caseId}.`);
    }

    const rawPredictedTags = normalizeReviewTags(run.predictedTags);
    const predictedTags = canonicalizeReviewTags({
      tags: run.predictedTags,
      bugCategory: run.bugCategory,
    });
    const goldenTags = canonicalizeReviewTags({
      tags: run.goldenTags,
      bugCategory: run.bugCategory,
    });
    const counts = countTagMatches(predictedTags, goldenTags);
    const matchedEvidenceMarkers = findMatchedEvidenceMarkers(
      run.coachReply,
      reviewCase.expectedEvidenceMarkers,
    );

    return {
      caseId: run.caseId,
      repeatIndex: run.repeatIndex,
      bugCategory: run.bugCategory,
      rawPredictedTags,
      predictedTags,
      goldenTags,
      ...toPrecisionRecallF1(counts),
      evidenceGrounded: matchedEvidenceMarkers.length > 0,
      matchedEvidenceMarkers,
    };
  });

  const microCounts = caseScores.reduce(
    (counts, item) => ({
      truePositives: counts.truePositives + item.truePositives,
      falsePositives: counts.falsePositives + item.falsePositives,
      falseNegatives: counts.falseNegatives + item.falseNegatives,
    }),
    { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
  );
  const perBugCategory = [...groupByCategory(caseScores).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bugCategory, scores]) => {
      const counts = scores.reduce(
        (sum, item) => ({
          truePositives: sum.truePositives + item.truePositives,
          falsePositives: sum.falsePositives + item.falsePositives,
          falseNegatives: sum.falseNegatives + item.falseNegatives,
        }),
        { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
      );

      return {
        bugCategory,
        runCount: scores.length,
        ...toPrecisionRecallF1(counts),
      };
    });
  const groundedCount = caseScores.filter((item) => item.evidenceGrounded).length;

  return {
    scoredRunCount: caseScores.length,
    micro: toPrecisionRecallF1(microCounts),
    perBugCategory,
    evidenceGrounded: {
      groundedCount,
      total: caseScores.length,
      rate: rate(groundedCount, caseScores.length),
    },
    cases: caseScores.sort(
      (left, right) =>
        left.caseId.localeCompare(right.caseId) ||
        left.repeatIndex - right.repeatIndex,
    ),
  };
}

export function findMatchedEvidenceMarkers(
  coachReply: string,
  markers: ReviewEvidenceMarker[],
): string[] {
  return markers
    .filter((marker) => markerMatches(coachReply, marker))
    .map((marker) => marker.label);
}

export function evidenceMarkerMatchesReply(
  coachReply: string,
  marker: ReviewEvidenceMarker,
): boolean {
  return markerMatches(coachReply, marker);
}

function markerMatches(coachReply: string, marker: ReviewEvidenceMarker) {
  if (marker.match === "compact_substring") {
    return compact(coachReply).includes(compact(marker.value));
  }

  return coachReply.toLowerCase().includes(marker.value.toLowerCase());
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function countTagMatches(predictedTags: string[], goldenTags: string[]) {
  const predicted = new Set(normalizeReviewTags(predictedTags));
  const golden = new Set(normalizeReviewTags(goldenTags));
  let truePositives = 0;

  for (const tag of predicted) {
    if (golden.has(tag)) {
      truePositives += 1;
    }
  }

  return {
    truePositives,
    falsePositives: predicted.size - truePositives,
    falseNegatives: golden.size - truePositives,
  };
}

function toPrecisionRecallF1(counts: {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}): PrecisionRecallF1 {
  const precision = rate(
    counts.truePositives,
    counts.truePositives + counts.falsePositives,
  );
  const recall = rate(
    counts.truePositives,
    counts.truePositives + counts.falseNegatives,
  );
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : precision === null && recall === null
        ? null
        : 0;

  return {
    ...counts,
    precision,
    recall,
    f1,
  };
}

function groupByCategory(caseScores: ReviewCaseScore[]) {
  const grouped = new Map<string, ReviewCaseScore[]>();

  for (const score of caseScores) {
    const current = grouped.get(score.bugCategory) ?? [];
    current.push(score);
    grouped.set(score.bugCategory, current);
  }

  return grouped;
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

const REVIEW_TAG_ALIASES_BY_BUG_CATEGORY: Record<string, Record<string, string>> = {
  missing_search_logic: {
    hardcoded_return: "hardcoded_answer",
    no_search_logic: "missing_search_logic",
  },
  binary_search_return_off_by_one: {
    binary_search_return: "binary_search_return_off_by_one",
    off_by_one: "binary_search_return_off_by_one",
    off_by_one_boundary: "binary_search_return_off_by_one",
  },
  sliding_window_state_regression: {
    duplicate_outside_window: "stale_duplicate_boundary",
    sliding_window_boundary_error: "sliding_window_boundary",
    sliding_window_left_misupdate: "sliding_window_boundary",
  },
  state_update_order_error: {
    check_before_store_error: "state_update_order_error",
    premature_update: "state_update_order_error",
    late_update: "state_update_order_error",
    same_element_reuse: "state_update_order_error",
    state_update_order: "state_update_order_error",
    write_pointer_update_order: "state_update_order_error",
  },
  binary_search_boundary_invariant_error: {
    binary_search_return: "binary_search_boundary_invariant_error",
    binary_search_return_off_by_one: "binary_search_boundary_invariant_error",
    binary_search_return_left_plus_one: "binary_search_boundary_invariant_error",
    binary_search_loop_invariant: "binary_search_boundary_invariant_error",
    first_ge_invariant_confusion: "binary_search_boundary_invariant_error",
    insertion_point_boundary: "binary_search_boundary_invariant_error",
    off_by_one: "binary_search_boundary_invariant_error",
    off_by_one_boundary: "binary_search_boundary_invariant_error",
    search_boundary_update_error: "binary_search_boundary_invariant_error",
  },
  sliding_window_boundary_error: {
    duplicate_outside_window: "sliding_window_boundary_error",
    left_pointer_regression: "sliding_window_boundary_error",
    shrink_condition_confusion: "sliding_window_boundary_error",
    sliding_window_boundary: "sliding_window_boundary_error",
    sliding_window_left_boundary_regression: "sliding_window_boundary_error",
    sliding_window_left_misupdate: "sliding_window_boundary_error",
    sliding_window_shrink_condition: "sliding_window_boundary_error",
    sliding_window_shrink_condition_error: "sliding_window_boundary_error",
    stale_duplicate_boundary: "sliding_window_boundary_error",
    window_validity_error: "sliding_window_boundary_error",
  },
  duplicate_or_frequency_count_error: {
    duplicate_case_missed: "duplicate_or_frequency_count_error",
    duplicate_handling_error: "duplicate_or_frequency_count_error",
    duplicate_or_frequency_error: "duplicate_or_frequency_count_error",
    frequency_count_error: "duplicate_or_frequency_count_error",
    frequency_mismatch: "duplicate_or_frequency_count_error",
    missing_reverse_mapping: "duplicate_or_frequency_count_error",
    uses_set_when_count_needed: "duplicate_or_frequency_count_error",
  },
  boundary_condition_error: {
    edge_case_missing: "boundary_condition_error",
    empty_input_error: "boundary_condition_error",
    first_last_case_error: "boundary_condition_error",
    missing_final_segment: "boundary_condition_error",
    single_element_case: "boundary_condition_error",
    single_row_or_column_error: "boundary_condition_error",
  },
  dp_transition_error: {
    dp_initialization_error: "dp_transition_error",
    loop_order_error: "dp_transition_error",
    min_max_aggregation_error: "dp_transition_error",
    recurrence_error: "dp_transition_error",
    wrong_recurrence: "dp_transition_error",
    wrong_transition: "dp_transition_error",
  },
};
