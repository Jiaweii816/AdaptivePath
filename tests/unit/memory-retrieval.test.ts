import { describe, expect, it } from "vitest";
import { buildRetrievalQueryPlan } from "@/server/memory/retrieval/build-retrieval-query-plan";
import { resolveMatchTier } from "@/server/memory/retrieval/candidate-source-adapters";
import {
  RETRIEVAL_PROFILES,
  resolveRetrievalProfile,
} from "@/server/memory/retrieval/profiles";

describe("retrieval teaching profiles", () => {
  it("declare objectives and source budgets without fact-type hard filters", () => {
    expect(Object.keys(RETRIEVAL_PROFILES)).toHaveLength(4);
    for (const profile of Object.values(RETRIEVAL_PROFILES)) {
      expect(profile.objective.length).toBeGreaterThan(20);
      expect(profile.primarySources.length).toBeGreaterThan(0);
      expect(profile).not.toHaveProperty("factTypes");
      expect(profile).not.toHaveProperty("includeResolved");
    }
  });

  it("separates past problem and past mistake intents from general chat", () => {
    expect(
      resolveRetrievalProfile({
        kind: "chat",
        intent: "past_problem_recall_request",
      }).id,
    ).toBe("history_or_practice");
    expect(
      resolveRetrievalProfile({
        kind: "chat",
        intent: "past_mistake_recall_request",
      }).id,
    ).toBe("history_or_practice");
    expect(
      resolveRetrievalProfile({ kind: "chat", intent: "concept_question" }).id,
    ).toBe("concept_chat");
  });

  it("declares only automatic sources that have runtime adapters", () => {
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "hint_request",
      userText: "Give me one hint for the DP transition.",
      problem: {
        id: "72",
        slug: "edit-distance",
        title: "Edit Distance",
        leetcodeNumber: 72,
        tags: ["Dynamic Programming", "String", "Hot-150"],
      },
    });

    expect(plan.sourcePolicy.episode!.selectionPriority).toBe("primary");
    expect(plan.sourcePolicy).not.toHaveProperty("knowledge_note");
    expect(plan.sourcePolicy.mistake_book!.selectionPriority).toBe("supporting");
  });
});

describe("retrieval query plan canonical mechanisms", () => {
  it("exposes canonical mechanism keys for the active problem tags", () => {
    const plan = buildRetrievalQueryPlan({
      path: "review",
      intent: "review",
      userText: "",
      problem: {
        id: "p-322",
        slug: "coin-change",
        title: "Coin Change",
        leetcodeNumber: 322,
        tags: ["Array", "Dynamic Programming"],
      },
    });

    expect(plan.canonicalMechanisms).toContain(
      "dynamic_programming_state_transition",
    );
    expect(plan.canonicalMechanisms).not.toContain("array");
  });
});

describe("resolveMatchTier", () => {
  const basePlan = buildRetrievalQueryPlan({
    path: "review",
    intent: "review",
    userText: "",
    problem: {
      id: "p-322",
      slug: "coin-change",
      title: "Coin Change",
      leetcodeNumber: 322,
      tags: ["Array", "Dynamic Programming"],
    },
  });

  it("returns mechanism when the candidate carries a canonical mechanism of the active problem", () => {
    expect(
      resolveMatchTier({
        plan: basePlan,
        concepts: [],
        text: "",
        mechanismKeys: ["dynamic_programming_state_transition"],
        lexicalRank: 3,
      }),
    ).toBe("mechanism");
  });

  it("returns lexical_only when the candidate shares only a broad tag concept", () => {
    expect(
      resolveMatchTier({
        plan: basePlan,
        concepts: ["array"],
        text: "过去做数组题时用了朴素遍历。",
        mechanismKeys: [],
        lexicalRank: 1,
      }),
    ).toBe("lexical_only");
  });

  it("returns none when nothing matched and recall did not return it", () => {
    expect(
      resolveMatchTier({
        plan: basePlan,
        concepts: ["trie"],
        text: "字典树前缀状态。",
        mechanismKeys: [],
      }),
    ).toBe("none");
  });
});
