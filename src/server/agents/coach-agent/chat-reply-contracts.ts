import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { runtimeTraceActionRequestFields } from "@/server/observability/runtime-trace-request";
import { requireRuntimeTraceActionContext } from "@/server/observability/runtime-trace-request";
import type { WorkspaceTraceTurnInfo } from "@/server/observability/runtime-trace-request";
import type { FtsStore } from "@/server/memory/store/fts-store";
import type { ChatToolRuntimeSnapshot } from "@/server/tools/chat-tools/chat-tool-runtime";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { RequiredActionLedger } from "@/server/tools/chat-tools/required-action-ledger";
import type { ActionOutcome } from "@/server/tools/chat-tools/durable-write-result-semantics";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";
import { codeRunnerLanguageSchema } from "@/types/code-runner";
import type { CoachProvider } from "./coach-agent.types";
import type { TurnClassifier } from "./turn-classifier/turn-classifier.types";
import type { SemanticTurnClassifier } from "./turn-classifier/semantic-turn-classifier.types";
import type { ModelAssemblerClient } from "./turn-understanding-v2/assembler/model-assembler";

export const chatRequestSchema = z
  .object({
    chatSessionId: z.string().optional(),
    problemId: z.string().optional(),
    problemSlug: z.string().optional(),
    message: z.string().trim().min(1).max(4000),
    language: codeRunnerLanguageSchema.optional(),
    code: z.string().optional(),
    selectedTestCaseIds: z.array(z.string()).default([]),
    responseLanguage: z.enum(["zh", "en"]).optional(),
    ...runtimeTraceActionRequestFields,
  })
  .refine(
    (value) => value.chatSessionId || value.problemId || value.problemSlug,
    {
      message: "A chatSessionId, problemId, or problemSlug is required.",
      path: ["chatSessionId"],
    },
  )
  .superRefine(requireRuntimeTraceActionContext);

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatToolStopReason =
  | "final_reply"
  | "backend_action_outcomes"
  | "round_limit"
  | "request_limit"
  | "execution_limit"
  | "cost_budget"
  | "no_available_tools"
  | "protocol_violation"
  | "tools_disabled";

export type ChatReplyResult = {
  ok: true;
  chatSessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  coachReply: string;
  toolTrace: Array<{
    toolCallId: string;
    name: ChatToolName;
    result: unknown;
    disposition: "executed" | "reused";
  }>;
  toolIterations: number;
  toolBudgetReached: boolean;
  toolRuntime: ChatToolRuntimeSnapshot;
  requiredActions: RequiredActionLedger["actions"];
  actionOutcomes: ActionOutcome[];
  toolStopReason: ChatToolStopReason;
  productInvariantGuard: {
    version: "v1";
    mode: "observe" | "enforce";
    replaced: boolean;
    strategy:
      | "observe_only"
      | "unchanged"
      | "targeted_line_replacement"
      | "full_fallback";
    reasonCodes: string[];
  };
  trace?: WorkspaceTraceTurnInfo;
};

export type ChatReplyDeps = {
  prisma?: PrismaClient;
  coachProvider?: CoachProvider;
  codeRunnerProvider?: CodeRunnerProvider;
  turnClassifier?: TurnClassifier | null;
  semanticTurnClassifier?: SemanticTurnClassifier | null;
  /** Test seam for the bounded v3 request assembler. `null` disables it. */
  modelAssembler?: ModelAssemblerClient | null;
  backgroundJobsPolicy?: "enabled" | "disabled";
  ftsStore?: FtsStore;
  /** Explicit instrumentation seam for direct-call evals; routes use env configuration. */
  traceStoreCutoverEnabled?: boolean;
};
