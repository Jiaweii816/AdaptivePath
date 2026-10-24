import { describe, expect, it } from "vitest";
import { resolveClaimClusterKey } from "@/server/memory/claims/resolve-claim-cluster-key";

const scope = { level: "mechanism" as const, problemIds: [], topicHints: [] };

describe("resolveClaimClusterKey", () => {
  it("uses a canonical mechanism key when the model supplies one", () => {
    const result = resolveClaimClusterKey({
      claimType: "strength",
      polarity: "positive",
      scope,
      claimText: "The learner implemented Kahn's algorithm correctly.",
      mechanismKeys: ["graph_traversal_visited_state"],
    });

    expect(result.tier).toBe("canonical");
    expect(result.mechanismKey).toBe("graph_traversal_visited_state");
    expect(result.clusterKey).toBe(
      "claim:v2:capability_positive:positive:graph_traversal_visited_state:mechanism",
    );
  });

  it("recovers a canonical key from topic hints when mechanismKeys is empty", () => {
    const result = resolveClaimClusterKey({
      claimType: "strength",
      polarity: "positive",
      scope: { ...scope, topicHints: ["binary search"] },
      claimText: "The learner kept the search interval invariant stable.",
      mechanismKeys: [],
    });

    expect(["canonical", "concept"]).toContain(result.tier);
    expect(result.clusterKey).toContain("binary_search");
  });

  it("gives two paraphrases of the same claim the same semantic fallback key", () => {
    const a = resolveClaimClusterKey({
      claimType: "mistake",
      polarity: "negative",
      scope,
      claimText: "The learner forgot to reset the accumulator between rounds.",
      mechanismKeys: [],
    });
    const b = resolveClaimClusterKey({
      claimType: "mistake",
      polarity: "negative",
      scope,
      claimText: "Between rounds, the learner forgot to reset the accumulator.",
      mechanismKeys: [],
    });

    expect(a.tier).toBe("semantic");
    expect(a.clusterKey).toBe(b.clusterKey);
  });

  it("separates opposite polarities of the same mechanism", () => {
    const positive = resolveClaimClusterKey({
      claimType: "strength",
      polarity: "positive",
      scope,
      claimText: "handled it well",
      mechanismKeys: ["binary_search_invariant"],
    });
    const negative = resolveClaimClusterKey({
      claimType: "weakness",
      polarity: "negative",
      scope,
      claimText: "handled it badly",
      mechanismKeys: ["binary_search_invariant"],
    });

    expect(positive.clusterKey).not.toBe(negative.clusterKey);
  });
});
