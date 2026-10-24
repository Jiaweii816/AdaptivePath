import { describe, expect, it } from "vitest";
import {
  enrichEpisodeFtsContent,
  factFtsContent,
  readableFactTeachingText,
} from "@/server/memory/store/memory-document-content";

const trustedValidation = JSON.stringify({
  integrity: {
    version: 1,
    origin: "learner",
    subject: "learner_behavior",
    mechanism: "dynamic_programming_state_transition",
    humanLabel: "Needs to define each DP state before writing transitions",
    portability: "portable",
    promotionStatus: "trusted",
    evidenceClusters: [
      {
        sourceProblemId: "p97",
        sourceProblemSlug: "interleaving-string",
        evidenceTraceIds: ["trace-1"],
        summary: "Two reviews showed the same state-definition gap.",
      },
    ],
  },
});

describe("memory FTS document content", () => {
  it("indexes trusted facts with human teaching text and problem metadata", () => {
    const content = factFtsContent(
      {
        factType: "weakness",
        tag: "dynamic_programming_state_transition",
        label: "Needs to define each DP state before writing transitions",
        value: JSON.stringify({ hypothesis: "Write the state meaning first." }),
        lastEvidenceSummary: "Two visible reviews showed the same gap.",
        status: "active",
        memoryOrigin: "learner",
        validationJson: trustedValidation,
      },
      {
        title: "Interleaving String",
        slug: "interleaving-string",
        leetcodeNumber: 97,
        tags: JSON.stringify([
          "multidimensional_dp",
          "string",
          "Hot-150",
        ]),
      },
    );

    expect(content).toContain("LeetCode 97 Interleaving String");
    expect(content).toContain("Needs to define each DP state");
    expect(content).toContain("multidimensional dp");
    expect(content).not.toContain("Hot-150");
    expect(content).not.toContain("hot 150");
    expect(content).not.toContain("dynamic_programming_state_transition");
  });

  it("fails closed for untrusted or machine-only facts", () => {
    expect(
      factFtsContent({
        factType: "mistake",
        tag: "hardcoded_return",
        label: "hardcoded_return",
        status: "active",
        memoryOrigin: "legacy_unknown",
        validationJson: "{}",
      }),
    ).toBeUndefined();
  });

  it("extracts readable value text without exposing raw JSON", () => {
    expect(
      readableFactTeachingText({
        factType: "strategy",
        tag: "dynamic_programming_state_transition",
        label: null,
        value: JSON.stringify({ hypothesis: "Ask for the state invariant first." }),
        status: "validated",
        memoryOrigin: "learner",
        validationJson: trustedValidation,
      }),
    ).toBe("Ask for the state invariant first.");
  });

  it("adds stable problem identity to episode lexical content", () => {
    expect(
      enrichEpisodeFtsContent("A prior DP state-machine review", {
        title: "Interleaving String",
        slug: "interleaving-string",
        leetcodeNumber: 97,
      }),
    ).toContain("LeetCode 97 Interleaving String");
  });
});
