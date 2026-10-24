import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "../src/lib/env";
import { createQwenCoachProvider } from "../src/server/agents/coach-agent/qwen-coach-provider";
import type {
  CoachChatInput,
  CoachProvider,
} from "../src/server/agents/coach-agent/coach-agent.types";
import {
  binarySearchLearningExperienceCards,
  type BinarySearchLearningExperienceCard,
} from "../src/server/memory/learning-experience-recall/binary-search-pilot-cards";
import {
  indexLearningExperienceCards,
  recallLearningExperienceCards,
} from "../src/server/memory/learning-experience-recall/learning-experience-recall";
import type {
  LearningExperienceLaneTrace,
  LearningExperienceRecall,
} from "../src/server/memory/learning-experience-recall/contracts";
import {
  createEmbedClient,
  isEmbeddingConfigured,
} from "../src/server/memory/retrieval/embed-client";
import { MAX_ACCEPTED_VECTOR_COSINE_DISTANCE } from "../src/server/memory/retrieval/hybrid-candidate-recall";
import { createFtsStore } from "../src/server/memory/store/fts-store";
import { createVectorStore } from "../src/server/memory/store/vector-store";
import {
  buildChatToolManifest,
  learningExperienceRecallToolArgsSchema,
} from "../src/server/tools/chat-tools/chat-tool-contracts";

const learnerId = binarySearchLearningExperienceCards[0]?.learnerId;
const outputPath = process.env.LEARNING_EXPERIENCE_EVAL_OUTPUT?.trim();

type EvaluationCase = {
  id: string;
  title: string;
  slug: string;
  message: string;
  code: string;
  expected: {
    polarity: "negative" | "positive" | "none";
    goldCardId?: string;
  };
};

/**
 * Isolated, real-provider evaluation for the binary-search Pilot.
 *
 * It writes only an embedding index and JSON evidence beneath /tmp. It does
 * not touch Prisma, APIs, Piston, Docker, or workspace dev.db. The real Chat
 * provider writes the Tool args from each code/problem pair; the real embedding
 * provider ranks the source-controlled full corpus.
 */
async function main() {
  loadLocalEnv();
  assertRealProviders();
  if (!learnerId) throw new Error("The binary-search card corpus is empty.");

  const directory = mkdtempSync(
    join(tmpdir(), "patterncoach-binary-experience-eval-"),
  );
  const indexPath = join(directory, "index.sqlite");
  const resultPath = outputPath ?? join(directory, "results.json");
  const ftsStore = createFtsStore(indexPath);
  const embedClient = createEmbedClient();
  const vectorStore = createVectorStore(indexPath, embedClient.dim);

  try {
    await indexLearningExperienceCards({
      cards: binarySearchLearningExperienceCards,
      ftsStore,
      vectorStore,
      embedClient,
    });
    const provider = createQwenCoachProvider();
    const records = [];
    for (const candidate of evaluationCases) {
      const searchPlan = await askRealCoachForSearchPlan(provider, candidate);
      const retrieval = await recallLearningExperienceCards({
        cards: binarySearchLearningExperienceCards,
        learnerId,
        problemTags: ["binary-search"],
        failurePattern: searchPlan.failurePattern,
        successPattern: searchPlan.successPattern,
        ftsStore,
        vectorStore,
        embedClient,
      });
      records.push(projectRecord(candidate, searchPlan, retrieval));
    }

    const finalReplySamples = [];
    for (const id of [
      "sqrtx-terminal-candidate",
      "median-partition-inequalities",
      "rotated-pivot-preservation",
    ]) {
      const record = records.find((item) => item.id === id);
      const candidate = evaluationCases.find((item) => item.id === id);
      if (!record || !candidate) continue;
      finalReplySamples.push(
        await askRealCoachForOfflineEvaluationReply(
          provider,
          candidate,
          record,
        ),
      );
    }

    const output = {
      generatedAt: new Date().toISOString(),
      harness: "direct_real_chat_provider_plus_real_embedding_provider",
      corpus: summarizeCorpus(binarySearchLearningExperienceCards),
      limits: [
        "Not an HTTP/API end-to-end smoke.",
        "No Piston, Docker, Prisma, or dev.db access occurs in this script.",
        "All card ranking includes evalOnly cards, but the production selector still excludes them from learner-facing Tool results.",
        "Offline reply samples may include evalOnly evidence only to test source-strength wording; they are not production Tool outputs.",
      ],
      cases: records,
      metrics: calculateMetrics(records),
      finalReplySamples,
    };
    writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(resultPath);
  } finally {
    ftsStore.close();
    vectorStore.close();
    if (!outputPath) rmSync(directory, { recursive: true, force: true });
  }
}

