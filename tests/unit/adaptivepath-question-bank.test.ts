import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONCEPTS, getConcept } from "@/features/adaptivepath/concepts";
import {
  getBankQuestion,
  isCorrectOption,
  listQuestions,
  toClientQuestion,
} from "@/features/adaptivepath/question-bank";

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("biology concepts", () => {
  it("lists 10 concepts in id order", () => {
    expect(CONCEPTS.map((c) => c.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `b2e-12-2-concept-${String(i + 1).padStart(2, "0")}`),
    );
    expect(getConcept("b2e-12-2-concept-04").nameZh).toBe("测交与抽样不确定性");
  });

  it("orders every prerequisite before its dependent concept", () => {
    CONCEPTS.forEach((concept, index) => {
      for (const prerequisite of concept.prerequisiteIds) {
        expect(CONCEPTS.findIndex((c) => c.id === prerequisite)).toBeLessThan(index);
      }
    });
  });

  it("rejects unknown concept ids", () => {
    expect(() => getConcept("nope")).toThrow();
  });
});

describe("biology question bank", () => {
  it("holds 300 single-concept and 20 integrated questions", () => {
    const questions = listQuestions();
    expect(questions).toHaveLength(320);
    for (const concept of CONCEPTS) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        const matching = questions.filter(
          (q) => q.primaryConceptId === concept.id && q.difficulty === difficulty,
        );
        expect(matching, `${concept.id} ${difficulty}`).toHaveLength(10);
      }
    }
    const integrated = questions.filter((q) => q.questionType === "integrated");
    expect(integrated).toHaveLength(20);
    expect(integrated.every((q) => q.primaryConceptId === null && q.conceptIds.length === 3)).toBe(true);
    expect(new Set(questions.map((q) => q.id)).size).toBe(320);
  });

  it("strips answers from the client view", () => {
    for (const view of listQuestions().map(toClientQuestion)) {
      const keys = Object.keys(view);
      expect(keys).not.toContain("correctAnswer");
      expect(keys).not.toContain("explanation");
      expect(keys).not.toContain("option_explanations");
      expect(keys).not.toContain("optionExplanations");
    }
    expect(toClientQuestion(listQuestions()[0]).assumptions.length).toBeGreaterThan(0);
  });

  it("every question has four option explanations", () => {
    for (const question of listQuestions()) {
      expect(Object.keys(question.optionExplanations).sort(), question.id).toEqual(question.options.map((o) => o.id).sort());
      expect(Object.values(question.optionExplanations).every((text) => text.trim().length > 0)).toBe(true);
    }
  });

  it("grades a valid option and rejects unknown options", () => {
    const question = getBankQuestion("b2e-12-2-q-c04-easy-01");
    expect(isCorrectOption(question, "A")).toBe(true);
    expect(isCorrectOption(question, "B")).toBe(false);
    expect(() => isCorrectOption(question, "Z")).toThrow("Invalid answer option");
    expect(() => getBankQuestion("nope")).toThrow();
  });

  it("is never imported by client components", () => {
    const offenders = clientFiles(join(process.cwd(), "src/features/adaptivepath"))
      .concat(clientFiles(join(process.cwd(), "app/adaptivepath")))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return source.includes('"use client"') && source.includes("question-bank");
      });
    expect(offenders).toEqual([]);
  });
});
