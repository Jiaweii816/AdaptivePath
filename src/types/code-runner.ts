import { z } from "zod";
import { failureProvenanceSchema } from "./evidence";

export const codeRunStatusSchema = z.enum([
  "passed_visible_tests",
  "failed",
  "compile_error",
  "syntax_error",
  "runtime_error",
  "timeout",
  "no_tests",
  "runner_error",
  "empty_code",
  "unsupported_language",
]);

export const codeRunnerLanguageSchema = z.enum(["Python", "C++"]);

export const codeRunTestStatusSchema = z.enum([
  "not_run",
  "running",
  "passed",
  "failed",
  "runtime_error",
  "compile_error",
  "timeout",
  "internal_error",
]);

export const codeRunTestCaseSchema = z.object({
  id: z.string(),
  label: z.string(),
  input: z.unknown(),
  expected: z.unknown(),
  source: z.string().optional(),
});

export const codeRunErrorLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
  message: z.string().optional(),
});

export const codeRunErrorDetailKindSchema = z.enum([
  "compile_error",
  "syntax_error",
  "invalid_numeric_conversion",
  "index_out_of_range",
  "missing_key",
  "divide_by_zero",
  "recursion_or_stack_overflow",
  "assertion_failure",
  "memory_exhausted",
  "process_aborted",
  "segmentation_fault",
  "uncaught_exception",
  "timeout",
  "runner_unavailable",
  "user_input",
  "unknown",
]);

export const codeRunErrorDetailSchema = z.object({
  kind: codeRunErrorDetailKindSchema,
  title: z.string(),
  summary: z.string(),
  likelyCauses: z.array(z.string()).default([]),
  nextStep: z.string().optional(),
  rawMessage: z.string().optional(),
});

export const codeRunTestResultSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    input: z.unknown(),
    expected: z.unknown(),
    actual: z.unknown().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    stdoutCaptured: z.boolean().optional(),
    stderrCaptured: z.boolean().optional(),
    passed: z.boolean(),
    error: z.string().optional(),
    errorLocation: codeRunErrorLocationSchema.optional(),
    status: codeRunTestStatusSchema.optional(),
  })
  .transform((result) => ({
    ...result,
    status: result.status ?? (result.passed ? "passed" : "failed"),
  }));

export const codeRunFirstFailedCaseSchema = z.object({
  id: z.string(),
  label: z.string(),
  input: z.unknown(),
  expected: z.unknown(),
  actual: z.unknown().optional(),
  error: z.string().optional(),
  errorLocation: codeRunErrorLocationSchema.optional(),
});

export const codeRunResultSchema = z.object({
  status: codeRunStatusSchema,
  failureProvenance: failureProvenanceSchema.optional(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  actualOutput: z.string().optional(),
  expectedOutput: z.string().optional(),
  errorLocation: codeRunErrorLocationSchema.optional(),
  errorDetail: codeRunErrorDetailSchema.optional(),
  firstFailedCase: codeRunFirstFailedCaseSchema.optional(),
  testResults: z.array(codeRunTestResultSchema),
  rawResult: z.unknown().optional(),
});

export type CodeRunStatus = z.infer<typeof codeRunStatusSchema>;
export type CodeRunErrorDetailKind = z.infer<
  typeof codeRunErrorDetailKindSchema
>;
export type CodeRunErrorDetail = z.infer<typeof codeRunErrorDetailSchema>;
export type CodeRunTestStatus = z.infer<typeof codeRunTestStatusSchema>;
export type CodeRunnerLanguage = z.infer<typeof codeRunnerLanguageSchema>;
export type CodeRunTestCase = z.infer<typeof codeRunTestCaseSchema>;
export type CodeRunErrorLocation = z.infer<typeof codeRunErrorLocationSchema>;
export type CodeRunTestResult = z.infer<typeof codeRunTestResultSchema>;
export type CodeRunFirstFailedCase = z.infer<
  typeof codeRunFirstFailedCaseSchema
>;
export type CodeRunResult = z.infer<typeof codeRunResultSchema>;
