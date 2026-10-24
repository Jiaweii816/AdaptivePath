const META_PROBLEM_TOPICS = new Set([
  "top_interview_150",
  "interview_150",
  "hot150",
]);

const PROBLEM_TOPIC_ALIASES: Record<string, string[]> = {
  hashmap: ["hash_map", "hash_table"],
  hash_table: ["hash_map", "hashmap"],
  two_pointers: ["two_pointer"],
  intervals: ["interval"],
  binary_search_tree: ["bst"],
  priority_queue: ["heap"],
  dynamic_programming: ["dp"],
  "1d_dp": ["dynamic_programming", "dp"],
  multidimensional_dp: ["dynamic_programming", "dp"],
};

const ALIASED_MECHANISM_ROOTS: Record<string, string[]> = {
  lower_bound: ["binary_search"],
  upper_bound: ["binary_search"],
  state_transition: ["dynamic_programming", "dp", "1d_dp", "multidimensional_dp"],
  dp_state: ["dynamic_programming", "dp", "1d_dp", "multidimensional_dp"],
};

const FACT_QUALIFIER_TOKENS = new Set([
  "reasoning",
  "mistake",
  "confusion",
  "strength",
  "skill",
]);

const CANONICAL_KEY_QUALIFIER_TOKENS = new Set([
  ...FACT_QUALIFIER_TOKENS,
  "error",
  "issue",
  "pattern",
  "update",
]);

export type CanonicalMechanism = {
  key: string;
  label: {
    en: string;
    zh: string;
  };
  aliases: string[];
  problemTopics: string[];
};

type HistoricalRawMechanismDecision =
  | {
      decision: "canonical";
      key: string;
      requiredTopics?: string[];
    }
  | {
      decision: "drop";
      reason:
        | "blocked_development_noise"
        | "code_shape_only"
        | "vague_non_portable_label"
        | "incompatible_problem_mechanism";
    };

function mechanism(
  key: string,
  en: string,
  zh: string,
  aliases: string[],
  problemTopics: string[],
): CanonicalMechanism {
  return {
    key,
    label: { en, zh },
    aliases: [...new Set([key.replace(/_/g, " "), en, zh, ...aliases])],
    problemTopics,
  };
}

/**
 * Controlled, portable learner mechanisms for the complete Hot-150 domain.
 *
 * This catalog is deliberately smaller than the problem bank: mechanisms are
 * transferable reasoning skills, not one label per problem. It is the shared
 * vocabulary for forward Review writes, historical replay, retrieval aliases,
 * Profile projection, and learner-facing labels.
 */
