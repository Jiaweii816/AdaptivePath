import type {
  CampaignSkeleton,
  CurriculumAssets,
  CurriculumEdge,
  CurriculumGraph,
  CurriculumSlotRole,
  LearningNode,
  LearningNodeKind,
  LearningNodeProblem,
} from "./types";

const CURRICULUM_ID = "hot150-campaign-curriculum";
const CURRICULUM_VERSION = 2;

const ADVANCE_ROLES = ["advance", "target", "remedial"] as const;
const TARGET_ROLES = ["target", "remedial"] as const;
const PROBE_ROLES = ["target", "remedial", "probe"] as const;
const NON_TRANSFERABLE_ROLES = ["remedial", "probe"] as const;

function problems(
  slugs: readonly string[],
  kind: LearningNodeKind,
): LearningNodeProblem[] {
  return slugs.map((problemSlug, index) => {
    let slotRoles: readonly CurriculumSlotRole[];
    if (kind === "non_transferable") slotRoles = NON_TRANSFERABLE_ROLES;
    else if (index < 2) slotRoles = ADVANCE_ROLES;
    else if (index === slugs.length - 1) slotRoles = PROBE_ROLES;
    else slotRoles = TARGET_ROLES;
    return { problemSlug, orderInNode: index + 1, slotRoles };
  });
}

function node(args: Omit<LearningNode, "primaryProblems"> & {
  primaryProblems: readonly string[];
}): LearningNode {
  return {
    ...args,
    primaryProblems: problems(args.primaryProblems, args.kind),
  };
}

