import type { createChatToolRuntime } from "@/server/tools/chat-tools/chat-tool-runtime";
import type { ActionOutcome } from "@/server/tools/chat-tools/durable-write-result-semantics";
import type { RequiredActionLedger } from "@/server/tools/chat-tools/required-action-ledger";
import type { SafeProtocolLeakSummary } from "@/server/llm/tool-protocol-leak";
import type {
  CoachChatInput,
  CoachChatLoopMessage,
  CoachProvider,
  CurrentWorkspaceContext,
} from "./coach-agent.types";
import type {
  ChatToolManifestEntry,
  ChatToolName,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import type {
  ChatReplyResult,
  ChatToolStopReason,
} from "./chat-reply-contracts";
import type { BootstrappedChatTurn } from "./chat-turn-bootstrap";
import type {
  FinalChatTurnContext,
  LoadedChatTurnContext,
} from "./chat-turn-context";
import type { TurnCapabilityPolicy } from "./turn-capability-policy";
import type { CapabilityPlan } from "./capability-planner";

export type ChatToolRuntime = ReturnType<typeof createChatToolRuntime>;

export type ChatLoopState = {
  turn: BootstrappedChatTurn;
  context: LoadedChatTurnContext;
  finalContext: FinalChatTurnContext;
  userMessage: { id: string; sequence: number };
  provider: CoachProvider;
  loopMessages: CoachChatLoopMessage[];
  toolTrace: ChatReplyResult["toolTrace"];
  toolIterations: number;
  toolBudgetReached: boolean;
  effectiveWorkspaceContext: CurrentWorkspaceContext;
  explicitlyDeniedDurableTools: ReadonlySet<ChatReplyResult["toolTrace"][number]["name"]>;
  topologyToolOrder: ReadonlyMap<ChatToolName, number>;
  requiredActionLedger: RequiredActionLedger;
  toolRuntime: ChatToolRuntime;
  deepReasoning: boolean;
  baseCoachInput: Omit<CoachChatInput, "messages">;
  frozenSystemPrompt?: string;
  loadedToolNames: Set<ChatToolName>;
  capabilityPolicy: TurnCapabilityPolicy;
  capabilityPlan: CapabilityPlan;
  discoveryCalls: number;
  coachReply?: string;
  usedToolBudgetFallback: boolean;
  protocolViolation?: SafeProtocolLeakSummary;
  actionOutcomes: ActionOutcome[];
  toolStopReason: ChatToolStopReason;
  actionOutcomeBlockAlreadyRendered: boolean;
  noToolTurn: boolean;
  pureDurableActionTurn: boolean;
};

export type ChatLoopResult = Pick<
  ChatLoopState,
  | "coachReply"
  | "toolTrace"
  | "toolIterations"
  | "toolBudgetReached"
  | "effectiveWorkspaceContext"
  | "requiredActionLedger"
  | "toolRuntime"
  | "deepReasoning"
  | "usedToolBudgetFallback"
  | "protocolViolation"
  | "actionOutcomes"
  | "toolStopReason"
  | "actionOutcomeBlockAlreadyRendered"
> & {
  coachReply: string;
  selfCorrectionMarkerDetected: boolean;
  requiredActionProjection: Array<{
    toolName: string;
    order: number;
    status: string;
    terminalReason: string | null;
  }>;
};