export const HOT150_CANONICAL_MECHANISMS: CanonicalMechanism[] = [
  mechanism(
    "array_iteration_invariant",
    "array iteration invariant",
    "数组遍历不变量",
    ["scan invariant", "遍历范围"],
    ["array", "string"],
  ),
  mechanism(
    "boundary_indexing",
    "index and boundary reasoning",
    "下标与边界推理",
    ["off by one", "boundary condition", "下标边界", "差一错误"],
    ["array", "string", "two_pointers", "dynamic_programming", "math"],
  ),
  mechanism(
    "in_place_write_order",
    "in-place write order",
    "原地写入顺序",
    ["overwrite safety", "reverse write", "覆盖顺序", "从后写入"],
    ["array", "string", "two_pointers", "matrix", "linked_list"],
  ),
  mechanism(
    "prefix_suffix_accumulation",
    "prefix and suffix accumulation",
    "前后缀累积",
    ["prefix product", "prefix sum", "前缀和", "前后缀"],
    ["array", "string"],
  ),
  mechanism(
    "string_character_normalization",
    "character filtering and normalization",
    "字符过滤与归一化",
    ["alphanumeric filtering", "case normalization", "字符检查", "忽略非字母数字"],
    ["string", "two_pointers"],
  ),
  mechanism(
    "two_pointer_movement_invariant",
    "two-pointer movement invariant",
    "双指针移动不变量",
    ["two pointers", "left right pointers", "双指针", "左右指针移动"],
    ["two_pointers", "array", "string"],
  ),
  mechanism(
    "sliding_window_invariant",
    "sliding-window expand/shrink invariant",
    "滑动窗口扩张与收缩不变量",
    ["window shrink condition", "expand shrink", "滑动窗口", "收缩条件"],
    ["sliding_window", "string", "array"],
  ),
  mechanism(
    "matrix_coordinate_bounds",
    "matrix coordinate and boundary reasoning",
    "矩阵坐标与边界推理",
    ["row column bounds", "grid bounds", "行列边界", "矩阵坐标"],
    ["matrix", "array"],
  ),
  mechanism(
    "hash_map_lookup",
    "hash-map lookup and membership",
    "哈希表查找与成员判断",
    ["hashmap", "hash table", "dictionary lookup", "哈希表", "字典查找"],
    ["hashmap", "hash_table"],
  ),
  mechanism(
    "frequency_counting",
    "frequency counting",
    "频次统计",
    ["counting array", "counter", "计数数组", "频率表"],
    ["hashmap", "hash_table", "array", "string"],
  ),
  mechanism(
    "interval_overlap_merge",
    "interval overlap and merge invariant",
    "区间重叠与合并不变量",
    ["interval merge", "overlap boundary", "区间合并", "重叠边界"],
    ["intervals"],
  ),
  mechanism(
    "stack_state_invariant",
    "stack state invariant",
    "栈状态不变量",
    ["monotonic stack", "operator stack", "栈顶状态", "单调栈"],
    ["stack"],
  ),
  mechanism(
    "linked_list_pointer_rewiring",
    "linked-list pointer rewiring",
    "链表指针重连",
    ["next pointer update", "dummy node", "链表重连", "指针更新顺序"],
    ["linked_list"],
  ),
  mechanism(
    "carry_propagation",
    "carry propagation",
    "进位传递",
    ["digit carry", "carry handling", "逐位进位", "处理进位"],
    ["linked_list", "math", "bit_manipulation"],
  ),
  mechanism(
    "tree_recursive_structure",
    "tree recursive structure",
    "树的递归结构",
    ["subtree recursion", "postorder reasoning", "子树递归", "递归遍历"],
    ["binary_tree", "tree", "dfs"],
  ),
  mechanism(
    "tree_level_order_frontier",
    "tree level-order frontier",
    "树的层序边界",
    ["level order", "bfs level", "层序遍历", "每层队列"],
    ["binary_tree", "tree", "bfs"],
  ),
  mechanism(
    "binary_search_tree_ordering",
    "binary-search-tree ordering invariant",
    "二叉搜索树有序不变量",
    ["bst ordering", "inorder ordering", "BST 有序性", "中序有序"],
    ["binary_search_tree", "bst", "tree"],
  ),
  mechanism(
    "graph_traversal_visited_state",
    "graph traversal visited-state invariant",
    "图遍历的访问状态不变量",
    ["visited set", "cycle detection", "访问标记", "图遍历去重"],
    ["graph", "dfs", "bfs"],
  ),
  mechanism(
    "graph_bfs_frontier",
    "breadth-first frontier expansion",
    "广度优先搜索前沿扩张",
    ["bfs frontier", "level expansion", "BFS 队列", "逐层扩张"],
    ["graph", "bfs"],
  ),
  mechanism(
    "graph_topological_indegree",
    "topological indegree invariant",
    "拓扑排序入度不变量",
    ["kahn algorithm", "indegree queue", "入度队列", "拓扑排序"],
    ["graph", "bfs"],
  ),
  mechanism(
    "trie_path_state",
    "trie path-state preservation",
    "Trie 路径状态保持",
    ["trie insertion", "prefix path", "Trie 插入", "前缀路径"],
    ["trie"],
  ),
  mechanism(
    "trie_terminal_state",
    "trie terminal-word state",
    "Trie 单词终止状态",
    ["is end", "terminal marker", "单词结束标记", "isEnd"],
    ["trie"],
  ),
  mechanism(
    "backtracking_choice_rollback",
    "backtracking choose/explore/rollback invariant",
    "回溯的选择、探索与撤销不变量",
    ["choice rollback", "pruning", "做选择撤销选择", "回溯剪枝"],
    ["backtracking"],
  ),
  mechanism(
    "divide_and_conquer_merge",
    "divide-and-conquer split and merge",
    "分治拆分与合并",
    ["divide merge", "recursive partition", "分治合并", "递归拆分"],
    ["divide_and_conquer"],
  ),
  mechanism(
    "divide_and_conquer_subproblem_reduction",
    "recursive subproblem reduction",
    "递归子问题缩减",
    ["halve the subproblem", "recursive overcomputation", "子问题减半", "避免重复递归"],
    ["divide_and_conquer", "math", "recursion"],
  ),
  mechanism(
    "kadane_running_optimum",
    "Kadane running optimum state",
    "Kadane 滚动最优状态",
    ["running maximum", "restart decision", "滚动最大值", "重新开始子数组"],
    ["kadane", "array", "dynamic_programming"],
  ),
  mechanism(
    "binary_search_invariant",
    "binary-search interval invariant",
    "二分搜索区间不变量",
    [
      "binary search loop invariant",
      "binary search boundary update",
      "binary search bound update",
      "binary search boundaries",
      "lower bound",
      "二分搜索循环不变量",
      "边界更新",
    ],
    ["binary_search", "array", "math"],
  ),
  mechanism(
    "heap_priority_ordering",
    "heap priority-order invariant",
    "堆的优先级顺序不变量",
    ["priority queue", "heap ordering", "优先队列", "堆顶顺序"],
    ["heap", "priority_queue"],
  ),
  mechanism(
    "bit_manipulation_state_transition",
    "bit-state transition",
    "位状态转移",
    ["bit mask", "xor invariant", "位掩码", "异或不变量"],
    ["bit_manipulation"],
  ),
  mechanism(
    "math_case_analysis",
    "mathematical case and invariant analysis",
    "数学分类与不变量分析",
    ["number invariant", "case split", "数学不变量", "分类讨论"],
    ["math"],
  ),
  mechanism(
    "math_factor_counting",
    "factor counting",
    "因子计数",
    ["prime factor count", "trailing zero factors", "质因子计数", "尾零因子"],
    ["math"],
  ),
  mechanism(
    "dynamic_programming_state_transition",
    "dynamic-programming state and transition",
    "动态规划状态与转移",
    ["dp state", "state transition", "DP 状态定义", "状态转移"],
    ["dynamic_programming", "1d_dp", "multidimensional_dp"],
  ),
  mechanism(
    "dynamic_programming_initialization",
    "dynamic-programming initialization and base cases",
    "动态规划初始化与基础状态",
    ["dp base case", "initial state", "DP 初始化", "基础状态"],
    ["dynamic_programming", "1d_dp", "multidimensional_dp", "kadane"],
  ),
  mechanism(
    "dynamic_programming_iteration_order",
    "dynamic-programming iteration order",
    "动态规划遍历方向",
    ["dp direction", "update order", "DP 遍历顺序", "正序倒序"],
    ["dynamic_programming", "1d_dp", "multidimensional_dp"],
  ),
  mechanism(
    "complexity_optimization",
    "time and space complexity optimization",
    "时间与空间复杂度优化",
    ["brute force to optimization", "memory optimization", "从暴力到优化", "复杂度优化"],
    [
      "array",
      "string",
      "hashmap",
      "hash_table",
      "graph",
      "dynamic_programming",
      "math",
    ],
  ),
  mechanism(
    "iteration_termination_invariant",
    "loop termination invariant",
    "循环终止不变量",
    ["early exit", "loop completion", "提前退出", "循环终止条件"],
    ["array", "string", "two_pointers", "graph"],
  ),
];