function assertRealProviders() {
  if (!process.env.LLM_CHAT_API_KEY?.trim()) {
    throw new Error(
      "LLM_CHAT_API_KEY is required for the real Chat evaluation.",
    );
  }
  if (process.env.COACH_PROVIDER === "mock") {
    throw new Error(
      "COACH_PROVIDER=mock is incompatible with this evaluation.",
    );
  }
  if (!isEmbeddingConfigured()) {
    throw new Error(
      "EMBEDDING_API_KEY is required for the real embedding evaluation.",
    );
  }
}

async function askRealCoachForSearchPlan(
  provider: CoachProvider,
  candidate: EvaluationCase,
) {
  const result = await provider.chat(
    chatInput(candidate, {
      messages: [{ role: "user", content: candidate.message }],
      toolMode: "tool_loop",
      tools: buildChatToolManifest(new Set(["recall_learning_experience"])),
      toolChoice: "recall_learning_experience",
    }),
  );
  if (result.type !== "tool_calls") {
    throw new Error(`${candidate.id}: real Coach did not emit a Tool call.`);
  }
  const toolCall = result.toolCalls.find(
    (item) => item.name === "recall_learning_experience",
  );
  const parsed = learningExperienceRecallToolArgsSchema.safeParse(
    toolCall?.arguments,
  );
  if (!parsed.success) {
    throw new Error(`${candidate.id}: invalid real Coach Tool args.`);
  }
  return parsed.data;
}

async function askRealCoachForOfflineEvaluationReply(
  provider: CoachProvider,
  candidate: EvaluationCase,
  record: ReturnType<typeof projectRecord>,
) {
  const evidence = offlineEvidence(record);
  const result = await provider.chat(
    chatInput(candidate, {
      messages: [
        { role: "user", content: candidate.message },
        {
          role: "assistant",
          content:
            "I first analysed the current code and then received offline evaluation evidence.",
        },
        {
          role: "user",
          content: [
            "[OFFLINE EVALUATION EVIDENCE — not a production Tool result]",
            "Diagnose the CURRENT code first. Then, if useful, use only the historical evidence below.",
            "For sourceQuality=legacy_unknown or evalOnly=true, explicitly scope it as an untrusted historical analogy and do not say it is a confirmed learner fact, an official acceptance, or proof of this root cause.",
            "Do not mention tools, ranking, ids, distance, or this evaluation instruction.",
            JSON.stringify(evidence),
          ].join("\n"),
        },
      ],
      toolMode: "finalize_without_tools",
    }),
  );
  if (result.type !== "final") {
    throw new Error(
      `${candidate.id}: real Coach did not produce a final reply.`,
    );
  }
  return { caseId: candidate.id, evidence, reply: result.coachReply };
}