/** Exact static projection of memory-bank/curriculum_graph_v1.md. */
export const campaignLearningNodes: readonly LearningNode[] = [
  node({
    nodeId: "N1",
    label: { en: "In-place Arrays and Write Pointers", zh: "原地数组与写指针" },
    description: "Separate read and write positions while using the array itself to carry confirmed or encoded intermediate state.",
    difficulty: 1,
    kind: "transferable",
    primaryProblems: [
      "merge-sorted-array", "remove-element", "remove-duplicates-from-sorted-array",
      "remove-duplicates-from-sorted-array-ii", "rotate-array", "rotate-image",
      "set-matrix-zeroes", "game-of-life", "product-of-array-except-self",
    ],
  }),
  node({
    nodeId: "N2",
    label: { en: "Hash Mapping and Counting", zh: "哈希映射与计数" },
    description: "Choose stable keys so membership, complement, and frequency state replace repeated enumeration.",
    difficulty: 1,
    kind: "transferable",
    primaryProblems: [
      "ransom-note", "isomorphic-strings", "word-pattern", "valid-anagram",
      "group-anagrams", "two-sum", "happy-number", "contains-duplicate-ii",
      "longest-consecutive-sequence", "valid-sudoku",
    ],
  }),
  node({
    nodeId: "N3",
    label: { en: "Simulation and Boundary Handling", zh: "模拟与边界处理" },
    description: "Implement problem-specific rules and boundary transitions without asserting a transferable mastery mechanism.",
    difficulty: 2,
    kind: "non_transferable",
    primaryProblems: [
      "roman-to-integer", "integer-to-roman", "length-of-last-word",
      "longest-common-prefix", "reverse-words-in-a-string", "zigzag-conversion",
      "find-the-index-of-the-first-occurrence-in-a-string", "text-justification", "spiral-matrix",
    ],
  }),
  node({
    nodeId: "N4",
    label: { en: "Stacks and Expression Evaluation", zh: "栈与表达式求值" },
    description: "Keep the most recent unfinished element at the stack top and make closure transitions explicit.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "valid-parentheses", "simplify-path", "min-stack",
      "evaluate-reverse-polish-notation", "basic-calculator",
    ],
  }),
  node({
    nodeId: "N5",
    label: { en: "Bit Manipulation", zh: "位运算" },
    description: "Use representation-specific bit operations without treating the collection as one transferable progression node.",
    difficulty: 2,
    kind: "non_transferable",
    primaryProblems: [
      "add-binary", "reverse-bits", "number-of-1-bits", "single-number",
      "single-number-ii", "bitwise-and-of-numbers-range",
    ],
  }),
  node({
    nodeId: "N6",
    label: { en: "Mathematics and Numeric Methods", zh: "数学与数值" },
    description: "Apply problem-specific numeric facts without projecting a shared Campaign mastery state.",
    difficulty: 2,
    kind: "non_transferable",
    primaryProblems: [
      "palindrome-number", "plus-one", "factorial-trailing-zeroes",
      "sqrtx", "powx-n", "max-points-on-a-line",
    ],
  }),
  node({
    nodeId: "N7",
    label: { en: "Sorted Scans and Greedy Decisions", zh: "排序扫描与贪心决策" },
    description: "Maintain an updateable optimum while a sorted or one-way scan makes local decisions globally safe.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "majority-element", "best-time-to-buy-and-sell-stock", "best-time-to-buy-and-sell-stock-ii",
      "jump-game", "jump-game-ii", "h-index", "gas-station", "candy",
      "summary-ranges", "merge-intervals", "insert-interval", "minimum-number-of-arrows-to-burst-balloons",
    ],
  }),
  node({
    nodeId: "N8",
    label: { en: "Converging Pointers", zh: "对撞指针" },
    description: "Use monotonicity to decide which endpoint can move while safely discarding combinations.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "valid-palindrome", "is-subsequence", "two-sum-ii-input-array-is-sorted",
      "container-with-most-water", "3sum", "trapping-rain-water",
    ],
  }),
  node({
    nodeId: "N9",
    label: { en: "Sliding Windows", zh: "滑动窗口" },
    description: "Expand, then repeatedly contract until the window invariant is restored.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "minimum-size-subarray-sum", "longest-substring-without-repeating-characters",
      "substring-with-concatenation-of-all-words", "minimum-window-substring",
    ],
  }),
  node({
    nodeId: "N10",
    label: { en: "Binary Search Boundary Invariants", zh: "二分查找与边界不变量" },
    description: "Keep interval definition, loop condition, and boundary updates mutually consistent.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "search-insert-position", "search-a-2d-matrix", "find-peak-element",
      "search-in-rotated-sorted-array", "find-first-and-last-position-of-element-in-sorted-array",
      "find-minimum-in-rotated-sorted-array", "median-of-two-sorted-arrays",
    ],
  }),
  node({
    nodeId: "N11",
    label: { en: "Linked-list Pointer Operations", zh: "链表指针操作" },
    description: "Use sentinels and preserve successors before rewiring local links.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "linked-list-cycle", "add-two-numbers", "merge-two-sorted-lists",
      "copy-list-with-random-pointer", "reverse-linked-list-ii", "reverse-nodes-in-k-group",
      "remove-nth-node-from-end-of-list", "remove-duplicates-from-sorted-list-ii",
      "rotate-list", "partition-list", "sort-list",
    ],
  }),
  node({
    nodeId: "N12",
    label: { en: "Tree Recursion and Subproblem Design", zh: "树的递归与子问题划分" },
    description: "Define what a recursive subtree call returns so its parent can compose the answer.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "maximum-depth-of-binary-tree", "same-tree", "invert-binary-tree", "symmetric-tree",
      "path-sum", "sum-root-to-leaf-numbers", "binary-tree-maximum-path-sum",
      "count-complete-tree-nodes", "lowest-common-ancestor-of-a-binary-tree",
      "construct-binary-tree-from-preorder-and-inorder-traversal",
      "construct-binary-tree-from-inorder-and-postorder-traversal",
      "flatten-binary-tree-to-linked-list", "construct-quad-tree",
    ],
  }),
  node({
    nodeId: "N13",
    label: { en: "Tree Traversal Order", zh: "树的遍历顺序（层序与中序）" },
    description: "Choose level or inorder traversal according to the structural property the order exposes.",
    difficulty: 2,
    kind: "transferable",
    primaryProblems: [
      "populating-next-right-pointers-in-each-node-ii", "binary-tree-right-side-view",
      "average-of-levels-in-binary-tree", "binary-tree-level-order-traversal",
      "binary-tree-zigzag-level-order-traversal", "validate-binary-search-tree",
      "kth-smallest-element-in-a-bst", "minimum-absolute-difference-in-bst",
      "convert-sorted-array-to-binary-search-tree",
    ],
  }),
  node({
    nodeId: "N14",
    label: { en: "Designed Data Structures", zh: "设计类数据结构" },
    description: "Combine representations so every public operation preserves state and its promised complexity.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "insert-delete-getrandom-o1", "lru-cache", "implement-trie-prefix-tree",
      "design-add-and-search-words-data-structure", "binary-search-tree-iterator",
    ],
  }),
  node({
    nodeId: "N15",
    label: { en: "Grid Search and State Marking", zh: "网格上的搜索与状态标记" },
    description: "Distinguish persistent visitation from reversible path marking while exploring grid neighbors.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "number-of-islands", "surrounded-regions", "word-search",
      "word-search-ii", "snakes-and-ladders",
    ],
  }),
  node({
    nodeId: "N16",
    label: { en: "Backtracking and State Restoration", zh: "回溯与状态恢复" },
    description: "Choose, recurse, undo, and prune without leaking branch-local state.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "letter-combinations-of-a-phone-number", "combinations", "permutations",
      "combination-sum", "n-queens-ii", "generate-parentheses",
    ],
  }),
  node({
    nodeId: "N17",
    label: { en: "Graph Traversal and Topological Ordering", zh: "图遍历与拓扑排序" },
    description: "Build explicit adjacency state and advance visited or zero-indegree frontiers.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "clone-graph", "evaluate-division", "course-schedule", "course-schedule-ii",
      "minimum-genetic-mutation", "word-ladder",
    ],
  }),
  node({
    nodeId: "N18",
    label: { en: "Heaps and Top-K", zh: "堆与 Top-K" },
    description: "Retain only currently eligible answer candidates, using the heap top as the eviction boundary.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "kth-largest-element-in-an-array", "ipo", "find-k-pairs-with-smallest-sums",
      "find-median-from-data-stream", "merge-k-sorted-lists",
    ],
  }),
  node({
    nodeId: "N19",
    label: { en: "One-dimensional DP State Design", zh: "一维 DP 与状态定义" },
    description: "Keep state meaning, recurrence, and initialization mutually consistent.",
    difficulty: 3,
    kind: "transferable",
    primaryProblems: [
      "climbing-stairs", "house-robber", "word-break", "coin-change",
      "longest-increasing-subsequence", "maximum-subarray", "maximum-sum-circular-subarray",
    ],
  }),
  node({
    nodeId: "N20",
    label: { en: "Two-dimensional Dynamic Programming", zh: "二维 DP" },
    description: "Choose multidimensional state and traversal order so every dependency is available at transition time.",
    difficulty: 4,
    kind: "transferable",
    primaryProblems: [
      "triangle", "minimum-path-sum", "unique-paths-ii", "longest-palindromic-substring",
      "interleaving-string", "edit-distance", "best-time-to-buy-and-sell-stock-iii",
      "best-time-to-buy-and-sell-stock-iv", "maximal-square",
    ],
  }),
] as const;