const CANONICAL_MECHANISM_BY_KEY = new Map(
  HOT150_CANONICAL_MECHANISMS.map((entry) => [entry.key, entry]),
);

export function getCanonicalMechanism(key: string) {
  return CANONICAL_MECHANISM_BY_KEY.get(normalizeTaxonomyTerm(key));
}

export const HISTORICAL_RAW_MECHANISM_MAP: Record<
  string,
  HistoricalRawMechanismDecision
> = {
  assignment_logic_error: {
    decision: "drop",
    reason: "vague_non_portable_label",
  },
  bfs_expansion_inefficient: {
    decision: "canonical",
    key: "graph_bfs_frontier",
    requiredTopics: ["graph", "bfs"],
  },
  "binary-search": {
    decision: "canonical",
    key: "binary_search_invariant",
    requiredTopics: ["binary_search"],
  },
  binary_search_boundary: {
    decision: "canonical",
    key: "binary_search_invariant",
    requiredTopics: ["binary_search"],
  },
  boundary_condition_missing: {
    decision: "canonical",
    key: "boundary_indexing",
  },
  brute_force_to_optimization: {
    decision: "canonical",
    key: "complexity_optimization",
  },
  brute_force_unoptimized: {
    decision: "canonical",
    key: "complexity_optimization",
  },
  carry_handling_error: {
    decision: "canonical",
    key: "carry_propagation",
  },
  constructor_argument_missing: {
    decision: "drop",
    reason: "code_shape_only",
  },
  counting_array: { decision: "canonical", key: "frequency_counting" },
  debug_print: { decision: "drop", reason: "code_shape_only" },
  dp_direction_reversed: {
    decision: "canonical",
    key: "dynamic_programming_iteration_order",
    requiredTopics: ["dynamic_programming", "1d_dp", "multidimensional_dp"],
  },
  dynamic_programming: {
    decision: "canonical",
    key: "dynamic_programming_state_transition",
    requiredTopics: ["dynamic_programming", "1d_dp", "multidimensional_dp"],
  },
  early_exit_in_outer_loop: {
    decision: "canonical",
    key: "iteration_termination_invariant",
  },
  excessive_printing: { decision: "drop", reason: "code_shape_only" },
  forward_merge_conflict: {
    decision: "canonical",
    key: "in_place_write_order",
  },
  graph_node_not_found: {
    decision: "canonical",
    key: "graph_traversal_visited_state",
    requiredTopics: ["graph", "dfs", "bfs"],
  },
  hardcoded_return: {
    decision: "drop",
    reason: "blocked_development_noise",
  },
  hashmap: { decision: "canonical", key: "hash_map_lookup" },
  in_place_overwrite: {
    decision: "canonical",
    key: "in_place_write_order",
  },
  incomplete_character_check: {
    decision: "canonical",
    key: "string_character_normalization",
  },
  incomplete_factor_counting: {
    decision: "canonical",
    key: "math_factor_counting",
  },
  indentation_error: { decision: "drop", reason: "code_shape_only" },
  initialization_error: {
    decision: "canonical",
    key: "dynamic_programming_initialization",
    requiredTopics: ["dynamic_programming", "1d_dp", "multidimensional_dp", "kadane"],
  },
  memory_exhausted: {
    decision: "canonical",
    key: "divide_and_conquer_subproblem_reduction",
  },
  missing_digit_check: {
    decision: "canonical",
    key: "string_character_normalization",
  },
  missing_length_check: {
    decision: "canonical",
    key: "dynamic_programming_initialization",
    requiredTopics: ["dynamic_programming", "1d_dp", "multidimensional_dp"],
  },
  missing_merge_logic: { decision: "drop", reason: "code_shape_only" },
  missing_pass_in_init: { decision: "drop", reason: "code_shape_only" },
  missing_return: { decision: "drop", reason: "code_shape_only" },
  missing_row_column_check: {
    decision: "canonical",
    key: "matrix_coordinate_bounds",
    requiredTopics: ["matrix"],
  },
  no_search_logic: {
    decision: "drop",
    reason: "blocked_development_noise",
  },
  "off-by-one": { decision: "canonical", key: "boundary_indexing" },
  off_by_one: { decision: "canonical", key: "boundary_indexing" },
  off_by_one_boundary: {
    decision: "canonical",
    key: "boundary_indexing",
  },
  recursive_overcomputation: {
    decision: "canonical",
    key: "divide_and_conquer_subproblem_reduction",
  },
  sliding_window_misuse: {
    decision: "drop",
    reason: "incompatible_problem_mechanism",
  },
  sliding_window_shrink_condition: {
    decision: "canonical",
    key: "sliding_window_invariant",
    requiredTopics: ["sliding_window"],
  },
  syntax_error: { decision: "drop", reason: "code_shape_only" },
  trie_insert_overwrite: {
    decision: "canonical",
    key: "trie_path_state",
    requiredTopics: ["trie"],
  },
  trie_search_missing_isend: {
    decision: "canonical",
    key: "trie_terminal_state",
    requiredTopics: ["trie"],
  },
  two_pointers: {
    decision: "canonical",
    key: "two_pointer_movement_invariant",
    requiredTopics: ["two_pointers"],
  },
  variable_overwrite: {
    decision: "drop",
    reason: "vague_non_portable_label",
  },
};

