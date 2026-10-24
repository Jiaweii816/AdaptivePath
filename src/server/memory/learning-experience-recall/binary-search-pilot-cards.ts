/**
 * Read-only, hand-audited pilot projection from Iris904's `dev.db`.
 *
 * This is fixture data, not a Prisma model and not a write path. It directly
 * satisfies the Pilot retrieval contract, while the separate audit fields
 * preserve richer provenance for human review.
 * `algorithmTag` is the pilot-normalized spelling; `sourceAlgorithmTag` preserves
 * the exact existing Problem tag (`binary-search`).
 */

export type BinarySearchPilotEvidenceRef = {
  kind:
    | "l2_fact"
    | "l1_attestation"
    | "review_attempt"
    | "run_evidence"
    | "diagnosis_result"
    | "problem_history";
  id: string;
};

import type { LearningExperienceCard } from "./contracts";

export type BinarySearchLearningExperienceCard = LearningExperienceCard & {
  /** Only answerEligible cards may reach the Coach-facing recall result. */
  eligibility: "answerEligible" | "evalOnly";
  algorithmTag: "binary_search";
  provenance: LearningExperienceCard["provenance"] & {
    sourceAlgorithmTag: "binary-search";
  };
  /** How strong the teaching wording may be; it is not a retrieval score. */
  teachingEvidence: {
    sourceQuality:
      "official_judge_review" | "local_visible_review" | "legacy_unknown";
    resultScope: "official_judge" | "review_execution_evidence" | "mixed";
    limitations: string[];
  };
  auditEvidenceRefs: BinarySearchPilotEvidenceRef[];
};

/**
 * Cards eligible for the two retrieval lanes.  Each statement is bounded to the
 * referenced source text; no card says a visible test is an official acceptance.
 */
