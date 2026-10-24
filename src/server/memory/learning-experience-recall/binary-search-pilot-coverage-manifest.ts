/**
 * Read-only audit manifest for the binary-search experience-card Pilot.
 *
 * Scope is deliberately two-stage:
 * - `substringCandidateUniverse` records every Problem whose serialized tags
 *   contain "binary-search" or "binary-search-tree" (17 problems).
 * - answer/eval card eligibility uses only `json_each(Problem.tags) =
 *   "binary-search"` (12 problems). BST-tag-only rows are scanned and recorded
 *   as false positives, never as binary-search cards.
 *
 * A bundle is one learner activity/review lineage, or a true repeated source
 * revision. Its component ReviewAttempt/RunEvidence/Diagnosis/History/Episode
 * rows are support for that one bundle, not separate cards.
 */

import { binarySearchLearningExperienceCards } from "./binary-search-pilot-cards";

export type BinarySearchCoverageDisposition =
  | "card"
  | "supporting_duplicate"
  | "insufficient"
  | "untrusted_eval_only"
  | "irrelevant_within_tag";

export type BinarySearchCoverageBundle = {
  id: string;
  problemSlug: string;
  exactBinarySearchTag: boolean;
  disposition: BinarySearchCoverageDisposition;
  cardIds?: string[];
  reviewIds?: string[];
  supportingRows?: string[];
  reason: string;
};