const ADDITIONAL_ALWAYS_DROPPED_RAW_SIGNALS = new Set([
  "rotated_sorted_array_approach",
]);

const FORWARD_RAW_MECHANISM_ALIASES: Record<string, string> = {
  array_traversal_strength: "array_iteration_invariant",
  binary_search_boundary_mistake: "binary_search_invariant",
  binary_search_boundary_strength: "binary_search_invariant",
  binary_search_boundary_update: "binary_search_invariant",
  binary_search_invariant_confusion: "binary_search_invariant",
  lower_bound_skill: "binary_search_invariant",
  state_transition_reasoning: "dynamic_programming_state_transition",
};

const CONTEXTUAL_FORWARD_RAW_MECHANISMS: Record<
  string,
  Array<{ key: string; requiredTopics: string[] }>
> = {
  off_by_one_error: [
    {
      key: "binary_search_invariant",
      requiredTopics: ["binary_search"],
    },
  ],
};

const CONTEXTUAL_FORWARD_RAW_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  requiredTopics: string[];
}> = [
  {
    pattern:
      /^(?:off_by_one_(?:in_)?(?:binary_search_)?(?:interval|bound(?:ary)?)(?:_update|_error)?|(?:binary_search_)?(?:interval(?:_boundary)?|bound(?:ary)?)(?:_update)?_off_by_one(?:_error)?|binary_search_(?:interval|bound(?:ary)?)(?:_update|_error|_mistake)?)$/,
    key: "binary_search_invariant",
    requiredTopics: ["binary_search"],
  },
];

