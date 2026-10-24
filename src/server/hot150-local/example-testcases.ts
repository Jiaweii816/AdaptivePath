import type { ProblemExecutionContract } from "@/data/hot150/local-run-types";

export type StructuredExampleInput = {
  dataInput: string;
  input: Record<string, unknown>;
};

export function splitLeetCodeExampleTestcases(
  exampleTestcases: string,
  contract: ProblemExecutionContract,
): StructuredExampleInput[] {
  const lines = exampleTestcases
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (contract.contractKind === "design_class") {
    return splitDesignClassExampleTestcases(lines);
  }

  const params = contract.params;
  const parameterCount = Math.max(1, params.length);
  const examples: StructuredExampleInput[] = [];

  for (let index = 0; index < lines.length; index += parameterCount) {
    const chunk = lines.slice(index, index + parameterCount);

    if (chunk.length !== parameterCount || params.length === 0) {
      continue;
    }

    examples.push({
      dataInput: chunk.join("\n"),
      input: Object.fromEntries(
        params.map((param, paramIndex) => [
          param.name,
          parseLeetCodeLiteral(chunk[paramIndex] ?? "null"),
        ]),
      ),
    });
  }

  return examples;
}

export function inferDesignClassContractFromExampleTestcases(
  exampleTestcases: string,
): ProblemExecutionContract | null {
  const lines = exampleTestcases
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstOperations = parseLeetCodeLiteral(lines[0] ?? "null");
  const firstArguments = parseLeetCodeLiteral(lines[1] ?? "null");

  if (
    !Array.isArray(firstOperations) ||
    !Array.isArray(firstArguments) ||
    firstOperations.length === 0 ||
    firstOperations.length !== firstArguments.length ||
    !firstOperations.every((operation) => typeof operation === "string") ||
    !firstArguments.every((args) => Array.isArray(args))
  ) {
    return null;
  }

  const className = firstOperations[0];

  if (!className || !/^[A-Z]/.test(className)) {
    return null;
  }

  return {
    name: className,
    params: [],
    returnType: "unknown",
    contractKind: "design_class",
  };
}

function splitDesignClassExampleTestcases(
  lines: string[],
): StructuredExampleInput[] {
  const examples: StructuredExampleInput[] = [];

  for (let index = 0; index < lines.length; index += 2) {
    const operations = parseLeetCodeLiteral(lines[index] ?? "null");
    const argumentsList = parseLeetCodeLiteral(lines[index + 1] ?? "null");

    if (
      !Array.isArray(operations) ||
      !Array.isArray(argumentsList) ||
      operations.length === 0 ||
      operations.length !== argumentsList.length ||
      !operations.every((operation) => typeof operation === "string")
    ) {
      continue;
    }

    examples.push({
      dataInput: [lines[index], lines[index + 1]].join("\n"),
      input: {
        operations,
        arguments: argumentsList,
      },
    });
  }

  return examples;
}

export function parseLeetCodeLiteral(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function htmlToPlainMarkdown(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<pre>/gi, "\n```text\n")
      .replace(/<\/pre>/gi, "\n```\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
