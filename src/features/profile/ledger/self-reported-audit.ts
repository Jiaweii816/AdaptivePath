import type {
  LedgerFact,
  SelfReportedAudit,
  SelfReportedVerdict,
} from "./ledger-types";

/**
 * Onboarding offers a closed list of patterns (see `onboardingOptions`), so
 * each option maps to mechanism keys explicitly. An explicit table over a fixed
 * vocabulary is exact; string similarity over the same list would only be a
 * guess that silently mislabels a verdict.
 *
 * A pattern with no entry here reports `unobserved` rather than inventing a
 * match.
 */
const PATTERN_MECHANISM_KEYS: Readonly<Record<string, readonly string[]>> = {
  "HashMap": ["hash_map_lookup", "frequency_counting"],
  "Dict": ["hash_map_lookup", "frequency_counting"],
  "Array traversal": [
    "array_iteration_invariant",
    "in_place_write_order",
    "iteration_termination_invariant",
  ],
  "Brute force to optimization": ["complexity_optimization"],
  "Sliding Window overall intuition": ["sliding_window_invariant"],
  "Sliding Window shrink condition": ["sliding_window_invariant"],
  "Binary Search": ["binary_search_invariant"],
  "Binary Search boundaries": ["binary_search_invariant", "boundary_indexing"],
  "DP state design": [
    "dynamic_programming_state_transition",
    "dynamic_programming",
  ],
  "Graph traversal": [
    "graph_traversal_visited_state",
    "graph_bfs_frontier",
    "depth_first_search",
    "graph",
  ],
};

export function mechanismKeysForPattern(label: string): readonly string[] {
  return PATTERN_MECHANISM_KEYS[label.trim()] ?? [];
}

function resolveVerdict(args: {
  claimedAs: "strong" | "weak";
  hasPositive: boolean;
  hasNegative: boolean;
}): SelfReportedVerdict {
  if (!args.hasPositive && !args.hasNegative) return "unobserved";
  if (args.hasPositive && args.hasNegative) return "split";
  const evidenceAgrees =
    args.claimedAs === "strong" ? args.hasPositive : args.hasNegative;
  return evidenceAgrees ? "confirmed" : "contradicted";
}

function auditPattern(
  label: string,
  claimedAs: "strong" | "weak",
  facts: LedgerFact[],
): SelfReportedAudit {
  const keys = new Set(mechanismKeysForPattern(label));
  const matched = facts.filter((fact) => keys.has(fact.mechanismKey));
  const positiveFacts = matched.filter((fact) => fact.polarity === "positive");
  const negativeFacts = matched.filter((fact) => fact.polarity === "negative");

  return {
    label,
    claimedAs,
    verdict: resolveVerdict({
      claimedAs,
      hasPositive: positiveFacts.length > 0,
      hasNegative: negativeFacts.length > 0,
    }),
    positiveFacts: sortByEvidence(positiveFacts),
    negativeFacts: sortByEvidence(negativeFacts),
  };
}

function sortByEvidence(facts: LedgerFact[]) {
  return [...facts].sort(
    (left, right) => right.evidenceCount - left.evidenceCount,
  );
}

const VERDICT_RANK: Record<SelfReportedVerdict, number> = {
  contradicted: 0,
  split: 1,
  confirmed: 2,
  unobserved: 3,
};

/**
 * Compares what the learner claimed at onboarding against the established
 * facts. Ordered so disagreements read first — those are the entries where the
 * ledger has something the learner does not already believe.
 */
export function auditSelfReportedPatterns(args: {
  strongPatterns: string[];
  weakPatterns: string[];
  facts: LedgerFact[];
}): SelfReportedAudit[] {
  const audits = [
    ...args.weakPatterns.map((label) => auditPattern(label, "weak", args.facts)),
    ...args.strongPatterns.map((label) =>
      auditPattern(label, "strong", args.facts),
    ),
  ];

  return audits.sort(
    (left, right) =>
      VERDICT_RANK[left.verdict] - VERDICT_RANK[right.verdict] ||
      totalEvidence(right) - totalEvidence(left),
  );
}

function totalEvidence(audit: SelfReportedAudit) {
  return [...audit.positiveFacts, ...audit.negativeFacts].reduce(
    (sum, fact) => sum + fact.evidenceCount,
    0,
  );
}