export type CanonicalMechanismResolution =
  | {
      decision: "canonical";
      key: string;
      label: CanonicalMechanism["label"];
      aliases: string[];
    }
  | {
      decision: "drop";
      reason:
        | "blocked_development_noise"
        | "code_shape_only"
        | "vague_non_portable_label"
        | "incompatible_problem_mechanism"
        | "mechanism_not_supported_by_source_problem";
    }
  | {
      decision: "unmapped";
      reason: "no_canonical_mechanism_mapping";
    };

export function canonicalMechanismsForProblemTags(rawTags: string[]) {
  const topics = new Set(canonicalHot150ProblemTopics(rawTags));
  return HOT150_CANONICAL_MECHANISMS.filter((entry) =>
    entry.problemTopics.some((topic) => topics.has(topic)),
  );
}

/** Maps a learner's natural-language wording to controlled mechanism keys. */
export function mechanismsFromLearnerQuestion(text: string): string[] {
  const normalized = normalizeTaxonomyTerm(text);
  if (!normalized) return [];
  return HOT150_CANONICAL_MECHANISMS.filter((entry) =>
    [entry.key, entry.label.en, entry.label.zh, ...entry.aliases].some((term) => {
      const candidate = normalizeTaxonomyTerm(term);
      return candidate.length >= 2 && normalized.includes(candidate);
    }),
  ).map((entry) => entry.key);
}

