import { describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import {
  HISTORICAL_RAW_MECHANISM_MAP,
  HOT150_CANONICAL_MECHANISMS,
  canonicalMechanismsForProblemTags,
  resolveCanonicalMechanismSignal,
} from "@/server/problems/hot150-taxonomy";

const HISTORICAL_DIAGNOSIS_TAGS = [
  "assignment_logic_error",
  "bfs_expansion_inefficient",
  "binary-search",
  "binary_search_boundary",
  "boundary_condition_missing",
  "brute_force_to_optimization",
  "brute_force_unoptimized",
  "carry_handling_error",
  "constructor_argument_missing",
  "counting_array",
  "debug_print",
  "dp_direction_reversed",
  "dynamic_programming",
  "early_exit_in_outer_loop",
  "excessive_printing",
  "forward_merge_conflict",
  "graph_node_not_found",
  "hardcoded_return",
  "hashmap",
  "in_place_overwrite",
  "incomplete_character_check",
  "incomplete_factor_counting",
  "indentation_error",
  "initialization_error",
  "memory_exhausted",
  "missing_digit_check",
  "missing_length_check",
  "missing_merge_logic",
  "missing_pass_in_init",
  "missing_return",
  "missing_row_column_check",
  "no_search_logic",
  "off-by-one",
  "off_by_one",
  "off_by_one_boundary",
  "recursive_overcomputation",
  "sliding_window_misuse",
  "sliding_window_shrink_condition",
  "syntax_error",
  "trie_insert_overwrite",
  "trie_search_missing_isend",
  "two_pointers",
  "variable_overwrite",
] as const;

describe("canonical Hot-150 mechanism taxonomy", () => {
  it("defines stable unique keys with human English/Chinese labels and aliases", () => {
    expect(HOT150_CANONICAL_MECHANISMS.length).toBeGreaterThan(20);

    const keys = HOT150_CANONICAL_MECHANISMS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of HOT150_CANONICAL_MECHANISMS) {
      expect(entry.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.label.en.trim()).not.toBe("");
      expect(entry.label.zh.trim()).not.toBe("");
      expect(entry.aliases.some((alias) => /[a-z]/i.test(alias))).toBe(true);
      expect(entry.aliases.some((alias) => /[\u3400-\u9fff]/u.test(alias))).toBe(
        true,
      );
    }
  });

  it("projects every Hot-150 problem onto at least one controlled mechanism", () => {
    for (const problem of hot150Problems) {
      const mechanisms = canonicalMechanismsForProblemTags(problem.tags);
      expect(mechanisms.length, `${problem.slug}: ${problem.tags.join(",")}`).toBeGreaterThan(
        0,
      );
      expect(
        mechanisms.every((entry) =>
          HOT150_CANONICAL_MECHANISMS.some(
            (catalogEntry) => catalogEntry.key === entry.key,
          ),
        ),
      ).toBe(true);
    }
  });

  it("maps representative portable historical tags to canonical mechanisms", () => {
    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "binary_search_boundary",
        problemTags: ["binary-search", "array"],
      }),
    ).toMatchObject({ decision: "canonical", key: "binary_search_invariant" });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "binary_search_bound_update",
        problemTags: ["binary-search", "array"],
      }),
    ).toMatchObject({ decision: "canonical", key: "binary_search_invariant" });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "binary_search_boundary_update",
        problemTags: ["binary-search", "array"],
      }),
    ).toMatchObject({ decision: "canonical", key: "binary_search_invariant" });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "array_traversal_strength",
        problemTags: ["array"],
      }),
    ).toMatchObject({ decision: "canonical", key: "array_iteration_invariant" });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "off_by_one_error",
        problemTags: ["binary-search", "array"],
      }),
    ).toMatchObject({ decision: "canonical", key: "binary_search_invariant" });

    for (const rawTag of [
      "off_by_one_in_interval_update",
      "interval_boundary_off_by_one",
      "binary_search_interval_update",
      "binary_search_invariant_update",
    ]) {
      expect(
        resolveCanonicalMechanismSignal({
          rawTag,
          problemTags: ["binary-search", "array"],
        }),
      ).toMatchObject({
        decision: "canonical",
        key: "binary_search_invariant",
      });
    }

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "dp_direction_reversed",
        problemTags: ["dynamic-programming", "1d-dp"],
      }),
    ).toMatchObject({
      decision: "canonical",
      key: "dynamic_programming_iteration_order",
    });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "sliding_window_shrink_condition",
        problemTags: ["sliding-window", "string"],
      }),
    ).toMatchObject({ decision: "canonical", key: "sliding_window_invariant" });

    expect(
      resolveCanonicalMechanismSignal({
        rawTag: "trie_search_missing_isend",
        problemTags: ["trie", "string"],
      }),
    ).toMatchObject({ decision: "canonical", key: "trie_terminal_state" });
  });

  it("explicitly drops known development noise and incompatible raw labels", () => {
    for (const rawTag of [
      "no_search_logic",
      "hardcoded_return",
      "rotated_sorted_array_approach",
      "sliding_window_misuse",
    ]) {
      expect(
        resolveCanonicalMechanismSignal({
          rawTag,
          problemTags: ["dynamic-programming", "array"],
        }),
      ).toMatchObject({ decision: "drop" });
    }
  });

  it("has an explicit canonical-or-drop decision for every raw tag in the live forensic baseline", () => {
    expect(Object.keys(HISTORICAL_RAW_MECHANISM_MAP).sort()).toEqual(
      [...HISTORICAL_DIAGNOSIS_TAGS].sort(),
    );

    for (const rawTag of HISTORICAL_DIAGNOSIS_TAGS) {
      expect(HISTORICAL_RAW_MECHANISM_MAP[rawTag].decision).toMatch(
        /^(canonical|drop)$/,
      );
    }
  });

  it("fails closed when a raw signal cannot be normalized", () => {
    const result = resolveCanonicalMechanismSignal({
      rawTag: "invented_llm_label_that_is_not_in_the_taxonomy",
      problemTags: ["binary-search"],
    });

    expect(result).toEqual({
      decision: "unmapped",
      reason: "no_canonical_mechanism_mapping",
    });
    expect(JSON.stringify(result)).not.toContain(
      "invented_llm_label_that_is_not_in_the_taxonomy",
    );
  });
});
