import type { CodeRunTestCase } from "@/types/code-runner";

export type DemoProblemAdapter = {
  slug: string;
  methodName: string;
  orderMatters: boolean;
  buildCppCase: (testCase: CodeRunTestCase, index: number) => string;
};

export function jsonForHarness(value: unknown) {
  return JSON.stringify(value);
}

export function cppStringLiteral(value: string) {
  return JSON.stringify(value);
}

export function cppIntLiteral(value: unknown, name: string) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer for the fixed C++ adapter.`);
  }

  return String(value);
}

export function cppStringValueLiteral(value: unknown, name: string) {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string for the fixed C++ adapter.`);
  }

  return JSON.stringify(value);
}

export function cppIntVectorLiteral(value: unknown, name: string) {
  if (
    !Array.isArray(value) ||
    !value.every((item) => Number.isInteger(item))
  ) {
    throw new Error(`${name} must be an integer array for the fixed C++ adapter.`);
  }

  return `{${value.join(", ")}}`;
}

export function objectField(input: unknown, field: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Test input must be an object with field ${field}.`);
  }

  return (input as Record<string, unknown>)[field];
}

export function addCppCaseResult(args: {
  testCase: CodeRunTestCase;
  actualJsonExpression: string;
  expectedJsonExpression: string;
  passedExpression: string;
}) {
  return [
    "__pc_add_case(",
    `  ${cppStringLiteral(args.testCase.id)},`,
    `  ${cppStringLiteral(args.testCase.label)},`,
    `  ${cppStringLiteral(jsonForHarness(args.testCase.input))},`,
    `  ${args.expectedJsonExpression},`,
    `  ${args.actualJsonExpression},`,
    `  ${args.passedExpression}`,
    ");",
  ].join("\n");
}
