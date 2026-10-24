import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ToolName =
  | "run_current_code"
  | "verify_proposed_repair"
  | "past_problem_recall"
  | "past_mistake_recall"
  | "find_practice_problem"
  | "get_algorithm_hint"
  | "lookup_api_reference"
  | "note_memory"
  | "save_knowledge_note";

type ExpectedToolGroup = {
  label: string;
  anyOf: ToolName[];
};

type IntegrationMarker = {
  label: string;
  value: string;
  match: "case_insensitive_substring" | "compact_substring" | "regex";
  source: string;
};

type TrajectoryCase = {
  caseId: string;
  intentStyle: "natural_intent";
  category:
    | "concept_question_no_tool"
    | "run_case_requires_run_code"
    | "history_question_requires_memory_tool"
    | "api_question_requires_lookup_api_reference"
    | "preference_requires_note_memory"
    | "knowledge_note_requires_save_knowledge_note"
    | "practice_request_requires_find_practice_problem"
    | "hint_request_requires_algorithm_hint"
    | "multi_step_tool_chain";
  userMessage: string;
  problem: ProblemFixture;
  language: "Python" | "C++";
  code: string;
  selectedTests: TestFixture[];
  memorySeed?: {
    mistakeFacts: Array<{
      tag: string;
      label: string;
      value: string;
      lastEvidenceSummary: string;
    }>;
    problemEpisodes?: Array<{
      problem: ProblemFixture;
      title: string;
      summary: string;
      outcome: "resolved" | "unresolved" | "improved";
      tags: string[];
    }>;
  };
  expectedTools: ToolName[];
  expectedToolGroups: ExpectedToolGroup[];
  optionalTools: ToolName[];
  forbiddenTools: ToolName[];
  orderedSubsequence: Array<ToolName | ExpectedToolGroup>;
  integrationMarkers: IntegrationMarker[];
  notes: string;
  limitations: string[];
  humanReviewStatus: "approved";
  runCodeReplayFixtureId?: string;
};

type ProblemFixture = {
  slug: string;
  title: string;
  leetcodeNumber: number;
  tags: string[];
};

type TestFixture = {
  id: string;
  label: string;
  input: unknown;
  expected: unknown;
};

const allTools: ToolName[] = [
  "run_current_code",
  "verify_proposed_repair",
  "past_problem_recall",
  "past_mistake_recall",
  "find_practice_problem",
  "get_algorithm_hint",
  "lookup_api_reference",
  "note_memory",
  "save_knowledge_note",
];

const defaultLimitations = [
  "Human-approved trajectory label as of 2026-07-06.",
  "run_current_code evidence is replayed visible evidence, not a live LeetCode accepted result.",
];

const twoSum: ProblemFixture = {
  slug: "two-sum",
  title: "Two Sum",
  leetcodeNumber: 1,
  tags: ["Array", "Hash Table"],
};

const searchInsert: ProblemFixture = {
  slug: "search-insert-position",
  title: "Search Insert Position",
  leetcodeNumber: 35,
  tags: ["Array", "Binary Search"],
};

const longestSubstring: ProblemFixture = {
  slug: "longest-substring-without-repeating-characters",
  title: "Longest Substring Without Repeating Characters",
  leetcodeNumber: 3,
  tags: ["Hash Table", "String", "Sliding Window"],
};

const minimumWindow: ProblemFixture = {
  slug: "minimum-window-substring",
  title: "Minimum Window Substring",
  leetcodeNumber: 76,
  tags: ["Hash Table", "String", "Sliding Window"],
};

const interleavingString: ProblemFixture = {
  slug: "interleaving-string",
  title: "Interleaving String",
  leetcodeNumber: 97,
  tags: ["String", "Dynamic Programming"],
};

const kthLargest: ProblemFixture = {
  slug: "kth-largest-element-in-an-array",
  title: "Kth Largest Element in an Array",
  leetcodeNumber: 215,
  tags: ["Heap", "Array"],
};

const levelOrder: ProblemFixture = {
  slug: "binary-tree-level-order-traversal",
  title: "Binary Tree Level Order Traversal",
  leetcodeNumber: 102,
  tags: ["Binary Tree", "BFS"],
};

const pythonTwoSumHardcoded = `class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        return [0, 1]
`;

const pythonSearchInsertOffByOne = `class Solution:
    def searchInsert(self, nums: list[int], target: int) -> int:
        left, right = 0, len(nums) - 1
        while left <= right:
            mid = (left + right) // 2
            if nums[mid] < target:
                left = mid + 1
            else:
                right = mid - 1
        return left + 1
`;