function chatInput(
  candidate: EvaluationCase,
  overrides: Pick<
    CoachChatInput,
    "messages" | "toolMode" | "tools" | "toolChoice"
  >,
): CoachChatInput {
  return {
    problem: {
      slug: candidate.slug,
      title: candidate.title,
      leetcodeNumber: null,
      tags: ["binary-search"],
      methodName: "solve",
    },
    user: {
      displayName: "PatternCoachEvaluation",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: {
      profileId: "pilot_disabled_automatic_assembly",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "disabled",
    },
    workspaceContext: {
      problem: {
        slug: candidate.slug,
        title: candidate.title,
        leetcodeNumber: null,
        tags: ["binary-search"],
        methodName: "solve",
      },
      language: "Python",
      currentCode: candidate.code,
      currentCodeLength: candidate.code.length,
      currentCodeLineCount: candidate.code.split("\n").length,
      currentCodeTruncated: false,
      codeState: "formed",
      currentCodeSummary: candidate.message,
      selectedTests: [],
      currentCodeAuthoritativeRunStatus: "no_authoritative_run_yet",
      latestRunAlignment: "none",
      resumedWorkingRunAlignment: "none",
      currentTurnRunObservations: [],
    },
    responseLanguage: "zh",
    ...overrides,
  };
}

function projectRecord(
  candidate: EvaluationCase,
  searchPlan: { failurePattern?: string; successPattern?: string },
  retrieval: LearningExperienceRecall,
) {
  const lane =
    candidate.expected.polarity === "none"
      ? undefined
      : retrieval.trace.lanes.find(
          (item) => item.polarity === candidate.expected.polarity,
        );
  const goldRank = candidate.expected.goldCardId
    ? (lane?.rankedCandidates.findIndex(
        (item) => item.id === candidate.expected.goldCardId,
      ) ?? -1) + 1
    : undefined;
  const goldCandidate = candidate.expected.goldCardId
    ? lane?.rankedCandidates.find(
        (item) => item.id === candidate.expected.goldCardId,
      )
    : undefined;
  const goldWithinThreshold = Boolean(
    goldCandidate &&
    goldCandidate.ftsMatched &&
    goldCandidate.distance <= MAX_ACCEPTED_VECTOR_COSINE_DISTANCE,
  );
  const semanticAdmitted = retrieval.trace.lanes.some((item) =>
    item.rankedCandidates.some(
      (candidate) =>
        candidate.ftsMatched &&
        candidate.distance <= MAX_ACCEPTED_VECTOR_COSINE_DISTANCE,
    ),
  );
  return {
    id: candidate.id,
    expected: candidate.expected,
    realToolArgs: searchPlan,
    answerResult: {
      status: retrieval.status,
      negative: retrieval.negative?.sourceProblem ?? null,
      positive: retrieval.positive?.sourceProblem ?? null,
      selectedIds: retrieval.trace.lanes.map((item) => ({
        polarity: item.polarity,
        selectedId: item.selectedId ?? null,
      })),
    },
    goldRank: goldRank && goldRank > 0 ? goldRank : null,
    goldDistance: goldCandidate?.distance ?? null,
    goldFtsMatched: goldCandidate?.ftsMatched ?? false,
    goldWithinThreshold,
    qualifiedGoldRank:
      goldRank && goldRank > 0 && goldWithinThreshold ? goldRank : null,
    offlineSemanticAdmission: semanticAdmitted,
    lanes: retrieval.trace.lanes.map(projectLane),
  };
}

function projectLane(lane: LearningExperienceLaneTrace) {
  return {
    polarity: lane.polarity,
    vectorQuery: lane.vectorQuery,
    selectedId: lane.selectedId ?? null,
    eligibleIds: lane.eligibleIds,
    topK: lane.rankedCandidates.slice(0, 5),
  };
}

function offlineEvidence(record: ReturnType<typeof projectRecord>) {
  const goldId = record.expected.goldCardId;
  const card = binarySearchLearningExperienceCards.find(
    (item) => item.id === goldId,
  );
  const rank = record.goldRank;
  return {
    historicalCardReturnedForEvaluation: card
      ? {
          sourceProblem: card.provenance.sourceProblem,
          experienceText: card.experienceText,
          sourceQuality: card.teachingEvidence.sourceQuality,
          resultScope: card.teachingEvidence.resultScope,
          answerEligible: card.answerEligible !== false && !card.evalOnly,
          evalOnly: card.evalOnly === true,
          limitations: card.teachingEvidence.limitations,
          rank,
        }
      : null,
  };
}

function summarizeCorpus(cards: readonly BinarySearchLearningExperienceCard[]) {
  return {
    cards: cards.length,
    positive: cards.filter((item) => item.polarity === "positive").length,
    negative: cards.filter((item) => item.polarity === "negative").length,
    answerEligible: cards.filter(
      (item) => item.answerEligible !== false && !item.evalOnly,
    ).length,
    evalOnly: cards.filter((item) => item.evalOnly === true).length,
  };
}

function calculateMetrics(records: Array<ReturnType<typeof projectRecord>>) {
  const result: Record<string, unknown> = {};
  for (const polarity of ["negative", "positive"] as const) {
    const subset = records.filter(
      (item) => item.expected.polarity === polarity && item.expected.goldCardId,
    );
    const ranks = subset.map((item) => item.goldRank).filter(isNumber);
    const qualifiedRanks = subset
      .map((item) => item.qualifiedGoldRank)
      .filter(isNumber);
    result[polarity] = {
      cases: subset.length,
      rankingRecallAt1: rate(
        ranks.filter((rank) => rank <= 1).length,
        subset.length,
      ),
      rankingRecallAt3: rate(
        ranks.filter((rank) => rank <= 3).length,
        subset.length,
      ),
      qualifiedRecallAt1: rate(
        qualifiedRanks.filter((rank) => rank <= 1).length,
        subset.length,
      ),
      qualifiedRecallAt3: rate(
        qualifiedRanks.filter((rank) => rank <= 3).length,
        subset.length,
      ),
      qualifiedPrecisionAt1: rate(
        subset.filter((item) => item.qualifiedGoldRank === 1).length,
        subset.length,
      ),
      ranks: subset.map((item) => ({
        id: item.id,
        rank: item.goldRank,
        distance: item.goldDistance,
        ftsMatched: item.goldFtsMatched,
        withinThreshold: item.goldWithinThreshold,
        qualifiedRank: item.qualifiedGoldRank,
      })),
    };
  }
  const abstain = records.filter((item) => item.expected.polarity === "none");
  result.abstention = {
    cases: abstain.length,
    productionSafeAccuracy: rate(
      abstain.filter(
        (item) =>
          item.answerResult.negative === null &&
          item.answerResult.positive === null,
      ).length,
      abstain.length,
    ),
    offlineSemanticAccuracy: rate(
      abstain.filter((item) => !item.offlineSemanticAdmission).length,
      abstain.length,
    ),
    details: abstain.map((item) => ({
      id: item.id,
      offlineSemanticAdmission: item.offlineSemanticAdmission,
      negative: item.answerResult.negative,
      positive: item.answerResult.positive,
    })),
  };
  return result;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number";
}

function rate(numerator: number, denominator: number) {
  return denominator === 0
    ? null
    : Number((numerator / denominator).toFixed(3));
}

const evaluationCases: EvaluationCase[] = [
  {
    id: "sqrtx-terminal-candidate",
    title: "Sqrt(x)",
    slug: "sqrtx",
    message: "这个二分在 x=1 时返回 0。请诊断为什么最后一个候选没有被检查。",
    code: `def mySqrt(x):
    left, right = 0, x
    while left < right:
        mid = (left + right) // 2
        if mid * mid <= x:
            left = mid + 1
        else:
            right = mid - 1
    return left - 1`,
    expected: {
      polarity: "negative",
      goldCardId: "binary-search-pilot:sqrtx:last-candidate-not-checked",
    },
  },
  {
    id: "matrix-two-stage-closed-interval",
    title: "Search a 2D Matrix",
    slug: "search-a-2d-matrix",
    message:
      "请解释这段两阶段二分为什么每轮都会收缩，尤其是行选择后的第二次搜索。",
    code: `def searchMatrix(matrix, target):
    left, right = 0, len(matrix) - 1
    while left <= right:
        mid = (left + right) // 2
        if matrix[mid][0] <= target:
            left = mid + 1
        else:
            right = mid - 1
    row = matrix[left - 1]
    left, right = 0, len(row) - 1
    while left <= right:
        mid = (left + right) // 2
        if row[mid] < target:
            left = mid + 1
        elif row[mid] > target:
            right = mid - 1
        else:
            return True
    return False`,
    expected: {
      polarity: "positive",
      goldCardId:
        "binary-search-pilot:search-2d-matrix-two-stage-closed-interval",
    },
  },
  {
    id: "median-partition-inequalities",
    title: "Median of Two Sorted Arrays",
    slug: "median-of-two-sorted-arrays",
    message:
      "请解释这段二分分割代码为什么通过左右边界不等式移动 i，而不是比较某一个中点值。",
    code: `def median(a, b):
    if len(a) > len(b):
        a, b = b, a
    m, n = len(a), len(b)
    left, right = 0, m
    while left <= right:
        i = (left + right) // 2
        j = (m + n + 1) // 2 - i
        L1 = float('-inf') if i == 0 else a[i - 1]
        R1 = float('inf') if i == m else a[i]
        L2 = float('-inf') if j == 0 else b[j - 1]
        R2 = float('inf') if j == n else b[j]
        if L1 <= R2 and L2 <= R1:
            return max(L1, L2)
        if L1 > R2:
            right = i - 1
        else:
            left = i + 1`,
    expected: {
      polarity: "positive",
      goldCardId:
        "binary-search-pilot:median-two-arrays-partition-inequalities",
    },
  },
  {
    id: "rotated-pivot-preservation",
    title: "Search in Rotated Sorted Array",
    slug: "search-in-rotated-sorted-array",
    message:
      "这段代码先找旋转点、再找 target。在 nums=[3,1,2]、target=3 时，期望返回下标 0，实际返回 -1。请诊断 `right = mid - 1` 是否错误排除了仍可能是最小值的 mid；必须区分 pivot（最小值下标）和 target 的下标。这里错误的 pivot=0 会让后续二分在未排序的完整数组上运行，不能用未旋转 [1,3] 代替这个反例。",
    code: `def search(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        mid = (left + right) // 2
        if nums[mid] > nums[right]:
            left = mid + 1
        else:
            right = mid - 1
    pivot = left
    if pivot == 0:
        left, right = 0, len(nums) - 1
    elif target >= nums[0]:
        left, right = 0, pivot - 1
    else:
        left, right = pivot, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1`,
    expected: {
      polarity: "negative",
      goldCardId: "binary-search-pilot:rotated-search-excludes-pivot",
    },
  },
  {
    id: "rotated-pivot-zero",
    title: "Search in Rotated Sorted Array",
    slug: "search-in-rotated-sorted-array",
    message:
      "未旋转数组的 pivot=0 时，这段按 pivot 分段的代码为什么会得到空搜索区间？",
    code: `def choose_range(nums, target, pivot):
    left, right = 0, len(nums) - 1
    if target >= nums[0]:
        right = left - 1
    else:
        left = pivot
    return left, right`,
    expected: {
      polarity: "negative",
      goldCardId:
        "binary-search-pilot:rotated-search-pivot-zero-empty-interval",
    },
  },
  {
    id: "find-min-preserve-mid",
    title: "Find Minimum in Rotated Sorted Array",
    slug: "find-minimum-in-rotated-sorted-array",
    message:
      "解释这个旋转数组最小值二分为什么有一支保留 mid，而不是一律 mid-1。",
    code: `def findMin(nums):
    left, right = 0, len(nums) - 1
    while left < right:
        mid = (left + right) // 2
        if nums[mid] > nums[right]:
            left = mid + 1
        else:
            right = mid
    return nums[left]`,
    expected: {
      polarity: "positive",
      goldCardId: "binary-search-pilot:find-min-rotated-preserve-mid",
    },
  },
  {
    id: "lis-lower-bound",
    title: "Longest Increasing Subsequence",
    slug: "longest-increasing-subsequence",
    message:
      "这段 tails 的 lower_bound 为什么用右开区间，并在 tails[mid] >= target 时收缩 right？",
    code: `def lower_bound(tails, target):
    left, right = 0, len(tails)
    while left < right:
        mid = (left + right) // 2
        if tails[mid] >= target:
            right = mid
        else:
            left = mid + 1
    return left`,
    expected: {
      polarity: "positive",
      goldCardId: "binary-search-pilot:lis-lower-bound-tails",
    },
  },
  {
    id: "find-peak-not-halving",
    title: "Find Peak Element",
    slug: "find-peak-element",
    message:
      "题目要求 O(log n)，这段只向相邻较大元素走一步的写法为什么不合格？",
    code: `def findPeak(nums):
    i = 1
    while 0 < i < len(nums) - 1:
        if nums[i - 1] > nums[i]:
            i -= 1
        elif nums[i + 1] > nums[i]:
            i += 1
        else:
            return i
    return i`,
    expected: {
      polarity: "negative",
      goldCardId: "binary-search-pilot:find-peak-linear-walk",
    },
  },
  {
    id: "abstain-two-sum-two-pointers",
    title: "Two Sum II - Input Array Is Sorted",
    slug: "two-sum-ii-input-array-is-sorted",
    message: "这段双指针收敛代码的移动规则是否正确？",
    code: `def twoSum(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        total = nums[left] + nums[right]
        if total < target:
            left += 1
        elif total > target:
            right -= 1
        else:
            return [left, right]`,
    expected: { polarity: "none" },
  },
  {
    id: "abstain-min-subarray-window",
    title: "Minimum Size Subarray Sum",
    slug: "minimum-size-subarray-sum",
    message: "这个滑动窗口何时收缩左边界？",
    code: `def minSubArrayLen(target, nums):
    left = total = 0
    best = float('inf')
    for right, value in enumerate(nums):
        total += value
        while total >= target:
            best = min(best, right - left + 1)
            total -= nums[left]
            left += 1
    return best`,
    expected: { polarity: "none" },
  },
  {
    id: "abstain-runner-unavailable",
    title: "Count Complete Tree Nodes",
    slug: "count-complete-tree-nodes",
    message:
      "当前没有对齐运行证据时，请只说明还缺什么验证，不要假定二分失败模式。",
    code: `def countNodes(root):
    if not root:
        return 0
    return 1 + countNodes(root.left) + countNodes(root.right)`,
    expected: { polarity: "none" },
  },
];

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
