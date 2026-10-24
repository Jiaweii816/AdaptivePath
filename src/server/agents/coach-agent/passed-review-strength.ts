import type { MemoryUpdateCandidateFact } from "@/types/coach";
import type { CodeRunResult } from "@/types/code-runner";
import {
  canonicalHot150ProblemTopics,
  resolveCanonicalMechanismSignal,
} from "@/server/problems/hot150-taxonomy";

type MechanismDetector = {
  key: string;
  matches: (code: string) => boolean;
};

/**
 * Conservative deterministic evidence checks for mechanisms that are visible
 * in Python source. A problem tag alone is never enough to earn a strength:
 * the code shape must match and the shared taxonomy must confirm that the
 * mechanism is supported by the source problem.
 */
const PASSED_CODE_MECHANISM_DETECTORS: MechanismDetector[] = [
  detector("graph_topological_indegree", /\bindegree\b/i, /\b(?:deque|queue)\b/i),
  detector("trie_terminal_state", /\b(?:is_end|isend|end_of_word)\b/i, /\bchildren\b/i),
  detector("trie_path_state", /\bchildren\b/i, /\b(?:setdefault|defaultdict|dict)\b/i),
  detector("heap_priority_ordering", /\bheapq\b/i, /\b(?:heappush|heappop|heapify)\b/i),
  detector("binary_search_invariant", /\bmid\b/i, /\b(?:left|lo)\b/i, /\b(?:right|hi)\b/i),
  detector("sliding_window_invariant", /\b(?:left|start)\b/i, /\b(?:right|end)\b/i, /\bwhile\b/i),
  detector("graph_bfs_frontier", /\b(?:deque|queue)\b/i, /\bpopleft\b/i),
  detector("graph_traversal_visited_state", /\bvisited\b/i, /\b(?:dfs|bfs|stack|queue)\b/i),
  detector("backtracking_choice_rollback", /\b(?:backtrack|backtracking|dfs)\b/i, /\.append\s*\(/i, /\.pop\s*\(/i),
  detector("dynamic_programming_iteration_order", /\bdp\b/i, /\b(?:reversed|range\s*\([^\n]*,-1)\b/i),
  detector("dynamic_programming_state_transition", /\bdp\s*[\[=]/i, /\bdp\s*\[/i),
  detector("dynamic_programming_initialization", /\bdp\s*=\s*(?:\[|\{)/i, /\b(?:for|while)\b/i),
  detector("stack_state_invariant", /\bstack\b/i, /\.append\s*\(/i, /\.pop\s*\(/i),
  detector("linked_list_pointer_rewiring", /\.next\b/i, /\b(?:prev|previous|dummy|current|curr)\b/i),
  detector("frequency_counting", /\b(?:Counter|frequency|freq|counts?)\b/i, /\b(?:for|while)\b/i),
  detector("hash_map_lookup", /\b(?:defaultdict|dict)\s*\(/i, /\b(?:in|get|setdefault)\b/i),
  detector("hash_map_lookup", /\{\s*\}/, /\b(?:in|get|setdefault)\b/i),
  detector("two_pointer_movement_invariant", /\b(?:left|i)\b/i, /\b(?:right|j)\b/i, /\bwhile\b/i),
  detector("interval_overlap_merge", /\.sort\s*\(|\bsorted\s*\(/i, /\b(?:interval|merged|end)\b/i),
  detector("prefix_suffix_accumulation", /\b(?:prefix|suffix)\b/i, /\b(?:for|while)\b/i),
  detector("bit_manipulation_state_transition", /(?:\^|<<|>>|\&|\|)/, /\b(?:bit|mask|xor)\b/i),
  detector("matrix_coordinate_bounds", /\b(?:rows?|cols?|matrix|grid)\b/i, /\b(?:for|while)\b/i),
  detector("carry_propagation", /\bcarry\b/i, /(?:divmod|\/\/\s*10|%\s*10)/i),
  detector("in_place_write_order", /\b(?:nums|array|matrix)\s*\[[^\]]+\]\s*=/i, /\b(?:reversed|right|end|k)\b/i),
  detector("kadane_running_optimum", /\b(?:current|max_ending|running)\b/i, /\b(?:best|max_sum|answer)\b/i),
];

const DETECTOR_REQUIRED_TOPICS: Record<string, string[]> = {
  graph_topological_indegree: ["graph", "topological_sort"],
  trie_terminal_state: ["trie"],
  trie_path_state: ["trie"],
  heap_priority_ordering: ["heap", "priority_queue"],
  binary_search_invariant: ["binary_search"],
  sliding_window_invariant: ["sliding_window"],
  graph_bfs_frontier: ["bfs"],
  graph_traversal_visited_state: ["graph", "dfs", "bfs"],
  backtracking_choice_rollback: ["backtracking"],
  dynamic_programming_iteration_order: [
    "dynamic_programming",
    "1d_dp",
    "multidimensional_dp",
  ],
  dynamic_programming_state_transition: [
    "dynamic_programming",
    "1d_dp",
    "multidimensional_dp",
  ],
  dynamic_programming_initialization: [
    "dynamic_programming",
    "1d_dp",
    "multidimensional_dp",
  ],
  stack_state_invariant: ["stack"],
  linked_list_pointer_rewiring: ["linked_list"],
  frequency_counting: ["hashmap", "hash_table", "counting"],
  hash_map_lookup: ["hashmap", "hash_table"],
  two_pointer_movement_invariant: ["two_pointers"],
  interval_overlap_merge: ["intervals"],
  prefix_suffix_accumulation: ["prefix_sum"],
  bit_manipulation_state_transition: ["bit_manipulation"],
  matrix_coordinate_bounds: ["matrix"],
  carry_propagation: ["linked_list", "math"],
  in_place_write_order: ["matrix", "two_pointers"],
  kadane_running_optimum: ["kadane"],
};

export function derivePassedReviewStrengthFact(args: {
  code?: string;
  problemTags: string[];
  evidenceScope: "official_judge" | "local_visible";
}): MemoryUpdateCandidateFact | undefined {
  const mechanism = detectSourceMechanism(args);
  if (!mechanism) return undefined;
  const label = mechanism.label.en;
  return {
    factType: "strength",
    tag: mechanism.key,
    label,
    confidence: 0.7,
    evidenceSummary:
      args.evidenceScope === "local_visible"
        ? `The learner revision visibly used the ${label} across selected local visible tests; this does not establish official acceptance or hidden-test coverage.`
        : `The learner revision visibly used the ${label} and received passed Review execution evidence.`,
  };
}

export function deriveFailedReviewMistakeFact(args: {
  code?: string;
  problemTags: string[];
  evidenceScope: "official_judge" | "local_visible";
  runResult: CodeRunResult;
}): MemoryUpdateCandidateFact | undefined {
  if (args.runResult.status !== "failed") return undefined;
  const mechanism = detectSourceMechanism(args);
  if (!mechanism) return undefined;
  const label = mechanism.label.en;
  const failedCase = args.runResult.firstFailedCase;
  const failure = failedCase
    ? `the selected local visible test "${failedCase.label}" expected ${compactValue(failedCase.expected)} but produced ${compactValue(failedCase.actual ?? failedCase.error)}`
    : "the current aligned Review execution evidence failed";
  return {
    factType: "mistake",
    tag: mechanism.key,
    label: `${label} needs repair`,
    confidence: 0.7,
    evidenceSummary:
      args.evidenceScope === "local_visible"
        ? `The learner revision visibly used the ${label}, and ${failure}; this claim is limited to selected local visible tests.`
        : `The learner revision visibly used the ${label}, and ${failure}.`,
  };
}

function detectSourceMechanism(args: {
  code?: string;
  problemTags: string[];
}) {
  const code = args.code?.trim();
  if (!code) return undefined;
  const problemTopics = new Set(
    canonicalHot150ProblemTopics(args.problemTags),
  );

  for (const candidate of PASSED_CODE_MECHANISM_DETECTORS) {
    if (!candidate.matches(code)) continue;
    const requiredTopics = DETECTOR_REQUIRED_TOPICS[candidate.key] ?? [];
    if (
      requiredTopics.length > 0 &&
      !requiredTopics.some((topic) => problemTopics.has(topic))
    ) {
      continue;
    }
    const resolution = resolveCanonicalMechanismSignal({
      rawTag: candidate.key,
      problemTags: args.problemTags,
    });
    if (resolution.decision === "canonical") return resolution;
  }
  return undefined;
}

function detector(key: string, ...patterns: RegExp[]): MechanismDetector {
  return {
    key,
    matches: (code) => patterns.every((pattern) => pattern.test(code)),
  };
}

function compactValue(value: unknown) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