function edge(
  fromNodeId: string,
  toNodeId: string,
  type: CurriculumEdge["type"],
  rationale: string,
): CurriculumEdge {
  return { fromNodeId, toNodeId, type, rationale };
}

export const campaignCurriculumEdges: readonly CurriculumEdge[] = [
  edge("N12", "N13", "required", "Tree recursion is a hard prerequisite for traversal-order work."),
  edge("N15", "N17", "required", "Grid search establishes the traversal model required for explicit graphs."),
  edge("N19", "N20", "required", "One-dimensional state design is required before multidimensional DP."),
  edge("N1", "N7", "recommended", "In-place scanning provides a base for sorted greedy scans."),
  edge("N1", "N8", "recommended", "Pointer movement builds on explicit array boundaries."),
  edge("N8", "N9", "recommended", "Converging pointers prepare dynamic window movement."),
  edge("N2", "N9", "recommended", "Hash counts commonly maintain window validity."),
  edge("N1", "N10", "recommended", "Array boundary discipline supports binary search invariants."),
  edge("N1", "N11", "recommended", "Explicit update order prepares pointer rewiring."),
  edge("N2", "N14", "recommended", "Keyed lookup is a common designed-structure component."),
  edge("N4", "N14", "recommended", "Stack design is a concrete stateful-structure precursor."),
  edge("N11", "N14", "recommended", "LRU-style structures require safe link operations."),
  edge("N12", "N15", "recommended", "Recursive search transfers naturally to grid neighborhoods."),
  edge("N12", "N16", "recommended", "Backtracking adds restoration to recursive subproblems."),
  edge("N1", "N18", "recommended", "Array selection problems introduce bounded candidate sets."),
  edge("N7", "N19", "recommended", "Greedy/Kadane comparisons sharpen state-definition choices."),
  edge("N10", "N19", "recommended", "Boundary invariants prepare ordered DP transitions."),
] as const;

export const campaignCurriculumGraph: CurriculumGraph = {
  curriculumId: CURRICULUM_ID,
  version: CURRICULUM_VERSION,
  nodes: campaignLearningNodes,
  edges: campaignCurriculumEdges,
};

const TRANSFERABLE_SKELETON_ORDER = [
  "N1", "N2", "N4", "N7", "N8", "N9", "N10", "N11", "N14",
  "N12", "N13", "N15", "N16", "N17", "N18", "N19", "N20",
] as const;

export const genericCampaignSkeleton: CampaignSkeleton = {
  skeletonId: "hot150-general-campaign",
  curriculumId: CURRICULUM_ID,
  curriculumVersion: CURRICULUM_VERSION,
  version: 1,
  mixedWindowDays: 7,
  nodePlans: TRANSFERABLE_SKELETON_ORDER.map((nodeId, index) => ({
    nodeId,
    included: true,
    order: index + 1,
    targetWeek: Math.floor(index / 4) + 1,
    priority: index < 8 ? 3 : index < 14 ? 2 : 1,
    rationale: "Default transferable route ordered by hard gates and recommended prerequisites.",
  })),
};

export const campaignCurriculumAssets: CurriculumAssets = {
  graph: campaignCurriculumGraph,
  skeleton: genericCampaignSkeleton,
};
