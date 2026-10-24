import { z } from "zod";
import {
  codeRunnerLanguageSchema,
  codeRunResultSchema,
  codeRunTestCaseSchema,
} from "@/types/code-runner";
import type {
  CodeRunnerLanguage,
  CodeRunResult,
  CodeRunTestCase,
} from "@/types/code-runner";

export const codeRunnerProblemSchema = z.object({
  slug: z.string(),
  title: z.string(),
  leetcodeNumber: z.number().int().nullable().optional(),
  methodName: z.string(),
  tags: z.array(z.string()).default([]),
  inputContract: z.unknown().optional(),
  outputContract: z
    .object({
      type: z.string(),
      orderMatters: z.boolean().optional(),
    })
    .optional(),
  isDemoSupported: z.boolean().optional(),
  localRunStatus: z.string().optional(),
  localRunStatusMessage: z.string().nullable().optional(),
  comparisonStrategy: z.string().optional(),
  comparisonConfig: z.record(z.string(), z.unknown()).optional(),
  contractKind: z.string().optional(),
});

export const codeRunnerLimitsSchema = z.object({
  runTimeoutMs: z.number().int().positive().default(2000),
  compileTimeoutMs: z.number().int().positive().default(5000),
  memoryLimitBytes: z.number().int().positive().default(128 * 1024 * 1024),
});

export const codeRunnerExecutionKindSchema = z.enum([
  "review",
  "chat_run",
  "visible_run",
]);

export const codeRunnerInputSchema = z.object({
  problem: codeRunnerProblemSchema,
  language: codeRunnerLanguageSchema,
  code: z.string(),
  testCases: z.array(codeRunTestCaseSchema),
  executionKind: codeRunnerExecutionKindSchema.default("review"),
  limits: codeRunnerLimitsSchema.optional(),
});

export const codeRunnerProviderResultSchema = codeRunResultSchema;

export type CodeRunnerProblem = z.infer<typeof codeRunnerProblemSchema>;
export type CodeRunnerLimits = z.infer<typeof codeRunnerLimitsSchema>;
export type CodeRunnerExecutionKind = z.infer<
  typeof codeRunnerExecutionKindSchema
>;
export type CodeRunnerInput = {
  problem: CodeRunnerProblem;
  language: CodeRunnerLanguage;
  code: string;
  testCases: CodeRunTestCase[];
  executionKind?: CodeRunnerExecutionKind;
  limits?: Partial<CodeRunnerLimits>;
};

export type CodeRunnerProvider = {
  run(input: CodeRunnerInput): Promise<CodeRunResult>;
};
