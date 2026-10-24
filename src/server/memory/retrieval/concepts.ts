const COLLECTION_TAGS = new Set([
  "interview_150",
  "top_interview_150",
  "hot_150",
  "hot150",
  "demo",
  "showcase",
]);

const GENERIC_TAGS = new Set([
  "array",
  "string",
  "sorting",
  "simulation",
  "math",
]);

const CONCEPT_ALIASES: Record<string, readonly string[]> = {
  dynamic_programming: ["dynamic programming", "dynamic_programming", "dp", "动态规划"],
  binary_search: ["binary search", "binary_search", "二分查找", "二分"],
  sliding_window: [
    "sliding window",
    "sliding_window",
    "window shrink",
    "window_shrink",
    "滑动窗口",
    "窗口收缩",
  ],
  two_pointers: ["two pointers", "two_pointers", "two pointer", "双指针"],
  hash_table: ["hash table", "hash_table", "hashmap", "hash map", "哈希表"],
  breadth_first_search: ["breadth first search", "breadth_first_search", "bfs", "广度优先"],
  depth_first_search: ["depth first search", "depth_first_search", "dfs", "深度优先"],
  backtracking: ["backtracking", "backtrack", "回溯"],
  heap: ["heap", "priority queue", "priority_queue", "heapq", "堆", "优先队列"],
  stack: ["stack", "栈"],
  queue: ["queue", "deque", "队列"],
  graph: ["graph", "图"],
  tree: ["tree", "binary tree", "binary_tree", "树", "二叉树"],
  linked_list: ["linked list", "linked_list", "链表"],
  intervals: ["interval", "intervals", "区间"],
  greedy: ["greedy", "贪心"],
  prefix_sum: ["prefix sum", "prefix_sum", "前缀和"],
  trie: ["trie", "prefix tree", "prefix_tree", "字典树"],
  union_find: ["union find", "union_find", "disjoint set", "并查集"],
  divide_and_conquer: ["divide and conquer", "divide_and_conquer", "分治"],
  matrix: ["matrix", "矩阵"],
  bit_manipulation: ["bit manipulation", "bit_manipulation", "位运算"],
  state_machine: ["state machine", "state_machine", "状态机", "state transition", "状态转移"],
};

const CONCEPT_FAMILY: Record<string, string> = {
  dynamic_programming: "dynamic_programming",
  multidimensional_dp: "dynamic_programming",
  one_dimensional_dp: "dynamic_programming",
  "1d_dp": "dynamic_programming",
  dp_state_design: "dynamic_programming",
  state_machine: "state_machine",
  state_transition: "state_machine",
};

const ALIAS_ENTRIES = Object.entries(CONCEPT_ALIASES).flatMap(
  ([canonical, aliases]) =>
    aliases.map((alias) => [canonical, normalizeConceptToken(alias)] as const),
);

export function normalizeConceptToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function canonicalizeConcept(value: string) {
  const normalized = normalizeConceptToken(value);
  const exact = ALIAS_ENTRIES.find(([, alias]) => alias === normalized);
  return exact?.[0] ?? normalized;
}

export function extractKnownConcepts(value: string) {
  const normalized = normalizeConceptToken(value);
  const found = new Set<string>();

  for (const [canonical, alias] of ALIAS_ENTRIES) {
    if (containsNormalizedPhrase(normalized, alias)) {
      found.add(canonical);
    }
  }

  return [...found];
}

export function classifyProblemConcepts(tags: readonly string[]) {
  const candidate: Array<{ tag: string; tier: "concept" | "generic" }> = [];
  const droppedTags: string[] = [];

  for (const rawTag of tags) {
    const normalized = normalizeConceptToken(rawTag);
    if (!normalized) continue;

    if (COLLECTION_TAGS.has(normalized)) {
      droppedTags.push(rawTag);
      continue;
    }

    const tag = canonicalizeConcept(normalized);
    candidate.push({
      tag,
      tier: GENERIC_TAGS.has(tag) ? "generic" : "concept",
    });
  }

  return {
    candidate: uniqueBy(candidate, (item) => `${item.tag}:${item.tier}`),
    droppedTags: [...new Set(droppedTags)],
  };
}

export function isGenericConcept(value: string) {
  return GENERIC_TAGS.has(canonicalizeConcept(value));
}

/**
 * Compares taxonomy concepts without flattening the stored Hot-150 tags.
 * A broad natural-language concept such as "dynamic programming" may match a
 * concrete subtype such as `multidimensional_dp`, while unrelated concepts
 * remain isolated.
 */
export function conceptsOverlap(
  left: readonly string[],
  right: readonly string[],
) {
  const rightKeys = new Set(right.map(conceptFamily));
  return left.some((concept) => rightKeys.has(conceptFamily(concept)));
}

export function humanizeConcept(value: string) {
  return normalizeConceptToken(value).replace(/_/g, " ");
}

function containsNormalizedPhrase(source: string, phrase: string) {
  if (/\p{Script=Han}/u.test(phrase)) return source.includes(phrase);
  return (
    source === phrase ||
    source.startsWith(`${phrase}_`) ||
    source.endsWith(`_${phrase}`) ||
    source.includes(`_${phrase}_`)
  );
}

function conceptFamily(value: string) {
  const canonical = canonicalizeConcept(value);
  return CONCEPT_FAMILY[canonical] ?? canonical;
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
