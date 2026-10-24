import type { PrismaClient } from "@prisma/client";
import type { FtsStore } from "@/server/memory/store/fts-store";
import { z } from "zod";
import {
  codeRunnerLanguageSchema,
  type CodeRunResult,
  type CodeRunnerLanguage,
} from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";
import type { WorkspaceTraceTurnInfo } from "@/server/observability/runtime-trace-request";
import {
  requireRuntimeTraceActionContext,
  runtimeTraceActionRequestFields,
} from "@/server/observability/runtime-trace-request";
import type { ReviewClientMemoryBrief } from "./review-memory-client-projection";
import type { CoachProvider } from "./coach-agent.types";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";

const MAX_REVIEW_ACTIVE_SECONDS = 14_400;

const activeSecondsSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.min(Math.floor(seconds), MAX_REVIEW_ACTIVE_SECONDS);
}, z.number().int().min(0).max(MAX_REVIEW_ACTIVE_SECONDS).optional());

export const reviewRequestSchema = z
  .object({
    problemId: z.string().optional(),
    problemSlug: z.string().optional(),
    language: codeRunnerLanguageSchema,
    code: z.string(),
    selectedTestCaseIds: z.array(z.string()).default([]),
    activeSeconds: activeSecondsSchema,
    planItemId: z.string().optional(),
    userState: z.string().trim().max(500).optional(),
    userQuestion: z.string().trim().max(2000).optional(),
    responseLanguage: z.enum(["zh", "en"]).optional(),
    ...runtimeTraceActionRequestFields,
  })
  .refine((value) => value.problemId || value.problemSlug, {
    message: "A problemId or problemSlug is required.",
    path: ["problemId"],
  })
  .superRefine(requireRuntimeTraceActionContext);

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export type ReviewPipelineResult = {
  ok: true;
  problem: { id: string; slug: string; title: string };
  chatSessionId: string;
  reviewAttemptId: string;
  problemHistoryId: string;
  runResult: CodeRunResult;
  evidence: {
    source: "review";
    language: CodeRunnerLanguage;
    selectedTestCaseIds: string[];
    runnerProvider: string;
    evidenceSource: string;
    evidenceVerdict: EvidenceVerdict;
    runResult: CodeRunResult;
  };
  diagnosis: CoachReviewResult["diagnosis"];
  coachReply: string;
  memoryBrief: ReviewClientMemoryBrief;
  degraded?: CoachReviewResult["degraded"];
  trace?: WorkspaceTraceTurnInfo;
};

export type ReviewEvidenceProgress = {
  type: "evidence";
  evidence: ReviewPipelineResult["evidence"];
};

export type ReviewProgressEvent = ReviewEvidenceProgress;

export type ReviewPipelineDeps = {
  prisma?: PrismaClient;
  coachProvider?: CoachProvider;
  codeRunnerProvider?: CodeRunnerProvider;
  ftsStore?: FtsStore;
  backgroundJobsPolicy?: "enabled" | "disabled";
  onProgress?: (event: ReviewProgressEvent) => void | Promise<void>;
};

export class ReviewPipelineError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ReviewPipelineError";
  }
}