/**
 * The sole raw-signal normalization boundary used by forward and replay.
 * Unknown labels fail closed and never echo the raw value in the result.
 */
export function resolveCanonicalMechanismSignal(args: {
  rawTag: string;
  problemTags: string[];
}): CanonicalMechanismResolution {
  const rawKey = args.rawTag.trim().toLowerCase();
  const normalizedKey = normalizeTaxonomyTerm(args.rawTag);
  const topics = new Set(canonicalHot150ProblemTopics(args.problemTags));
  const explicit =
    HISTORICAL_RAW_MECHANISM_MAP[rawKey] ??
    HISTORICAL_RAW_MECHANISM_MAP[normalizedKey];
  const contextual = [
    ...(CONTEXTUAL_FORWARD_RAW_MECHANISMS[normalizedKey] ?? []),
    ...CONTEXTUAL_FORWARD_RAW_PATTERNS.filter((entry) =>
      entry.pattern.test(normalizedKey),
    ),
  ].find((entry) =>
    entry.requiredTopics.some((topic) =>
      topics.has(normalizeTaxonomyTerm(topic)),
    ),
  );

  if (explicit?.decision === "drop") {
    return { decision: "drop", reason: explicit.reason };
  }

  if (ADDITIONAL_ALWAYS_DROPPED_RAW_SIGNALS.has(normalizedKey)) {
    return { decision: "drop", reason: "vague_non_portable_label" };
  }

  const direct = CANONICAL_MECHANISM_BY_KEY.get(normalizedKey);
  const aliased =
    direct ??
    findMechanismByQualifiedCanonicalKey(normalizedKey) ??
    CANONICAL_MECHANISM_BY_KEY.get(contextual?.key ?? "") ??
    CANONICAL_MECHANISM_BY_KEY.get(
      FORWARD_RAW_MECHANISM_ALIASES[normalizedKey] ?? "",
    ) ??
    findMechanismByAlias(args.rawTag);
  const mapped =
    explicit?.decision === "canonical"
      ? CANONICAL_MECHANISM_BY_KEY.get(explicit.key)
      : aliased;
  if (!mapped) {
    return {
      decision: "unmapped",
      reason: "no_canonical_mechanism_mapping",
    };
  }

  const requiredTopics =
    explicit?.decision === "canonical"
      ? (explicit.requiredTopics ?? mapped.problemTopics)
      : contextual
        ? contextual.requiredTopics
        : mapped.problemTopics;
  if (
    topics.size > 0 &&
    !requiredTopics.some((topic) => topics.has(normalizeTaxonomyTerm(topic)))
  ) {
    return { decision: "drop", reason: "incompatible_problem_mechanism" };
  }

  return {
    decision: "canonical",
    key: mapped.key,
    label: mapped.label,
    aliases: mapped.aliases,
  };
}

function findMechanismByAlias(value: string) {
  const normalized = normalizeTaxonomyTerm(value);
  return HOT150_CANONICAL_MECHANISMS.find((entry) =>
    entry.aliases.some((alias) => normalizeTaxonomyTerm(alias) === normalized),
  );
}

function findMechanismByQualifiedCanonicalKey(normalized: string) {
  return HOT150_CANONICAL_MECHANISMS.find((entry) => {
    if (!normalized.startsWith(`${entry.key}_`)) return false;
    const qualifiers = normalized.slice(entry.key.length + 1).split("_");
    return qualifiers.every((token) =>
      CANONICAL_KEY_QUALIFIER_TOKENS.has(token),
    );
  });
}

