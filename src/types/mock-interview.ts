import { z } from "zod";
import {
  codeRunnerLanguageSchema,
  codeRunResultSchema,
} from "./code-runner";
import { memoryUpdateCandidateSchema } from "./coach";

export const mockInterviewPhaseSchema = z.enum([
  "intro",
  "technical_screen",
  "coding",
  "code_discussion",
  "wrap_up",
]);
export type MockInterviewPhase = z.infer<typeof mockInterviewPhaseSchema>;

export const mockInterviewStatusSchema = z.enum([
  "in_progress",
  "completed",
  "cancelled",
]);
export type MockInterviewStatus = z.infer<typeof mockInterviewStatusSchema>;

export const mockInterviewTurnRoleSchema = z.enum([
  "interviewer",
  "candidate",
  "system",
]);
export type MockInterviewTurnRole = z.infer<
  typeof mockInterviewTurnRoleSchema
>;

export const mockInterviewSignalSchema = z.enum([
  "strong",
  "acceptable",
  "needs_work",
  "risky",
]);
export type MockInterviewSignal = z.infer<typeof mockInterviewSignalSchema>;

export const mockInterviewStartRequestSchema = z.object({
  problemId: z.string().optional(),
  problemSlug: z.string().optional(),
  planItemId: z.string().optional(),
  targetLabel: z.string().trim().max(120).optional(),
  focusTags: z.array(z.string().trim().min(1)).max(8).default([]),
  language: codeRunnerLanguageSchema.default("Python"),
  responseLanguage: z.enum(["zh", "en"]).optional(),
});
export type MockInterviewStartRequest = z.infer<
  typeof mockInterviewStartRequestSchema
>;

export const mockInterviewRespondRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(6000),
  responseLanguage: z.enum(["zh", "en"]).optional(),
});
export type MockInterviewRespondRequest = z.infer<
  typeof mockInterviewRespondRequestSchema
>;

export const mockInterviewRunCodeRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  language: codeRunnerLanguageSchema,
  code: z.string(),
  selectedTestCaseIds: z.array(z.string()).default([]),
});
export type MockInterviewRunCodeRequest = z.infer<
  typeof mockInterviewRunCodeRequestSchema
>;

export const mockInterviewSendCodeRequestSchema =
  mockInterviewRunCodeRequestSchema.extend({
    message: z.string().trim().max(1000).optional(),
  });
export type MockInterviewSendCodeRequest = z.infer<
  typeof mockInterviewSendCodeRequestSchema
>;

export const mockInterviewCompleteRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  responseLanguage: z.enum(["zh", "en"]).optional(),
});
export type MockInterviewCompleteRequest = z.infer<
  typeof mockInterviewCompleteRequestSchema
>;

export const mockInterviewTurnDtoSchema = z.object({
  id: z.string(),
  role: mockInterviewTurnRoleSchema,
  contentMarkdown: z.string(),
  phase: mockInterviewPhaseSchema,
  sequence: z.number().int(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type MockInterviewTurnDto = z.infer<
  typeof mockInterviewTurnDtoSchema
>;

export const mockInterviewProblemDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  leetcodeNumber: z.number().nullable(),
  hot150Order: z.number().int().positive().nullable(),
  hot150Section: z.string().nullable(),
  difficulty: z.string().nullable(),
  tags: z.array(z.string()),
  statementMarkdown: z.string(),
  examples: z.array(
    z.object({
      input: z.unknown(),
      output: z.unknown(),
      explanation: z.string().optional(),
    }),
  ),
  constraints: z.array(z.string()),
  isDemoSupported: z.boolean(),
  starterCode: z.record(codeRunnerLanguageSchema, z.string()),
  testCases: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      input: z.unknown(),
      expected: z.unknown(),
      source: z.string(),
    }),
  ),
});
export type MockInterviewProblemDto = z.infer<
  typeof mockInterviewProblemDtoSchema
>;

export const mockInterviewSessionDtoSchema = z.object({
  id: z.string(),
  status: mockInterviewStatusSchema,
  currentPhase: mockInterviewPhaseSchema,
  questionCount: z.number().int().nonnegative(),
  maxQuestions: z.number().int().positive(),
  durationMinutes: z.number().int().positive(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  targetLabel: z.string().nullable(),
  focusTags: z.array(z.string()),
  language: codeRunnerLanguageSchema,
  planItemId: z.string().nullable(),
});
export type MockInterviewSessionDto = z.infer<
  typeof mockInterviewSessionDtoSchema
>;

export const mockInterviewScoresSchema = z.object({
  communication: z.number().min(0).max(1),
  problemDecomposition: z.number().min(0).max(1),
  correctness: z.number().min(0).max(1),
  complexityReasoning: z.number().min(0).max(1),
  debuggingWithEvidence: z.number().min(0).max(1),
  codeQuality: z.number().min(0).max(1),
});
export type MockInterviewScores = z.infer<typeof mockInterviewScoresSchema>;

export const mockInterviewReportSchema = z.object({
  verdict: z.string().trim().min(1),
  overallSignal: mockInterviewSignalSchema,
  scores: mockInterviewScoresSchema,
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  missedFollowUps: z.array(z.string()).default([]),
  codeNotes: z.array(z.string()).default([]),
  recommendations: z
    .array(
      z.object({
        tag: z.string(),
        reason: z.string(),
        problemSlug: z.string().optional(),
      }),
    )
    .default([]),
  memoryUpdateCandidate: memoryUpdateCandidateSchema.default({ facts: [] }),
});
export type MockInterviewReport = z.infer<typeof mockInterviewReportSchema>;

export const mockInterviewStartResponseSchema = z.object({
  ok: z.literal(true),
  session: mockInterviewSessionDtoSchema,
  problem: mockInterviewProblemDtoSchema,
  firstTurn: mockInterviewTurnDtoSchema,
});
export type MockInterviewStartResponse = z.infer<
  typeof mockInterviewStartResponseSchema
>;

export const mockInterviewTurnResponseSchema = z.object({
  ok: z.literal(true),
  session: mockInterviewSessionDtoSchema,
  candidateTurn: mockInterviewTurnDtoSchema.optional(),
  interviewerTurn: mockInterviewTurnDtoSchema,
});
export type MockInterviewTurnResponse = z.infer<
  typeof mockInterviewTurnResponseSchema
>;

export const mockInterviewRunCodeResponseSchema = z.object({
  ok: z.literal(true),
  codeSnapshotId: z.string(),
  runEvidenceId: z.string(),
  runResult: codeRunResultSchema,
});
export type MockInterviewRunCodeResponse = z.infer<
  typeof mockInterviewRunCodeResponseSchema
>;

export const mockInterviewCompleteResponseSchema = z.object({
  ok: z.literal(true),
  session: mockInterviewSessionDtoSchema,
  feedbackId: z.string(),
  reportMarkdown: z.string(),
  report: mockInterviewReportSchema,
});
export type MockInterviewCompleteResponse = z.infer<
  typeof mockInterviewCompleteResponseSchema
>;
