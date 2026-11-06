import { describe, expect, it } from "vitest";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { hintStep, selectCoachTool } from "@/features/adaptivepath/memory/coach-policy";
import { OFFLINE_CONCEPT_HINTS, offlineTutorReply } from "@/features/adaptivepath/memory/offline-hints";
import {
  buildTutorMemoryContext,
  EXCERPT_CHARS,
  type TutorEvidence,
} from "@/features/adaptivepath/memory/tutor-context";
import type { JudgmentState, MasteryLevel } from "@/features/adaptivepath/memory/types";

const id = (n: number) => `b2e-12-2-concept-${String(n).padStart(2, "0")}`;

function judged(entries: Array<[number, MasteryLevel, number]>): ReadonlyMap<string, JudgmentState> {
  return new Map(entries.map(([n, level, stability]) => [
    id(n),
    { conceptId: id(n), level, stability, supportStreak: 0, ruleVersion: "bio-l2-v1" },
  ]));
}

function evidence(n: number, conceptIds: string[], explanation = "because alleles segregate"): TutorEvidence {
  return {
    l1EventId: `l1-${n}`, attemptId: `a-${n}`, questionId: `q-${n}`, questionType: "single_concept",
    conceptIds, difficulty: "easy", selectedOption: "A", correct: n % 2 === 0, tutorUsed: false,
    referenceUsed: false, condition: 3, submittedAt: new Date(Date.UTC(2026, 9, 31, 0, 0, n)).toISOString(),
    explanation,
  };
}

describe("tutor policy", () => {
  it("maps the weakest level to a tool", () => {
    expect(selectCoachTool([null])).toBe("worked_example");
    expect(selectCoachTool([0])).toBe("worked_example");
    expect(selectCoachTool([1])).toBe("guided_hint");
    expect(selectCoachTool([2])).toBe("reference_pointer");
    expect(selectCoachTool([3])).toBe("socratic_probe");
    expect(selectCoachTool([3, 0, 2])).toBe("worked_example");
    expect(selectCoachTool([3, null])).toBe("worked_example");
  });

  it("climbs the hint ladder and stops at step 3", () => {
    expect(hintStep(0)).toBe(1);
    expect(hintStep(1)).toBe(2);
    expect(hintStep(5)).toBe(3);
  });
});

describe("tutor memory context", () => {
  it("bounds judgments and evidence", () => {
    const attempts = Array.from({ length: 8 }, (_, i) => evidence(i, [id(4)], "x".repeat(400)));
    const context = buildTutorMemoryContext({
      questionConceptIds: [id(4)], states: judged([[2, 1, 40], [3, 0, 70], [4, 1, 40]]), attempts, concepts: CONCEPTS,
    });
    expect(context.judgments.length).toBeLessThanOrEqual(2);
    expect(context.evidence).toHaveLength(5);
    expect(context.evidence.every((e) => e.explanationExcerpt.length <= EXCERPT_CHARS)).toBe(true);
    expect(context.evidence[0].questionId).toBe("q-7");
  });

  it("adds the weakest judged prerequisite", () => {
    const context = buildTutorMemoryContext({
      questionConceptIds: [id(4)], states: judged([[2, 1, 40], [3, 0, 70], [4, 1, 40]]), attempts: [], concepts: CONCEPTS,
    });
    expect(context.judgments.map((j) => j.conceptId)).toEqual([id(4), id(3)]);
  });

  it("uses the two weakest judged concepts of an integrated question", () => {
    const context = buildTutorMemoryContext({
      questionConceptIds: [id(2), id(3), id(4)], states: judged([[2, 3, 70], [3, 1, 40], [4, 1, 70]]), attempts: [], concepts: CONCEPTS,
    });
    expect(context.judgments.map((j) => j.conceptId)).toEqual([id(3), id(4)]);
  });

  it("only includes evidence for the selected concepts", () => {
    const context = buildTutorMemoryContext({
      questionConceptIds: [id(4)], states: judged([[4, 1, 40]]),
      attempts: [evidence(1, [id(4)]), evidence(2, [id(9)])], concepts: CONCEPTS,
    });
    expect(context.evidence.map((e) => e.questionId)).toEqual(["q-1"]);
  });

  it("never carries answers or selected options", () => {
    const context = buildTutorMemoryContext({
      questionConceptIds: [id(4)], states: judged([[4, 1, 40]]), attempts: [evidence(1, [id(4)])], concepts: CONCEPTS,
    });
    const serialized = JSON.stringify(context);
    for (const key of ["correctAnswer", "\"explanation\"", "selectedOption"]) expect(serialized).not.toContain(key);
  });
});

describe("offline tutor", () => {
  it("has one hint per concept", () => {
    expect(Object.keys(OFFLINE_CONCEPT_HINTS).sort()).toEqual(CONCEPTS.map((c) => c.id));
  });

  it("points to the textbook subsection for reference_pointer", () => {
    const reply = offlineTutorReply({
      tool: "reference_pointer", conceptIds: [id(4)], hintStep: 1, subsections: ["The Test Cross Distinguishes the Dominant Phenotype"],
    });
    expect(reply).toContain("The Test Cross Distinguishes the Dominant Phenotype");
  });

  it("varies the guided hint by ladder step", () => {
    const steps = [1, 2, 3] as const;
    const replies = steps.map((hintStep) => offlineTutorReply({ tool: "guided_hint", conceptIds: [id(4)], hintStep, subsections: ["Sec"] }));
    expect(new Set(replies).size).toBe(3);
  });
});
