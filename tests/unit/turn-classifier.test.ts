import { describe, expect, it } from "vitest";
import {
  classifierOutputSchema,
  operationFamilySchema,
  operationTargetSchema,
} from "@/server/agents/coach-agent/turn-classifier/classifier-output.schema";
import { createMockTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/mock-turn-classifier";

const operationFamilies = [
  "answer",
  "lookup_api",
  "diagnose",
  "execute",
  "optimize",
  "recall",
  "profile_meta",
  "recommend",
  "persist",
] as const;

const operationTargets = [
  "current_user_code",
  "assistant_candidate",
  "current_approach",
  "active_problem",
  "concept",
  "api_object",
  "past_problem",
  "past_mistake",
  "learner_profile",
  "practice_problem",
  "preference",
  "knowledge_handbook",
  "mistake_book",
  "contextual_referent",
  "unspecified",
] as const;

function validOutput(operationCount = 1) {
  return {
    operations: Array.from({ length: operationCount }, (_, index) => ({
      family: "answer" as const,
      target: "concept" as const,
      topic: "concept" as const,
      dependsOn: index === 0 ? [] : [`op${index - 1}`],
    })),
    modifiers: {
      deliveryMode: "direct" as const,
      codeDisclosure: "guided" as const,
      affect: "none" as const,
    },
  };
}

describe("classifier output schema + mock", () => {
  it("keeps operation family and target enums aligned with P1", () => {
    expect(operationFamilySchema.options).toEqual(operationFamilies);
    expect(operationTargetSchema.options).toEqual(operationTargets);
  });

  it("accepts valid operations and canonical dependency references", () => {
    expect(
      classifierOutputSchema.safeParse({
        operations: [
          {
            family: "execute",
            target: "current_user_code",
            dependsOn: [],
          },
          {
            family: "diagnose",
            target: "current_user_code",
            topic: "general",
            dependsOn: ["op0"],
          },
        ],
        modifiers: {
          deliveryMode: "hint",
          codeDisclosure: "full_code",
          affect: "anxious_stuck",
          requestedCount: 2,
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["family", { family: "teleport", target: "concept" }],
    ["target", { family: "answer", target: "hidden_tests" }],
    ["topic", { family: "answer", target: "concept", topic: "solution" }],
  ])("rejects an unknown %s", (_label, operation) => {
    expect(
      classifierOutputSchema.safeParse({
        ...validOutput(),
        operations: [{ ...operation, dependsOn: [] }],
      }).success,
    ).toBe(false);
  });

  it("accepts zero to six operations and rejects more", () => {
    expect(classifierOutputSchema.safeParse(validOutput(0)).success).toBe(true);
    expect(classifierOutputSchema.safeParse(validOutput(1)).success).toBe(true);
    expect(classifierOutputSchema.safeParse(validOutput(6)).success).toBe(true);
    expect(classifierOutputSchema.safeParse(validOutput(7)).success).toBe(false);
  });

  it.each(["operation-0", "op01", "op-1", "op"])(
    "rejects non-canonical dependency reference %s",
    (dependsOn) => {
      expect(
        classifierOutputSchema.safeParse({
          ...validOutput(),
          operations: [
            {
              family: "diagnose",
              target: "current_user_code",
              dependsOn: [dependsOn],
            },
          ],
        }).success,
      ).toBe(false);
    },
  );

  it("returns a scripted mock hit after trimming the message", async () => {
    const output = validOutput();
    const classifier = createMockTurnClassifier({ "explain it": output });

    await expect(
      classifier.classify({
        message: "  explain it  ",
        projection: "",
        workspace: emptyWorkspace(),
      }),
    ).resolves.toEqual(output);
  });

  it("throws explicitly for a missing mock script", async () => {
    const classifier = createMockTurnClassifier({});

    await expect(
      classifier.classify({
        message: "not scripted",
        projection: "",
        workspace: emptyWorkspace(),
      }),
    ).rejects.toThrow('mock classifier: no script for "not scripted"');
  });
});

function emptyWorkspace() {
  return {
    codeState: "missing" as const,
    currentCodeLength: 0,
    selectedTestCount: 0,
    hasAssistantCandidate: false,
  };
}
