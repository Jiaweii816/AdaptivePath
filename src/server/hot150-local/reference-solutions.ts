import { z } from "zod";

export const hot150ReferenceSolutionSchema = z.object({
  leetcodeNumber: z.number().int().positive(),
  title: z.string().min(1),
  code: z.string().min(1),
});

export type Hot150ReferenceSolution = z.infer<
  typeof hot150ReferenceSolutionSchema
>;

export function parseHot150ReferenceSolutions(markdown: string) {
  const headingPattern = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  const solutions: Hot150ReferenceSolution[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const start = match.index ?? 0;
    const end = next?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const leetcodeNumber = Number(match[1]);
    const title = cleanTitle(match[2] ?? "");
    const code = extractPythonCode(section);

    if (!code) {
      throw new Error(`Missing Python code block for LC ${leetcodeNumber}.`);
    }

    if (seen.has(leetcodeNumber)) {
      throw new Error(`Duplicate reference solution for LC ${leetcodeNumber}.`);
    }

    seen.add(leetcodeNumber);
    solutions.push(
      hot150ReferenceSolutionSchema.parse({ leetcodeNumber, title, code }),
    );
  }

  if (solutions.length !== 150) {
    throw new Error(
      `Expected 150 Hot-150 reference solutions, found ${solutions.length}.`,
    );
  }

  return solutions;
}

export function mapReferenceSolutionsByNumber(
  solutions: Hot150ReferenceSolution[],
) {
  return new Map(solutions.map((solution) => [solution.leetcodeNumber, solution]));
}

function extractPythonCode(section: string) {
  const match = section.match(/```python\s*\n([\s\S]*?)```/);

  return match?.[1]?.trim() ?? "";
}

function cleanTitle(value: string) {
  return value.replace(/（.*?）/g, "").replace(/\(.*?\)$/g, "").trim();
}
