import { describe, expect, it } from "vitest";

import { createMockSemanticTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/mock-semantic-turn-classifier";
import {
  semanticClassifierOutputSchema,
  type SemanticClassifierOutput,
} from "@/server/agents/coach-agent/turn-classifier/semantic-classifier-output.schema";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";

const output: SemanticClassifierOutput = {
  schemaVersion: "turn_semantic_proposal_v2",
  requests: [
    {
      id: "req0",
      kind: "respond",
      deliverable: "understand",
      target: "concept",
      basis: ["current_evidence", "concept_kb"],
      delivery: {
        depth: "normal",
        form: "prose",
      },
      sourceClauseIds: ["c0"],
      dependsOn: [],
    },
  ],
  certainty: {
    status: "confident",
    confidence: 0.91,
    alternatives: [],
  },
};

describe("canonical semantic classifier schema and mock", () => {
  it("accepts canonical requests and rejects the legacy family contract", () => {
    expect(semanticClassifierOutputSchema.safeParse(output).success).toBe(true);
    expect(semanticClassifierOutputSchema.safeParse({
      operations: [{ family: "answer", target: "concept" }],
      modifiers: { deliveryMode: "direct" },
    }).success).toBe(false);
  });

  it("requires persist content and rejects the old subject-shaped effect", () => {
    const persist = {
      ...output,
      requests: [{
        id: "req0",
        kind: "persist",
        collection: "preference",
        content: "以后用英文回答",
        sourceClauseIds: ["c0"],
        dependsOn: [],
      }],
    };
    expect(semanticClassifierOutputSchema.safeParse(persist).success).toBe(true);
    expect(semanticClassifierOutputSchema.safeParse({
      ...persist,
      requests: [{
        id: "req0",
        kind: "persist",
        subject: "preference",
        sourceClauseIds: ["c0"],
        dependsOn: [],
      }],
    }).success).toBe(false);
  });

  it("requires alternatives when the model abstains", () => {
    expect(semanticClassifierOutputSchema.safeParse({
      ...output,
      certainty: {
        status: "ambiguous",
        ambiguityReason: "response_target_unclear",
        alternatives: [],
      },
    }).success).toBe(false);
  });

  it("provides a deterministic scripted mock", async () => {
    const classifier = createMockSemanticTurnClassifier({ explain: output });
    const deterministic = compileTurnUnderstandingV2("explain");
    await expect(classifier.classify({
      message: "explain",
      projection: "",
      workspace: {
        language: "Python",
        hasCurrentCode: true,
        hasAssistantCandidate: false,
        selectedTestCount: 0,
      },
      deterministic,
    })).resolves.toEqual(output);
  });
});