export const binarySearchPilotCoverageManifest = {
  generatedFrom: {
    database: "workspace-root dev.db",
    userId: "cmq798gwq0000pxcfautlf6qw",
    readonlySha256:
      "db3d2f0680e6aceb5958f580d7ff1e7dd15d5185abe76fe6d8be216be4e453c7",
    queryRule:
      "EXISTS (SELECT 1 FROM json_each(Problem.tags) WHERE value = 'binary-search')",
  },
  sourceRowCounts: {
    substringCandidateProblems: 17,
    exactBinarySearchProblems: 12,
    bstFalsePositiveProblems: 5,
    reviewAttempts: 65,
    runEvidence: 66,
    diagnosisResults: 65,
    problemHistoryRows: 65,
    memoryEpisodes: 95,
    l2Facts: 18,
    l1Events: 718,
    learnerActivityClusters: 17,
  },
  reviewConservation: {
    reviewsByProblem: {
      "search-insert-position": 48,
      "longest-increasing-subsequence": 4,
      "search-in-rotated-sorted-array": 3,
      sqrtx: 2,
      "count-complete-tree-nodes": 1,
      "find-first-and-last-position-of-element-in-sorted-array": 1,
      "find-minimum-in-rotated-sorted-array": 1,
      "find-peak-element": 1,
      "median-of-two-sorted-arrays": 1,
      "minimum-size-subarray-sum": 1,
      "search-a-2d-matrix": 1,
      "two-sum-ii-input-array-is-sorted": 1,
    },
    extraRunEvidence: {
      reviewId: "cmrkx80b500fzv6cftxtq2dhl",
      runEvidenceIds: [
        "cmrkx80b800g0v6cfm05z6nhx",
        "cmrkxcktq00jtv6cf94attej3",
      ],
      reason:
        "One LIS successful ReviewAttempt has two RunEvidence rows, so 65 reviews map to 66 runs.",
    },
  },
  bundles: [
    {
      id: "sqrtx:failed-last-candidate",
      problemSlug: "sqrtx",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:sqrtx:last-candidate-not-checked"],
      reviewIds: ["cmridf2t301avwvcfthykkqus"],
      supportingRows: [
        "learner_cluster:cms25ibch00vbilcfe4ka021v",
        "l1_attestation:cms18edwe0063b0cfrp2o1xqe",
        "run_evidence:cmridf2t501awwvcfx38ago8s",
        "diagnosis_result:cmridf2t801axwvcfhh3myro6",
        "problem_history:cmridf2ta01aywvcfm1c5olvj",
      ],
      reason:
        "Concrete historical failure and learner replay lineage exist, but original Review rows are legacy_unknown; evaluation-only.",
    },
    {
      id: "sqrtx:passed-recovery",
      problemSlug: "sqrtx",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:sqrtx-closed-interval-floor"],
      reviewIds: ["cmridgsem01bvwvcfkwzawdmh"],
      supportingRows: [
        "learner_cluster:cms25ihx600vnilcfcrzfu687",
        "l1_attestation:cms18edwl0066b0cfv0cjev92",
        "run_evidence:cmridgsen01bwwvcfwtj812ic",
      ],
      reason:
        "Specific successful code revision exists; original Review rows remain legacy_unknown, so evaluation-only.",
    },
    {
      id: "search-2d-matrix:two-stage-closed-interval",
      problemSlug: "search-a-2d-matrix",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: [
        "binary-search-pilot:search-2d-matrix-two-stage-closed-interval",
      ],
      reviewIds: ["cmqyi568u00l4fhcf1xo1yrdy"],
      supportingRows: [
        "learner_cluster:cms259g5m00cbilcfnac3cr5a",
        "l1_attestation:cms18edj1002ib0cfl18le26w",
        "run_evidence:cmqyi568y00l5fhcf1t1z07vx",
      ],
      reason:
        "Code snapshot plus lc_submit Accepted evidence is concrete; original Review row is legacy_unknown, so evaluation-only.",
    },
    {
      id: "median-two-arrays:partition-inequalities",
      problemSlug: "median-of-two-sorted-arrays",
      exactBinarySearchTag: true,
      disposition: "card",
      cardIds: ["binary-search-pilot:median-two-arrays-partition-inequalities"],
      reviewIds: ["cmrutwyxy00e7q9cfojwaf2gh"],
      supportingRows: [
        "learner_cluster:cmrutwyza00ehq9cfo6aublud",
        "run_evidence:cmrutwyy100e8q9cfd16l4kwa",
        "diagnosis_result:cmrutwyy300e9q9cfb0ar283i",
        "problem_history:cmrutwyy600eaq9cfkqre30mm",
      ],
      reason:
        "Learner-origin review has concrete partition code and two passing local visible examples; answer-eligible only with local-visible scope.",
    },
    {
      id: "rotated-search:pivot-preservation-failure",
      problemSlug: "search-in-rotated-sorted-array",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:rotated-search-excludes-pivot"],
      reviewIds: ["cmrib7b2v00jgwvcfldaerhx4"],
      reason:
        "Concrete right=mid-1 pivot exclusion failure; original rows are legacy_unknown.",
    },
    {
      id: "rotated-search:pivot-zero-empty-range",
      problemSlug: "search-in-rotated-sorted-array",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:rotated-search-pivot-zero-empty-interval"],
      reviewIds: ["cmrib9ckr00krwvcfbklyd3ah"],
      reason:
        "Concrete pivot=0 empty-range failure; original rows are legacy_unknown.",
    },
    {
      id: "rotated-search:pivot-zero-full-range-success",
      problemSlug: "search-in-rotated-sorted-array",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:rotated-search-pivot-zero-full-array"],
      reviewIds: ["cmribappm00lqwvcfufzyuml2"],
      supportingRows: ["learner_cluster:cms25hs9i00u2ilcfi18y12s5"],
      reason:
        "196/196 successful revision has explicit pivot=0 guard; source Review rows remain legacy_unknown.",
    },
    {
      id: "find-min-rotated:preserve-mid-success",
      problemSlug: "find-minimum-in-rotated-sorted-array",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:find-min-rotated-preserve-mid"],
      reviewIds: ["cmrl8xtdy00tiklcf0m57icc7"],
      supportingRows: ["learner_cluster:cms25krzz0104ilcf6a7gicgd"],
      reason:
        "Concrete right=mid candidate-preservation code and 150/150 pass; original rows legacy_unknown.",
    },
    {
      id: "lis:lower-bound-tails-success",
      problemSlug: "longest-increasing-subsequence",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:lis-lower-bound-tails"],
      reviewIds: ["cmrkx80b500fzv6cftxtq2dhl"],
      supportingRows: [
        "learner_cluster:cms25jgpq00xiilcfymjd17zb",
        "run_evidence:cmrkx80b800g0v6cfm05z6nhx",
        "run_evidence:cmrkxcktq00jtv6cf94attej3",
      ],
      reason:
        "Concrete half-open lower-bound code and 56/56 pass; original rows legacy_unknown.",
    },
    {
      id: "lis:debug-print-failures",
      problemSlug: "longest-increasing-subsequence",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      reviewIds: ["cmrkww94p006yv6cfahukcq0u", "cmrkx7gno00d4v6cfsied70nw"],
      reason:
        "Output-limit failures are real but peripheral to binary-search mechanism; retained as eval-only source coverage, no answer card.",
    },
    {
      id: "lis:second-success-supporting-duplicate",
      problemSlug: "longest-increasing-subsequence",
      exactBinarySearchTag: true,
      disposition: "supporting_duplicate",
      reviewIds: ["cmrkxd27c00n0v6cfo2p5ebqz"],
      supportingRows: ["run_evidence:cmrkxd27e00n1v6cfx2911i5x"],
      reason:
        "A second 56/56 lower-bound tails revision; supports the same mechanism without creating another card.",
    },
    {
      id: "find-peak:linear-walk-failure",
      problemSlug: "find-peak-element",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:find-peak-linear-walk"],
      reviewIds: ["cmrchvbkx00bwd1cfnpmuqpwi"],
      supportingRows: ["learner_cluster:cms25g7cj00qbilcf9ku7kn62"],
      reason:
        "Concrete non-halving walk and local sample failure; source is local-visible replay of legacy review.",
    },
    {
      id: "search-insert:hardcoded-zero-duplicate-cluster",
      problemSlug: "search-insert-position",
      exactBinarySearchTag: true,
      disposition: "supporting_duplicate",
      cardIds: ["binary-search-pilot:search-insert-hardcoded-zero"],
      reviewIds: ["cmqhj45d00012dncffh0jj99n"],
      supportingRows: [
        "46 ReviewAttempts with the identical 75-character `return 0` code snapshot; 45 failures each",
      ],
      reason:
        "One low-information eval-only representative; the other 45 identical source revisions are supporting duplicates, not cards.",
    },
    {
      id: "search-insert:closed-interval-success",
      problemSlug: "search-insert-position",
      exactBinarySearchTag: true,
      disposition: "untrusted_eval_only",
      cardIds: ["binary-search-pilot:search-insert-closed-interval-insertion"],
      reviewIds: ["cmqig0wbo00gpdncf1hgp1vkj"],
      reason:
        "Specific closed-interval code and 66/66 pass; original rows legacy_unknown.",
    },
    {
      id: "search-insert:hardcoded-zero-runner-error",
      problemSlug: "search-insert-position",
      exactBinarySearchTag: true,
      disposition: "insufficient",
      reviewIds: ["cmqifk3nu00aydncfz5rmbf2w"],
      reason:
        "The same fixed-return code has runner_error, so no behavior inference is eligible; listed to conserve all 48 Search Insert reviews.",
    },
    {
      id: "count-complete-tree-nodes:runner-unavailable",
      problemSlug: "count-complete-tree-nodes",
      exactBinarySearchTag: true,
      disposition: "insufficient",
      reviewIds: ["cmru4avj1009oxocf810q77lk"],
      reason:
        "Learner-origin review has runner_error and no behavior evidence; no card may be made.",
    },
    {
      id: "find-first-last:passed-without-teaching-chain",
      problemSlug: "find-first-and-last-position-of-element-in-sorted-array",
      exactBinarySearchTag: true,
      disposition: "insufficient",
      reviewIds: ["cmrjgsk1p00ry95cfve1p380d"],
      reason:
        "Code is concrete but source has no learner-owned lineage and no recovery/diagnostic teaching chain; kept as source coverage only.",
    },
    {
      id: "minimum-size-subarray:binary-search-tag-not-mechanism",
      problemSlug: "minimum-size-subarray-sum",
      exactBinarySearchTag: true,
      disposition: "irrelevant_within_tag",
      reviewIds: ["cmqifuffu00epdncfk365wnt7"],
      reason:
        "The reviewed mechanism is sliding-window, not binary search, despite the problem tag.",
    },
    {
      id: "two-sum-ii:binary-search-tag-not-mechanism",
      problemSlug: "two-sum-ii-input-array-is-sorted",
      exactBinarySearchTag: true,
      disposition: "irrelevant_within_tag",
      reviewIds: ["cmqzfllsh009ab3cfppo2lg0t"],
      reason:
        "The reviewed mechanism is two pointers, not binary search, despite the problem tag.",
    },
    ...[
      "binary-search-tree-iterator",
      "convert-sorted-array-to-binary-search-tree",
      "kth-smallest-element-in-a-bst",
      "minimum-absolute-difference-in-bst",
      "validate-binary-search-tree",
    ].map((problemSlug) => ({
      id: `${problemSlug}:bst-false-positive`,
      problemSlug,
      exactBinarySearchTag: false,
      disposition: "irrelevant_within_tag" as const,
      reason:
        "Scanned because serialized tag text contains binary-search-tree; exact JSON tag binary-search is absent.",
    })),
  ] satisfies BinarySearchCoverageBundle[],
  evaluationCandidates: [
    {
      id: "sqrtx-terminal-candidate",
      cardIds: ["binary-search-pilot:sqrtx:last-candidate-not-checked"],
      polarity: "negative",
      currentProblem: "Sqrt(x)",
      currentCodeMechanism:
        "closed interval with `while left < right`, which exits before checking the final candidate",
      goldCardId: "binary-search-pilot:sqrtx:last-candidate-not-checked",
    },
    {
      id: "matrix-two-stage-closed-interval",
      cardIds: [
        "binary-search-pilot:search-2d-matrix-two-stage-closed-interval",
      ],
      polarity: "positive",
      currentProblem: "Search a 2D Matrix",
      currentCodeMechanism:
        "two closed-interval searches with `left = mid + 1`/`right = mid - 1` and row selected by insertion position",
      goldCardId:
        "binary-search-pilot:search-2d-matrix-two-stage-closed-interval",
    },
    {
      id: "median-partition-inequalities",
      cardIds: ["binary-search-pilot:median-two-arrays-partition-inequalities"],
      polarity: "positive",
      currentProblem: "Median of Two Sorted Arrays",
      currentCodeMechanism:
        "binary-search a partition i and move based on `L1 > R2` / `L2 > R1`",
      goldCardId:
        "binary-search-pilot:median-two-arrays-partition-inequalities",
    },
    {
      id: "rotated-pivot-preservation",
      cardIds: ["binary-search-pilot:rotated-search-excludes-pivot"],
      polarity: "negative",
      currentProblem: "Search in Rotated Sorted Array",
      currentCodeMechanism:
        "pivot search uses `right = mid - 1` when `nums[mid] <= nums[right]`",
      goldCardId: "binary-search-pilot:rotated-search-excludes-pivot",
    },
    {
      id: "rotated-pivot-zero",
      cardIds: ["binary-search-pilot:rotated-search-pivot-zero-empty-interval"],
      polarity: "negative",
      currentProblem: "Search in Rotated Sorted Array",
      currentCodeMechanism:
        "pivot=0 branch uses `right = left - 1`, leaving an empty search interval",
      goldCardId:
        "binary-search-pilot:rotated-search-pivot-zero-empty-interval",
    },
    {
      id: "find-min-preserve-mid",
      cardIds: ["binary-search-pilot:find-min-rotated-preserve-mid"],
      polarity: "positive",
      currentProblem: "Find Minimum in Rotated Sorted Array",
      currentCodeMechanism:
        "when `nums[mid] <= nums[right]`, retain candidate using `right = mid`",
      goldCardId: "binary-search-pilot:find-min-rotated-preserve-mid",
    },
    {
      id: "lis-lower-bound",
      cardIds: ["binary-search-pilot:lis-lower-bound-tails"],
      polarity: "positive",
      currentProblem: "Longest Increasing Subsequence",
      currentCodeMechanism:
        "half-open lower bound finds first `tails[mid] >= target`",
      goldCardId: "binary-search-pilot:lis-lower-bound-tails",
    },
    {
      id: "find-peak-not-halving",
      cardIds: ["binary-search-pilot:find-peak-linear-walk"],
      polarity: "negative",
      currentProblem: "Find Peak Element",
      currentCodeMechanism:
        "walk index by one toward a larger neighbor rather than exclude a half",
      goldCardId: "binary-search-pilot:find-peak-linear-walk",
    },
    {
      id: "abstain-two-sum-two-pointers",
      cardIds: [],
      polarity: "none",
      currentProblem: "Two Sum II - Input Array Is Sorted",
      currentCodeMechanism: "two-pointer convergence, not binary search",
      goldCardId: undefined,
    },
    {
      id: "abstain-min-subarray-window",
      cardIds: [],
      polarity: "none",
      currentProblem: "Minimum Size Subarray Sum",
      currentCodeMechanism: "sliding-window shrink loop, not binary search",
      goldCardId: undefined,
    },
    {
      id: "abstain-runner-unavailable",
      cardIds: [],
      polarity: "none",
      currentProblem: "Count Complete Tree Nodes",
      currentCodeMechanism: "no aligned execution evidence available",
      goldCardId: undefined,
    },
  ],
  cardCount: binarySearchLearningExperienceCards.length,
} as const;
