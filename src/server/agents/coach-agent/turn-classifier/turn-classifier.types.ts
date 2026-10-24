import type { TraceContext } from "@/server/llm/trace-context";
import type { CodeRunnerLanguage } from "@/types/code-runner";

import type { CurrentWorkspaceContext } from "../coach-agent.types";
import type { ClassifierOutput } from "./classifier-output.schema";

export type ClassifierWorkspaceContext = Readonly<{
  language?: CodeRunnerLanguage;
  codeState: CurrentWorkspaceContext["codeState"];
  currentCodeLength: number;
  selectedTestCount: number;
  hasAssistantCandidate: boolean;
}>;

export type ClassifierContext = {
  message: string;
  projection: string;
  workspace: ClassifierWorkspaceContext;
  traceContext?: TraceContext;
};

export type TurnClassifier = {
  classify(ctx: ClassifierContext): Promise<ClassifierOutput>;
};