const pythonLongestSubstringLeftRegression = `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last_seen = {}
        left = 0
        best = 0
        for right, ch in enumerate(s):
            if ch in last_seen:
                left = last_seen[ch] + 1
            last_seen[ch] = right
            best = max(best, right - left + 1)
        return best
`;

const pythonInterleavingSinglePredecessor = `class Solution:
    def isInterleave(self, s1: str, s2: str, s3: str) -> bool:
        if len(s1) + len(s2) != len(s3):
            return False
        dp = [[False] * (len(s2) + 1) for _ in range(len(s1) + 1)]
        dp[0][0] = True
        for i in range(len(s1) + 1):
            for j in range(len(s2) + 1):
                if i > 0 and s1[i - 1] == s3[i + j - 1]:
                    dp[i][j] = dp[i - 1][j]
                elif j > 0 and s2[j - 1] == s3[i + j - 1]:
                    dp[i][j] = dp[i][j - 1]
        return dp[-1][-1]
`;

const pythonPlaceholder = `class Solution:
    def solve(self, *args):
        return None
`;

const cppTwoSumPlaceholder = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        return {};
    }
};
`;

const cppHeapPlaceholder = `class Solution {
public:
    int findKthLargest(vector<int>& nums, int k) {
        return 0;
    }
};
`;

const abbaTest: TestFixture = {
  id: "case-abba",
  label: "duplicate before current window",
  input: { s: "abba" },
  expected: 2,
};

const twoSumSearchTest: TestFixture = {
  id: "case-sample-needs-search",
  label: "sample requires non-adjacent pair",
  input: { nums: [3, 2, 4], target: 6 },
  expected: [1, 2],
};

const searchInsertMiddleTest: TestFixture = {
  id: "case-insert-middle",
  label: "insert in middle",
  input: { nums: [1, 3, 5, 6], target: 2 },
  expected: 1,
};

const memoryFacts = {
  binaryReturn: {
    tag: "binary_search_return_off_by_one",
    label: "Binary search return off by one",
    value:
      "Previously returned left + 1 after a correct insertion-position loop.",
    lastEvidenceSummary:
      "Search Insert: loop reached the insertion boundary, then return left + 1 shifted the answer.",
  },
  slidingLeft: {
    tag: "stale_duplicate_boundary",
    label: "Stale duplicate boundary",
    value:
      "Previously moved left backward when an old duplicate was outside the active window.",
    lastEvidenceSummary:
      "Longest Substring: abba/tmmzuxt showed the left boundary regressing.",
  },
  dpTransition: {
    tag: "dp_state_transition_incomplete",
    label: "DP state transition missed a valid predecessor",
    value:
      "Previously updated a DP state from only one predecessor and missed the other valid transition.",
    lastEvidenceSummary:
      "Interleaving String: each state had to combine both valid predecessor transitions when their next characters matched.",
  },
  apiConfusion: {
    tag: "python_container_api_confusion",
    label: "Python container API confusion",
    value:
      "Previously mixed up deque/heap/dict helper APIs under time pressure.",
    lastEvidenceSummary:
      "Chat: asked for quick reminders on deque, heapq, and dict get/default behavior.",
  },
  shrinkCondition: {
    tag: "sliding_window_shrink_condition_error",
    label: "Sliding-window shrink condition",
    value:
      "Repeatedly needed the reminder that a variable-size window may need to shrink in a while loop.",
    lastEvidenceSummary:
      "Minimum window and longest substring reviews both centered on window validity before scoring best.",
  },
};

const similarSlidingWindowEpisode = {
  problem: minimumWindow,
  title: "Minimum Window Substring window-validity breakthrough",
  summary:
    "On Minimum Window Substring, the learner successfully separated window expansion from the repeated left-boundary shrink step and used window validity before recording the best range.",
  outcome: "resolved" as const,
  tags: minimumWindow.tags,
};

function forbiddenExcept(allowed: ToolName[]) {
  const allowedSet = new Set(allowed);
  return allTools.filter((tool) => !allowedSet.has(tool));
}

function savedPreferenceMarker(label: string): IntegrationMarker {
  return {
    label,
    value: "Preference saved|已保存|已经记下|记住了|长期记忆",
    match: "regex",
    source: "note_memory result",
  };
}

function handbookMarker(label: string): IntegrationMarker {
  return {
    label,
    value: "复习手册",
    match: "case_insensitive_substring",
    source: "save_knowledge_note result",
  };
}

function actualOutput3Marker(): IntegrationMarker {
  return {
    label: "actual output 3",
    value:
      "(actual|实际|输出|得到|结果)[^0-9]{0,16}3|3[^0-9]{0,16}(actual|实际|输出|得到|结果)",
    match: "regex",
    source: "run_current_code replay result",
  };
}

function caseItem(
  item: Omit<
    TrajectoryCase,
    "intentStyle" | "limitations" | "humanReviewStatus"
  > & {
    limitations?: string[];
  },
): TrajectoryCase {
  return {
    ...item,
    intentStyle: "natural_intent",
    limitations: item.limitations ?? defaultLimitations,
    humanReviewStatus: "approved",
  };
}

const cases: TrajectoryCase[] = [
  caseItem({
    caseId: "traj-v2-natural-concept-binary-mid",
    category: "concept_question_no_tool",
    userMessage: "mid 比 target 小，为什么 left 要往右？我有点绕。",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    expectedTools: [],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: allTools,
    orderedSubsequence: [],
    integrationMarkers: [],
    notes: "Pure concept question; no fresh evidence or memory lookup requested.",
  }),
  caseItem({
    caseId: "traj-v2-natural-concept-two-sum-complement",
    category: "concept_question_no_tool",
    userMessage: "Two Sum 为啥总说看 complement？我脑子里还是想先排序。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: [],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: allTools,
    orderedSubsequence: [],
    integrationMarkers: [],
    notes: "Concept explanation should come from problem context without tools.",
  }),
  caseItem({
    caseId: "traj-v2-natural-concept-window-left",
    category: "concept_question_no_tool",
    userMessage: "滑窗里的 left 到底指啥？我老把它当重复字符位置。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: [],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: allTools,
    orderedSubsequence: [],
    integrationMarkers: [],
    notes: "No concrete run or prior-history request is present.",
  }),
  caseItem({
    caseId: "traj-v2-natural-concept-insert-return-left",
    category: "concept_question_no_tool",
    userMessage: "Search Insert 结束后，答案为什么落在 left 这个边界，不是 right 那边？",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    expectedTools: [],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: allTools,
    orderedSubsequence: [],
    integrationMarkers: [],
    notes: "Binary-search invariant explanation should not need a tool.",
  }),
  caseItem({
    caseId: "traj-v2-natural-concept-duplicate-outside-window",
    category: "concept_question_no_tool",
    userMessage: "重复字符都跑到窗口左边了，为什么不能还更新 left？",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: [],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: allTools,
    orderedSubsequence: [],
    integrationMarkers: [],
    notes: "Stale duplicate concept; the user is not asking to inspect history.",
  }),
  caseItem({
    caseId: "traj-v2-natural-run-abba-uncertain",
    category: "run_case_requires_run_code",
    userMessage: "abba 这组我手算不稳，当前代码到底会吐多少？",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    expectedTools: ["run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["run_current_code"]),
    orderedSubsequence: ["run_current_code"],
    integrationMarkers: [actualOutput3Marker()],
    notes: "Natural request for fresh execution evidence on an existing replay fixture.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
  caseItem({
    caseId: "traj-v2-natural-run-two-sum-nonclassic",
    category: "run_case_requires_run_code",
    userMessage: "[3,2,4] target 6 我感觉不该返回前两个，帮我看实际结果。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [twoSumSearchTest],
    expectedTools: ["run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["run_current_code"]),
    orderedSubsequence: ["run_current_code"],
    integrationMarkers: [
      {
        label: "actual hardcoded pair",
        value: "[0,1]",
        match: "compact_substring",
        source: "run_current_code replay result",
      },
    ],
    notes: "The user asks for observed behavior, not a static explanation.",
    runCodeReplayFixtureId: "review-v1-two-sum-hardcoded-no-search",
  }),
  caseItem({
    caseId: "traj-v2-natural-run-search-insert-target2",
    category: "run_case_requires_run_code",
    userMessage: "target=2 这里我和程序对不上，帮我确认输出。",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [searchInsertMiddleTest],
    expectedTools: ["run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["run_current_code"]),
    orderedSubsequence: ["run_current_code"],
    integrationMarkers: [
      {
        label: "actual output 2",
        value:
          "(actual|实际|输出|得到|结果)[^0-9]{0,16}2|2[^0-9]{0,16}(actual|实际|输出|得到|结果)",
        match: "regex",
        source: "run_current_code replay result",
      },
    ],
    notes: "Concrete case verification should call run_current_code.",
    runCodeReplayFixtureId: "review-v1-search-insert-off-by-one-boundary",
  }),
  caseItem({
    caseId: "traj-v2-natural-run-abba-window-pullback",
    category: "run_case_requires_run_code",
    userMessage: "这个 abba 会不会把窗口拉回去？我想看现在跑出来啥。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    expectedTools: ["run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["run_current_code"]),
    orderedSubsequence: ["run_current_code"],
    integrationMarkers: [actualOutput3Marker()],
    notes: "Short anxious wording still asks for execution evidence.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
  caseItem({
    caseId: "traj-v2-natural-run-two-sum-suspicious",
    category: "run_case_requires_run_code",
    userMessage: "这份 Two Sum 好像只是碰巧过样例，3,2,4 那组结果看一下。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [twoSumSearchTest],
    expectedTools: ["run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["run_current_code"]),
    orderedSubsequence: ["run_current_code"],
    integrationMarkers: [
      {
        label: "actual hardcoded pair",
        value: "[0,1]",
        match: "compact_substring",
        source: "run_current_code replay result",
      },
    ],
    notes: "The phrasing is natural and asks to observe current code behavior.",
    runCodeReplayFixtureId: "review-v1-two-sum-hardcoded-no-search",
  }),
  caseItem({
    caseId: "traj-v2-natural-history-binary-return",
    category: "history_question_requires_memory_tool",
    userMessage: "二分返回位置这里，我是不是以前也栽过？",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    memorySeed: { mistakeFacts: [memoryFacts.binaryReturn] },
    expectedTools: ["past_mistake_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["past_mistake_recall"]),
    orderedSubsequence: ["past_mistake_recall"],
    integrationMarkers: [
      {
        label: "seeded binary mistake",
        value: "binary_search_return_off_by_one",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
      {
        label: "return shift evidence",
        value: "left + 1",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
    ],
    notes: "The user explicitly asks for prior mistake evidence.",
  }),
  caseItem({
    caseId: "traj-v2-natural-history-sliding-left",
    category: "history_question_requires_memory_tool",
    userMessage: "left 回退这个，是不是我之前那个滑窗毛病？",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    memorySeed: { mistakeFacts: [memoryFacts.slidingLeft] },
    expectedTools: ["past_mistake_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["past_mistake_recall"]),
    orderedSubsequence: ["past_mistake_recall"],
    integrationMarkers: [
      {
        label: "seeded stale duplicate",
        value: "stale_duplicate_boundary",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
    ],
    notes: "The user asks whether this resembles prior history.",
  }),
  caseItem({
    caseId: "traj-v2-natural-history-dp-transition",
    category: "history_question_requires_memory_tool",
    userMessage: "DP 这个状态只看一个前驱，是不是我以前也漏过另一个转移分支？",
    problem: interleavingString,
    language: "Python",
    code: pythonInterleavingSinglePredecessor,
    selectedTests: [],
    memorySeed: { mistakeFacts: [memoryFacts.dpTransition] },
    expectedTools: ["past_mistake_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["past_mistake_recall"]),
    orderedSubsequence: ["past_mistake_recall"],
    integrationMarkers: [
      {
        label: "seeded DP transition mistake",
        value: "DP state transition",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
    ],
    notes: "A concrete DP transition mistake requires past_mistake_recall.",
  }),
  caseItem({
    caseId: "traj-v2-natural-history-api-confusion",
    category: "history_question_requires_memory_tool",
    userMessage: "Python 这些容器 API，我之前是不是也记混过？",
    problem: twoSum,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    memorySeed: { mistakeFacts: [memoryFacts.apiConfusion] },
    expectedTools: ["past_mistake_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["past_mistake_recall"]),
    orderedSubsequence: ["past_mistake_recall"],
    integrationMarkers: [
      {
        label: "seeded API confusion",
        value: "python_container_api_confusion",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
    ],
    notes: "The history target is memory evidence, not a fresh API lookup.",
  }),
  caseItem({
    caseId: "traj-v2-natural-history-similar-problem",
    category: "history_question_requires_memory_tool",
    userMessage: "我以前做过和这道滑窗类似的题吗？当时抓住的核心是什么？",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    memorySeed: {
      mistakeFacts: [],
      problemEpisodes: [similarSlidingWindowEpisode],
    },
    expectedTools: ["past_problem_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["past_problem_recall"]),
    orderedSubsequence: ["past_problem_recall"],
    integrationMarkers: [
      {
        label: "seeded similar problem",
        value: "Minimum Window Substring",
        match: "case_insensitive_substring",
        source: "seeded review episode",
      },
    ],
    notes: "A prior-problem/success question requires past_problem_recall only.",
  }),
  caseItem({
    caseId: "traj-v2-natural-api-deque-for-bfs",
    category: "api_question_requires_lookup_api_reference",
    userMessage: "BFS 队列最小写法我一下想不起来。",
    problem: levelOrder,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    expectedTools: ["lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept(["lookup_api_reference", "save_knowledge_note"]),
    orderedSubsequence: ["lookup_api_reference"],
    integrationMarkers: [
      {
        label: "deque API",
        value: "collections.deque",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "API syntax question; save_knowledge_note is optional because current Coach policy may capture reusable syntax.",
  }),
  caseItem({
    caseId: "traj-v2-natural-api-heapq-maxheap",
    category: "api_question_requires_lookup_api_reference",
    userMessage: "Python 堆默认是小根吧？最大堆怎么临时写？",
    problem: kthLargest,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    expectedTools: ["lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept(["lookup_api_reference", "save_knowledge_note"]),
    orderedSubsequence: ["lookup_api_reference"],
    integrationMarkers: [
      {
        label: "heapq max heap trick",
        value: "heapq.heappush",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "Small API reminder, not a request to run code.",
  }),
  caseItem({
    caseId: "traj-v2-natural-api-cpp-unordered-map",
    category: "api_question_requires_lookup_api_reference",
    userMessage: "C++ Two Sum 里 map 查 key 存不存在怎么写来着？",
    problem: twoSum,
    language: "C++",
    code: cppTwoSumPlaceholder,
    selectedTests: [],
    expectedTools: ["lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept(["lookup_api_reference", "save_knowledge_note"]),
    orderedSubsequence: ["lookup_api_reference"],
    integrationMarkers: [
      {
        label: "unordered_map existence",
        value: "seen.count",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "C++ API lookup should use the local KB.",
  }),
  caseItem({
    caseId: "traj-v2-natural-api-cpp-priority-queue",
    category: "api_question_requires_lookup_api_reference",
    userMessage: "priority_queue 最小堆那个声明我又卡住了。",
    problem: kthLargest,
    language: "C++",
    code: cppHeapPlaceholder,
    selectedTests: [],
    expectedTools: ["lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept(["lookup_api_reference", "save_knowledge_note"]),
    orderedSubsequence: ["lookup_api_reference"],
    integrationMarkers: [
      {
        label: "cpp min heap comparator",
        value: "greater<int>",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "C++ STL reminder should not call run_current_code.",
  }),
  caseItem({
    caseId: "traj-v2-natural-api-counter-defaultdict",
    category: "api_question_requires_lookup_api_reference",
    userMessage: "计数窗口里 Counter/defaultdict 的区别我想快过一眼。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: ["lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept(["lookup_api_reference", "save_knowledge_note"]),
    orderedSubsequence: ["lookup_api_reference"],
    integrationMarkers: [
      {
        label: "collections counter default",
        value: "Counter",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "The local collections KB covers Counter/defaultdict/deque.",
  }),
  caseItem({
    caseId: "traj-v2-natural-preference-short-first",
    category: "preference_requires_note_memory",
    userMessage: "以后先给我一个下一步，解释短点。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: ["note_memory"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory"]),
    orderedSubsequence: ["note_memory"],
    integrationMarkers: [savedPreferenceMarker("saved short-next-step preference")],
    notes: "Natural preference wording without naming the tool.",
  }),
  caseItem({
    caseId: "traj-v2-natural-preference-english-headings",
    category: "preference_requires_note_memory",
    userMessage: "之后我英文问的话，标题也用英文就行。",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    expectedTools: ["note_memory"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory"]),
    orderedSubsequence: ["note_memory"],
    integrationMarkers: [savedPreferenceMarker("saved language-heading preference")],
    notes: "This is a durable output preference.",
  }),
  caseItem({
    caseId: "traj-v2-natural-preference-step-through",
    category: "preference_requires_note_memory",
    userMessage: "我更吃手动走例子那种，别一上来贴代码。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: ["note_memory"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory"]),
    orderedSubsequence: ["note_memory"],
    integrationMarkers: [savedPreferenceMarker("saved walkthrough preference")],
    notes: "Teaching style preference should be saved through note_memory.",
  }),
  caseItem({
    caseId: "traj-v2-natural-preference-no-full-solution",
    category: "preference_requires_note_memory",
    userMessage: "后面先别直接给完整解，除非我明确说要。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: ["note_memory"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory"]),
    orderedSubsequence: ["note_memory"],
    integrationMarkers: [savedPreferenceMarker("saved no-full-solution preference")],
    notes: "A durable coaching boundary preference, not a one-off safety request.",
  }),
  caseItem({
    caseId: "traj-v2-natural-preference-python-default",
    category: "preference_requires_note_memory",
    userMessage: "我默认还是用 Python，C++ 等我特别说再切。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: ["note_memory"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory"]),
    orderedSubsequence: ["note_memory"],
    integrationMarkers: [savedPreferenceMarker("saved language preference")],
    notes: "Preference save should not call API or runner tools.",
  }),
  caseItem({
    caseId: "traj-v2-natural-save-heapq-note",
    category: "knowledge_note_requires_save_knowledge_note",
    userMessage: "heapq 这个最大堆写法我老忘，放复习里吧。",
    problem: kthLargest,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    expectedTools: ["save_knowledge_note"],
    expectedToolGroups: [],
    optionalTools: ["lookup_api_reference"],
    forbiddenTools: forbiddenExcept(["save_knowledge_note", "lookup_api_reference"]),
    orderedSubsequence: ["save_knowledge_note"],
    integrationMarkers: [handbookMarker("heapq note saved")],
    notes: "Explicit reusable-knowledge capture requires save_knowledge_note.",
  }),
  caseItem({
    caseId: "traj-v2-natural-save-deque-note",
    category: "knowledge_note_requires_save_knowledge_note",
    userMessage: "deque 队列最小模板也给我留到手册里。",
    problem: levelOrder,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    expectedTools: ["save_knowledge_note"],
    expectedToolGroups: [],
    optionalTools: ["lookup_api_reference"],
    forbiddenTools: forbiddenExcept(["save_knowledge_note", "lookup_api_reference"]),
    orderedSubsequence: ["save_knowledge_note"],
    integrationMarkers: [handbookMarker("deque note saved")],
    notes: "The user asks for a handbook note, not just a one-off answer.",
  }),
  caseItem({
    caseId: "traj-v2-natural-save-cpp-priority-queue-note",
    category: "knowledge_note_requires_save_knowledge_note",
    userMessage: "C++ 最小堆声明老错，这个以后也放手册。",
    problem: kthLargest,
    language: "C++",
    code: cppHeapPlaceholder,
    selectedTests: [],
    expectedTools: ["save_knowledge_note"],
    expectedToolGroups: [],
    optionalTools: ["lookup_api_reference"],
    forbiddenTools: forbiddenExcept(["save_knowledge_note", "lookup_api_reference"]),
    orderedSubsequence: ["save_knowledge_note"],
    integrationMarkers: [handbookMarker("cpp priority_queue note saved")],
    notes: "Reusable C++ STL syntax should be saved to the Handbook.",
  }),
  caseItem({
    caseId: "traj-v2-natural-save-window-template-note",
    category: "knowledge_note_requires_save_knowledge_note",
    userMessage: "滑窗那个 left 只往前的模板，我想之后复习能看到。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: ["save_knowledge_note"],
    expectedToolGroups: [],
    optionalTools: ["lookup_api_reference"],
    forbiddenTools: forbiddenExcept(["save_knowledge_note", "lookup_api_reference"]),
    orderedSubsequence: ["save_knowledge_note"],
    integrationMarkers: [handbookMarker("sliding-window note saved")],
    notes: "Algorithm-template capture belongs in the Handbook, not L2 preference memory.",
  }),
  caseItem({
    caseId: "traj-v2-natural-practice-sliding-window",
    category: "practice_request_requires_find_practice_problem",
    userMessage: "这个滑窗我想再刷两道差不多的，别太多。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: ["find_practice_problem"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["find_practice_problem"]),
    orderedSubsequence: ["find_practice_problem"],
    integrationMarkers: [
      {
        label: "sliding-window recommendation",
        value:
          "Minimum Size Subarray Sum|Minimum Window Substring|Substring with Concatenation|Longest Substring",
        match: "regex",
        source: "find_practice_problem result",
      },
    ],
    notes: "Practice request should use the controlled catalog.",
  }),
  caseItem({
    caseId: "traj-v2-natural-practice-binary-boundary",
    category: "practice_request_requires_find_practice_problem",
    userMessage: "二分边界再给我两题巩固下。",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    expectedTools: ["find_practice_problem"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["find_practice_problem"]),
    orderedSubsequence: ["find_practice_problem"],
    integrationMarkers: [
      {
        label: "binary-search recommendation",
        value:
          "Search Insert Position|Search a 2D Matrix|Find Peak Element|Search in Rotated Sorted Array|Find Minimum in Rotated Sorted Array",
        match: "regex",
        source: "find_practice_problem result",
      },
    ],
    notes: "The user asks for same-pattern reinforcement.",
  }),
  caseItem({
    caseId: "traj-v2-natural-practice-hashmap",
    category: "practice_request_requires_find_practice_problem",
    userMessage: "HashMap 这种我想再来几道，先简单点。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: ["find_practice_problem"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["find_practice_problem"]),
    orderedSubsequence: ["find_practice_problem"],
    integrationMarkers: [
      {
        label: "hashmap recommendation",
        value: "Ransom Note|Isomorphic Strings|Word Pattern|Valid Anagram|Two Sum",
        match: "regex",
        source: "find_practice_problem result",
      },
    ],
    notes: "Recommendation should be metadata-only and catalog-backed.",
  }),
  caseItem({
    caseId: "traj-v2-natural-hint-two-sum-small",
    category: "hint_request_requires_algorithm_hint",
    userMessage: "Two Sum 给点提示就好，别直接答案。",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [],
    expectedTools: ["get_algorithm_hint"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["get_algorithm_hint"]),
    orderedSubsequence: ["get_algorithm_hint"],
    integrationMarkers: [
      {
        label: "two-sum hint",
        value: "hashmap|dict|target - num|complement",
        match: "regex",
        source: "get_algorithm_hint result",
      },
    ],
    notes: "Hint request should use the persisted hint progression tool.",
  }),
  caseItem({
    caseId: "traj-v2-natural-hint-search-insert",
    category: "hint_request_requires_algorithm_hint",
    userMessage: "Search Insert 我卡住了，给我一小步提示。",
    problem: searchInsert,
    language: "Python",
    code: pythonSearchInsertOffByOne,
    selectedTests: [],
    expectedTools: ["get_algorithm_hint"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["get_algorithm_hint"]),
    orderedSubsequence: ["get_algorithm_hint"],
    integrationMarkers: [
      {
        label: "search-insert hint",
        value: "first index|>= target|lower-bound|lower bound",
        match: "regex",
        source: "get_algorithm_hint result",
      },
    ],
    notes: "A gradual hint is expected, not run_current_code or a full solution.",
  }),
  caseItem({
    caseId: "traj-v2-natural-hint-longest-substring",
    category: "hint_request_requires_algorithm_hint",
    userMessage: "最长不重复子串我没思路，先给提示，不要完整代码。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [],
    expectedTools: ["get_algorithm_hint"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["get_algorithm_hint"]),
    orderedSubsequence: ["get_algorithm_hint"],
    integrationMarkers: [
      {
        label: "longest-substring hint",
        value: "sliding window|last seen|left pointer|dict",
        match: "regex",
        source: "get_algorithm_hint result",
      },
    ],
    notes: "The user explicitly asks for a hint and not full code.",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-deque-run-abba",
    category: "multi_step_tool_chain",
    userMessage: "BFS 队列写法想不起来；顺手也看下 abba 现在跑多少。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    expectedTools: ["lookup_api_reference", "run_current_code"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept([
      "lookup_api_reference",
      "run_current_code",
      "save_knowledge_note",
    ]),
    orderedSubsequence: ["lookup_api_reference", "run_current_code"],
    integrationMarkers: [
      {
        label: "deque API",
        value: "collections.deque",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
      actualOutput3Marker(),
    ],
    notes: "Natural combined API and execution request.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-history-run-abba",
    category: "multi_step_tool_chain",
    userMessage:
      "我以前做过哪些类似滑窗题、又常犯过什么错？再确认下 abba 当前输出。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    memorySeed: {
      mistakeFacts: [memoryFacts.slidingLeft],
      problemEpisodes: [similarSlidingWindowEpisode],
    },
    expectedTools: [
      "past_problem_recall",
      "past_mistake_recall",
      "run_current_code",
    ],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept([
      "past_problem_recall",
      "past_mistake_recall",
      "run_current_code",
    ]),
    orderedSubsequence: [
      "past_problem_recall",
      "past_mistake_recall",
      "run_current_code",
    ],
    integrationMarkers: [
      {
        label: "seeded similar problem",
        value: "Minimum Window Substring",
        match: "case_insensitive_substring",
        source: "seeded review episode",
      },
      {
        label: "seeded stale duplicate",
        value: "stale_duplicate_boundary",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
      actualOutput3Marker(),
    ],
    notes:
      "This compound request is the only case that requires both atomic history tools before fresh run evidence.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-preference-run",
    category: "multi_step_tool_chain",
    userMessage: "以后短一点；另外 3,2,4 target 6 这份代码到底返回啥？",
    problem: twoSum,
    language: "Python",
    code: pythonTwoSumHardcoded,
    selectedTests: [twoSumSearchTest],
    expectedTools: ["note_memory", "run_current_code"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept(["note_memory", "run_current_code"]),
    orderedSubsequence: ["note_memory", "run_current_code"],
    integrationMarkers: [
      savedPreferenceMarker("saved brevity preference"),
      {
        label: "actual hardcoded pair",
        value: "[0,1]",
        match: "compact_substring",
        source: "run_current_code replay result",
      },
    ],
    notes: "Combined preference save and execution check; order follows user wording.",
    runCodeReplayFixtureId: "review-v1-two-sum-hardcoded-no-search",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-api-save",
    category: "multi_step_tool_chain",
    userMessage: "deque 又忘了，这种语法以后最好能在复习手册里看到。",
    problem: levelOrder,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    expectedTools: ["lookup_api_reference", "save_knowledge_note"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept([
      "lookup_api_reference",
      "save_knowledge_note",
    ]),
    orderedSubsequence: ["lookup_api_reference", "save_knowledge_note"],
    integrationMarkers: [
      {
        label: "deque API",
        value: "collections.deque",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
      handbookMarker("deque note saved"),
    ],
    notes: "Reusable API knowledge should be looked up and saved.",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-history-api",
    category: "multi_step_tool_chain",
    userMessage: "我是不是又把 heap/deque 搞混？顺便提醒下 deque 队列写法。",
    problem: levelOrder,
    language: "Python",
    code: pythonPlaceholder,
    selectedTests: [],
    memorySeed: { mistakeFacts: [memoryFacts.apiConfusion] },
    expectedTools: ["past_mistake_recall", "lookup_api_reference"],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept([
      "lookup_api_reference",
      "save_knowledge_note",
      "past_mistake_recall",
    ]),
    orderedSubsequence: ["past_mistake_recall", "lookup_api_reference"],
    integrationMarkers: [
      {
        label: "seeded API confusion",
        value: "python_container_api_confusion",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
      {
        label: "deque API",
        value: "collections.deque",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
    ],
    notes: "History and local API reference are both needed.",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-history-api-run",
    category: "multi_step_tool_chain",
    userMessage: "这滑窗 bug 像老问题；先提醒我 deque 写法，再看 abba 当前输出。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    memorySeed: { mistakeFacts: [memoryFacts.slidingLeft] },
    expectedTools: [
      "past_mistake_recall",
      "lookup_api_reference",
      "run_current_code",
    ],
    expectedToolGroups: [],
    optionalTools: ["save_knowledge_note"],
    forbiddenTools: forbiddenExcept([
      "lookup_api_reference",
      "run_current_code",
      "save_knowledge_note",
      "past_mistake_recall",
    ]),
    orderedSubsequence: [
      "past_mistake_recall",
      "lookup_api_reference",
      "run_current_code",
    ],
    integrationMarkers: [
      {
        label: "seeded stale duplicate",
        value: "stale_duplicate_boundary",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
      {
        label: "deque API",
        value: "collections.deque",
        match: "case_insensitive_substring",
        source: "lookup_api_reference result",
      },
      actualOutput3Marker(),
    ],
    notes: "Three-step chain stays within CHAT_MAX_TOOL_ITERATIONS.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
  caseItem({
    caseId: "traj-v2-natural-multi-debug-run-then-history",
    category: "multi_step_tool_chain",
    userMessage: "我这个代码到底错在哪？先跑一下，再看是不是我以前那种 left 回退。",
    problem: longestSubstring,
    language: "Python",
    code: pythonLongestSubstringLeftRegression,
    selectedTests: [abbaTest],
    memorySeed: { mistakeFacts: [memoryFacts.slidingLeft] },
    expectedTools: ["run_current_code", "past_mistake_recall"],
    expectedToolGroups: [],
    optionalTools: [],
    forbiddenTools: forbiddenExcept([
      "run_current_code",
      "past_mistake_recall",
    ]),
    orderedSubsequence: ["run_current_code", "past_mistake_recall"],
    integrationMarkers: [
      actualOutput3Marker(),
      {
        label: "seeded stale duplicate",
        value: "stale_duplicate_boundary",
        match: "case_insensitive_substring",
        source: "seeded L2 mistake fact",
      },
    ],
    notes:
      "Covers the natural debug-current-code scenario: execute current code first, then compare with seeded mistake history.",
    runCodeReplayFixtureId: "review-v1-longest-substring-duplicate-window-bug",
  }),
];

const dataset = {
  datasetVersion: "chat-trajectory-v2",
  name: "trajectory-v2-natural-intent",
  status: "human_approved",
  description:
    "Human-approved natural-intent Chat trajectory dataset for P2 gap closure. It contains 35 single-intent cases plus 7 multi-step cases and distinguishes atomic past-problem from past-mistake recall.",
  cases,
};

const outputPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "trajectory-v2.json",
);

writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(`Wrote ${cases.length} cases to ${outputPath}`);
