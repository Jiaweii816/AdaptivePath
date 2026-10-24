import type { PrismaClient } from "@prisma/client";
import type { CoachProvider } from "@/server/agents/coach-agent/coach-agent.types";
import type { InterviewerProvider } from "@/server/agents/interviewer-agent/interviewer-agent.types";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";

export type EvalBackgroundJobsPolicy = "disabled" | "drain";

export type EvalTraceOptions = {
  enabled: boolean;
};

export type EvalRuntime = {
  prisma: PrismaClient;
  dbPath: string;
  suiteName: string;
  runId: string;
  generatedAt: Date;
  backgroundJobsPolicy: EvalBackgroundJobsPolicy;
  traceOptions: EvalTraceOptions;
  coachProvider?: CoachProvider;
  codeRunnerProvider?: CodeRunnerProvider;
  interviewerProvider?: InterviewerProvider;
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export type EvalRuntimeConfig = Omit<EvalRuntime, "prisma">;
