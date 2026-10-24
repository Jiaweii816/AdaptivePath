import { describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import {
  canonicalHot150ProblemTopics,
  mechanismMatchesHot150ProblemTags,
} from "@/server/problems/hot150-taxonomy";

describe("Hot-150 learning taxonomy", () => {
  it("derives an eligible portable mechanism from every Hot-150 section", () => {
    const bySection = new Map(
      hot150Problems.map((problem) => [problem.section, problem]),
    );

    for (const problem of bySection.values()) {
      const [topic] = canonicalHot150ProblemTopics(problem.tags);
      expect(topic, problem.section).toBeTruthy();
      expect(
        mechanismMatchesHot150ProblemTags(`${topic}_invariant`, problem.tags),
        problem.section,
      ).toBe(true);
    }
  });

  it("supports controlled cross-topic mechanism aliases", () => {
    expect(
      mechanismMatchesHot150ProblemTags("state_transition_reasoning", [
        "dynamic-programming",
      ]),
    ).toBe(true);
    expect(
      mechanismMatchesHot150ProblemTags("lower_bound_skill", [
        "binary-search",
      ]),
    ).toBe(true);
  });

  it("rejects bare topics, invented suffixes, and cross-topic hallucinations", () => {
    expect(
      mechanismMatchesHot150ProblemTags("binary_search", ["binary-search"]),
    ).toBe(false);
    expect(
      mechanismMatchesHot150ProblemTags("binary_search_totally_fake", [
        "binary-search",
      ]),
    ).toBe(false);
    expect(
      mechanismMatchesHot150ProblemTags(
        "invented_binary_search_boundary_dynamic_programming_state_unicorn",
        ["dynamic-programming"],
      ),
    ).toBe(false);
    expect(
      mechanismMatchesHot150ProblemTags("binary_search_boundary", [
        "dynamic-programming",
      ]),
    ).toBe(false);
  });
});