// This is a vocabulary of portable learning mechanisms, not a problem list.
// Problem topics come from each Problem row, so a new generated Hot-150 topic
// does not require a new memory-policy branch.
const PORTABLE_MECHANISM_TOKENS = new Set([
  "advance",
  "backtrack",
  "base",
  "bound",
  "boundary",
  "capacity",
  "carry",
  "case",
  "child",
  "choice",
  "column",
  "comparison",
  "complement",
  "convergence",
  "count",
  "cycle",
  "definition",
  "depth",
  "deserialization",
  "dimension",
  "duplicate",
  "endpoint",
  "eviction",
  "expand",
  "frequency",
  "frontier",
  "greedy",
  "handling",
  "indegree",
  "index",
  "initialization",
  "interval",
  "invariant",
  "iteration",
  "level",
  "link",
  "lookup",
  "lower",
  "mask",
  "matching",
  "matrix",
  "membership",
  "memoization",
  "merge",
  "monotonicity",
  "movement",
  "neighbor",
  "order",
  "ordering",
  "overflow",
  "overlap",
  "parent",
  "partition",
  "pivot",
  "pointer",
  "pop",
  "prefix",
  "pruning",
  "push",
  "queue",
  "range",
  "recurrence",
  "recursion",
  "reset",
  "retreat",
  "rotation",
  "row",
  "search",
  "selection",
  "serialization",
  "shift",
  "shrink",
  "sorting",
  "space",
  "stack",
  "state",
  "sum",
  "tabulation",
  "termination",
  "topological",
  "tracking",
  "transition",
  "traversal",
  "update",
  "upper",
  "visited",
  "window",
  ...FACT_QUALIFIER_TOKENS,
]);

export function canonicalHot150ProblemTopics(rawTags: string[]) {
  const topics = new Set<string>();
  for (const rawTag of rawTags) {
    const normalized = normalizeTaxonomyTerm(rawTag);
    if (!normalized || META_PROBLEM_TOPICS.has(normalized)) continue;
    topics.add(normalized);
    for (const alias of PROBLEM_TOPIC_ALIASES[normalized] ?? []) {
      topics.add(alias);
    }
  }
  return [...topics].sort((a, b) => b.length - a.length);
}

export function mechanismMatchesHot150ProblemTags(
  mechanism: string,
  rawTags: string[],
) {
  const normalizedMechanism = normalizeTaxonomyTerm(mechanism);
  const topics = canonicalHot150ProblemTopics(rawTags);
  if (!normalizedMechanism || topics.length === 0) return false;

  for (const topic of topics) {
    if (!normalizedMechanism.startsWith(`${topic}_`)) continue;
    const suffix = normalizedMechanism.slice(topic.length + 1);
    if (isPortableMechanismSuffix(suffix)) return true;
  }

  for (const [root, supportedTopics] of Object.entries(
    ALIASED_MECHANISM_ROOTS,
  )) {
    if (
      (normalizedMechanism === root ||
        normalizedMechanism.startsWith(`${root}_`)) &&
      supportedTopics.some((topic) => topics.includes(topic))
    ) {
      const suffix = normalizedMechanism.slice(root.length).replace(/^_/, "");
      return suffix === "" || isKnownMechanismTokens(suffix);
    }
  }

  return false;
}

function isPortableMechanismSuffix(suffix: string) {
  const tokens = suffix.split("_").filter(Boolean);
  return (
    tokens.length > 0 &&
    isKnownMechanismTokens(suffix) &&
    tokens.some((token) => !FACT_QUALIFIER_TOKENS.has(token))
  );
}

function isKnownMechanismTokens(value: string) {
  const tokens = value.split("_").filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((token) => PORTABLE_MECHANISM_TOKENS.has(token))
  );
}

function normalizeTaxonomyTerm(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