const cards: BinarySearchLearningExperienceCard[] = [
  {
    id: "binary-search-pilot:sqrtx:last-candidate-not-checked",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "negative",
    experienceText:
      "在 Sqrt(x) 中，x=1 的历史运行期望 1、实际返回 0。记录指出循环条件使用 left < right，left 与 right 相等时就退出，最后剩下的候选 mid=1 没有再检查。可迁移教训：先把区间定义、循环条件和循环结束后的处理配套检查；不能只因区间收缩到一个候选就假定该候选已被验证。",
    provenance: {
      sourceProblem: "Sqrt(x)",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "l1_attestation:cms18edwe0063b0cfrp2o1xqe",
        "review_attempt:cmridf2t301avwvcfthykkqus",
        "run_evidence:cmridf2t501awwvcfx38ago8s",
        "diagnosis_result:cmridf2t801axwvcfhh3myro6",
        "problem_history:cmridf2ta01aywvcfm1c5olvj",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "The source establishes this failed revision and diagnosis, not that every current binary-search bug has the same cause.",
        "The source establishes this failed revision only; a separate eval-only card covers the later successful revision.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "l1_attestation", id: "cms18edwe0063b0cfrp2o1xqe" },
      { kind: "review_attempt", id: "cmridf2t301avwvcfthykkqus" },
      { kind: "run_evidence", id: "cmridf2t501awwvcfx38ago8s" },
      { kind: "diagnosis_result", id: "cmridf2t801axwvcfhh3myro6" },
      { kind: "problem_history", id: "cmridf2ta01aywvcfm1c5olvj" },
    ],
  },
  {
    id: "binary-search-pilot:search-2d-matrix-two-stage-closed-interval",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Search a 2D Matrix 的成功 revision 中，代码先对每行首元素做闭区间二分，再以 row = matrix[left - 1] 选出目标所在的候选行；两个循环都使用 left <= right，且非命中分支分别设 left = mid + 1 或 right = mid - 1，因此已检查的 mid 会被排除、区间严格缩小。该 revision 的 lc_submit 原始记录为 Accepted（133/133）。可迁移教训：采用闭区间二分时，让每个非命中分支跨过 mid，并明确循环结束时 left 所代表的插入位置；这条经验只覆盖这道题的“两阶段矩阵定位”写法。",
    provenance: {
      sourceProblem: "Search a 2D Matrix",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "l1_attestation:cms18edj1002ib0cfl18le26w",
        "review_attempt:cmqyi568u00l4fhcf1xo1yrdy",
        "run_evidence:cmqyi568y00l5fhcf1t1z07vx",
        "diagnosis_result:cmqyi568z00l6fhcf50l63lwt",
        "problem_history:cmqyi569100l7fhcf143ijq4i",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "The code-level description is limited to this recorded two-stage matrix-search revision.",
        "Do not use this card to claim that a different current implementation has the same invariant or is accepted.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "l1_attestation", id: "cms18edj1002ib0cfl18le26w" },
      { kind: "review_attempt", id: "cmqyi568u00l4fhcf1xo1yrdy" },
      { kind: "run_evidence", id: "cmqyi568y00l5fhcf1t1z07vx" },
      { kind: "diagnosis_result", id: "cmqyi568z00l6fhcf50l63lwt" },
      { kind: "problem_history", id: "cmqyi569100l7fhcf143ijq4i" },
    ],
  },
  {
    id: "binary-search-pilot:sqrtx-closed-interval-floor",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Sqrt(x) 的历史成功 revision 中，循环使用 left <= right；当 mid*mid < x 时先把 ans 记录为 mid，再令 left = mid + 1，否则令 right = mid - 1，结束后返回 ans。该 revision 为 1019/1019 通过。可迁移教训：求整数平方根的下取整时，闭区间二分必须记录最后一个平方不超过 x 的候选，且每个分支跨过 mid。",
    provenance: {
      sourceProblem: "Sqrt(x)",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmridgsem01bvwvcfkwzawdmh",
        "run_evidence:cmridgsen01bwwvcfwtj812ic",
        "diagnosis_result:cmridgsep01bxwvcfp3iqexdh",
        "problem_history:cmridgseq01bywvcfw5aqw7qh",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmridgsem01bvwvcfkwzawdmh" },
      { kind: "run_evidence", id: "cmridgsen01bwwvcfwtj812ic" },
      { kind: "diagnosis_result", id: "cmridgsep01bxwvcfp3iqexdh" },
      { kind: "problem_history", id: "cmridgseq01bywvcfw5aqw7qh" },
    ],
  },
  {
    id: "binary-search-pilot:median-two-arrays-partition-inequalities",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "answerEligible",
    answerEligible: true,
    evalOnly: false,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Median of Two Sorted Arrays 的 learner-origin revision 中，代码总是在较短数组上二分分割位置 i，并令 j = (m+n+1)//2-i；它用 L1 <= R2 且 L2 <= R1 判断分割是否有效，若 L1 > R2 就令 right = i - 1，否则令 left = i + 1。两个选定的本地可见示例通过。可迁移教训：二分一个分割位置时，要把左右边界元素和分割合法条件一起定义；只在哪一侧不满足不等式时移动对应边界。",
    provenance: {
      sourceProblem: "Median of Two Sorted Arrays",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrutwyxy00e7q9cfojwaf2gh",
        "run_evidence:cmrutwyy100e8q9cfd16l4kwa",
        "diagnosis_result:cmrutwyy300e9q9cfb0ar283i",
        "problem_history:cmrutwyy600eaq9cfkqre30mm",
      ],
    },
    teachingEvidence: {
      sourceQuality: "local_visible_review",
      resultScope: "review_execution_evidence",
      limitations: [
        "Only two selected local visible examples passed; this is not an official-acceptance or hidden-test claim.",
        "The card is evidence for a partition-inequality check, not a claim that every median boundary case was verified.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrutwyxy00e7q9cfojwaf2gh" },
      { kind: "run_evidence", id: "cmrutwyy100e8q9cfd16l4kwa" },
      { kind: "diagnosis_result", id: "cmrutwyy300e9q9cfb0ar283i" },
      { kind: "problem_history", id: "cmrutwyy600eaq9cfkqre30mm" },
    ],
  },
  {
    id: "binary-search-pilot:find-min-rotated-preserve-mid",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Find Minimum in Rotated Sorted Array 的历史成功 revision 中，循环维持 left < right；当 nums[mid] > nums[right] 时用 left = mid + 1 排除左半边和 mid，否则用 right = mid 保留仍可能是最小值的 mid，最后返回 nums[left]。该 revision 的记录为 150/150 通过。可迁移教训：寻找旋转点时，比较 mid 与 right；只有确认 mid 在左侧递增段时才排除 mid，否则保留它作为候选。",
    provenance: {
      sourceProblem: "Find Minimum in Rotated Sorted Array",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrl8xtdy00tiklcf0m57icc7",
        "run_evidence:cmrl8xte600tjklcf36tdlgmf",
        "diagnosis_result:cmrl8xtea00tkklcfm51ctwdn",
        "problem_history:cmrl8xtec00tlklcfa8a6laa2",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrl8xtdy00tiklcf0m57icc7" },
      { kind: "run_evidence", id: "cmrl8xte600tjklcf36tdlgmf" },
      { kind: "diagnosis_result", id: "cmrl8xtea00tkklcfm51ctwdn" },
      { kind: "problem_history", id: "cmrl8xtec00tlklcfa8a6laa2" },
    ],
  },
  {
    id: "binary-search-pilot:lis-lower-bound-tails",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Longest Increasing Subsequence 的历史成功 revision 中，bis 在半开区间 [left,right) 内寻找第一个 tails[mid] >= target：满足时 right = mid，否则 left = mid + 1；返回位置用当前数替换 tails[replace]，或在末尾追加。该 revision 的记录为 56/56 通过。可迁移教训：求 lower bound 时把 right 设为长度并保持右开区间，命中条件收缩 right，未命中才推进 left。",
    provenance: {
      sourceProblem: "Longest Increasing Subsequence",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrkx80b500fzv6cftxtq2dhl",
        "run_evidence:cmrkx80b800g0v6cfm05z6nhx",
        "diagnosis_result:cmrkx80bc00g1v6cfmxhxezet",
        "problem_history:cmrkx80bf00g2v6cfnf48m8jr",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrkx80b500fzv6cftxtq2dhl" },
      { kind: "run_evidence", id: "cmrkx80b800g0v6cfm05z6nhx" },
      { kind: "diagnosis_result", id: "cmrkx80bc00g1v6cfmxhxezet" },
      { kind: "problem_history", id: "cmrkx80bf00g2v6cfnf48m8jr" },
    ],
  },
  {
    id: "binary-search-pilot:find-peak-linear-walk",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "negative",
    experienceText:
      "在 Find Peak Element 的历史失败 revision 中，代码从下标 1 开始按相邻大小向左或向右逐步移动，直到找到局部峰值；它没有每轮砍掉一半搜索范围。可见样例 2 期望下标 5、实际返回 1，且诊断指出该线性爬坡策略不满足题目的 O(log n) 要求。可迁移教训：当题目要求对数复杂度时，先检查每一步是否按比较结果排除一个半区，而不是只移动一个位置。",
    provenance: {
      sourceProblem: "Find Peak Element",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrchvbkx00bwd1cfnpmuqpwi",
        "run_evidence:cmrchvbl200bxd1cfaatszqn7",
        "diagnosis_result:cmrchvbl500byd1cfk045b7g0",
        "problem_history:cmrchvbl800bzd1cfid4ki9w8",
      ],
    },
    teachingEvidence: {
      sourceQuality: "local_visible_review",
      resultScope: "review_execution_evidence",
      limitations: [
        "The source was reclassified as local-visible evidence and its original Review row is legacy_unknown; evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrchvbkx00bwd1cfnpmuqpwi" },
      { kind: "run_evidence", id: "cmrchvbl200bxd1cfaatszqn7" },
      { kind: "diagnosis_result", id: "cmrchvbl500byd1cfk045b7g0" },
      { kind: "problem_history", id: "cmrchvbl800bzd1cfid4ki9w8" },
    ],
  },
  {
    id: "binary-search-pilot:search-insert-hardcoded-zero",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "negative",
    experienceText:
      "在 Search Insert Position 的一组重复历史失败 revision 中，代码直接返回 0，没有读取 nums 或 target 来比较和收缩区间；每次均为 21/66 通过、45 个失败。可迁移教训：在讨论二分边界之前，先验证实现确实根据输入比较并更新 left/right；固定返回值不是可迁移的边界 bug。",
    provenance: {
      sourceProblem: "Search Insert Position",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmqhj45d00012dncffh0jj99n",
        "run_evidence:cmqhj45d50013dncfqkfxvn0i",
        "diagnosis_result:cmqhj45d90014dncfajc1mp3f",
        "problem_history:cmqhj45db0015dncfnc9yj8wu",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "This representative bundle stands for 46 legacy_unknown duplicate reviews with the same hardcoded-zero behavior; evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmqhj45d00012dncffh0jj99n" },
      { kind: "run_evidence", id: "cmqhj45d50013dncfqkfxvn0i" },
      { kind: "diagnosis_result", id: "cmqhj45d90014dncfajc1mp3f" },
      { kind: "problem_history", id: "cmqhj45db0015dncfnc9yj8wu" },
    ],
  },
  {
    id: "binary-search-pilot:search-insert-closed-interval-insertion",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Search Insert Position 的历史成功 revision 中，闭区间从 left=0、right=len(nums)-1 开始；target < nums[mid] 时 right = mid - 1，target > nums[mid] 时 left = mid + 1，找不到相等值时返回 left。该 revision 为 66/66 通过。可迁移教训：找插入位置时，循环结束后的 left 是第一个大于等于 target 的位置（lower bound）；当前 revision 的相等分支会直接返回命中下标。",
    provenance: {
      sourceProblem: "Search Insert Position",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmqig0wbo00gpdncf1hgp1vkj",
        "run_evidence:cmqig0wbp00gqdncfw3u9p9sg",
        "diagnosis_result:cmqig0wbq00grdncfzgy4srm0",
        "problem_history:cmqig0wbr00gsdncfmh2ob1y1",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmqig0wbo00gpdncf1hgp1vkj" },
      { kind: "run_evidence", id: "cmqig0wbp00gqdncfw3u9p9sg" },
      { kind: "diagnosis_result", id: "cmqig0wbq00grdncfzgy4srm0" },
      { kind: "problem_history", id: "cmqig0wbr00gsdncfmh2ob1y1" },
    ],
  },
  {
    id: "binary-search-pilot:rotated-search-excludes-pivot",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "negative",
    experienceText:
      "在 Search in Rotated Sorted Array 的历史失败 revision 中，找旋转点时 nums[mid] <= nums[right] 的分支使用 right = mid - 1，把仍可能是最小值的 mid 排除。用例 [1,3], target=3 期望下标 1、实际 -1。可迁移教训：寻找旋转点时，若 mid 仍可能是最小值，就必须保留它，用 right = mid 而不是 right = mid - 1。",
    provenance: {
      sourceProblem: "Search in Rotated Sorted Array",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrib7b2v00jgwvcfldaerhx4",
        "run_evidence:cmrib7b2y00jhwvcff5q17ezm",
        "diagnosis_result:cmrib7b3000jiwvcfkbne8yvo",
        "problem_history:cmrib7b3300jjwvcfp1obgk9s",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrib7b2v00jgwvcfldaerhx4" },
      { kind: "run_evidence", id: "cmrib7b2y00jhwvcff5q17ezm" },
      { kind: "diagnosis_result", id: "cmrib7b3000jiwvcfkbne8yvo" },
      { kind: "problem_history", id: "cmrib7b3300jjwvcfp1obgk9s" },
    ],
  },
  {
    id: "binary-search-pilot:rotated-search-pivot-zero-empty-interval",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "negative",
    experienceText:
      "在 Search in Rotated Sorted Array 的另一历史失败 revision 中，旋转点为 0 时，target >= nums[0] 的分支仍把 right 设为 left - 1，得到空区间。可迁移教训：按旋转点选择搜索半区前，先处理“没有旋转、pivot=0”的情况；此时目标可能在完整数组，不能把右边界缩到 -1。",
    provenance: {
      sourceProblem: "Search in Rotated Sorted Array",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmrib9ckr00krwvcfbklyd3ah",
        "run_evidence:cmrib9cks00kswvcf8d5c9i7t",
        "diagnosis_result:cmrib9cku00ktwvcf4m5km0cx",
        "problem_history:cmrib9ckv00kuwvcfxl3dyp8n",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmrib9ckr00krwvcfbklyd3ah" },
      { kind: "run_evidence", id: "cmrib9cks00kswvcf8d5c9i7t" },
      { kind: "diagnosis_result", id: "cmrib9cku00ktwvcf4m5km0cx" },
      { kind: "problem_history", id: "cmrib9ckv00kuwvcfxl3dyp8n" },
    ],
  },
  {
    id: "binary-search-pilot:rotated-search-pivot-zero-full-array",
    learnerId: "cmq798gwq0000pxcfautlf6qw",
    eligibility: "evalOnly",
    answerEligible: false,
    evalOnly: true,
    algorithmTag: "binary_search",
    polarity: "positive",
    experienceText:
      "在 Search in Rotated Sorted Array 的历史成功 revision 中，旋转点二分保留 right = mid；后续若 target >= nums[0]，代码在 left 为 0 时将 right 设为 len(nums) - 1，而不是 left - 1，因此未旋转数组仍搜索完整区间。该 revision 为 196/196 通过。可迁移教训：用 pivot 划分旋转数组前，把 pivot=0 当作完整有序数组处理，避免构造空的左半区。",
    provenance: {
      sourceProblem: "Search in Rotated Sorted Array",
      sourceAlgorithmTag: "binary-search",
      evidenceRefs: [
        "review_attempt:cmribappm00lqwvcfufzyuml2",
        "run_evidence:cmribappn00lrwvcfmdf7fj1p",
        "diagnosis_result:cmribappo00lswvcflri821o6",
        "problem_history:cmribappq00ltwvcfvz0jp1y1",
      ],
    },
    teachingEvidence: {
      sourceQuality: "legacy_unknown",
      resultScope: "official_judge",
      limitations: [
        "Source Review rows are legacy_unknown, so this card is evaluation-only.",
      ],
    },
    auditEvidenceRefs: [
      { kind: "review_attempt", id: "cmribappm00lqwvcfufzyuml2" },
      { kind: "run_evidence", id: "cmribappn00lrwvcfmdf7fj1p" },
      { kind: "diagnosis_result", id: "cmribappo00lswvcflri821o6" },
      { kind: "problem_history", id: "cmribappq00ltwvcfvz0jp1y1" },
    ],
  },
];

export { cards as binarySearchLearningExperienceCards };

/** Source bundles intentionally not made into cards are in the coverage manifest. */
export const binarySearchLearningExperienceCardAbstentions = [] as const;
