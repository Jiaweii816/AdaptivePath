import type { CoachReviewResult } from "@/types/coach";
import type { CodeRunnerLanguage, CodeRunResult } from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import type {
  ChatToolManifestEntry,
  ChatToolName,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import type { SessionPlan } from "@/server/memory/memory.types";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import type { TraceContext } from "@/server/llm/trace-context";
import type { SafeProtocolLeakSummary } from "@/server/llm/tool-protocol-leak";
import type { TurnUnderstanding } from "./turn-understanding/turn-understanding.types";
import type { TurnUnderstandingV2 } from "./turn-understanding-v2/turn-understanding-v2.types";
import type { CampaignCoachingContext } from "@/server/campaign/coaching";
import type { EvidenceAlignment } from "./evidence-alignment";

export type { EvidenceAlignment } from "./evidence-alignment";

export type CoachProblemContext = {
  slug: string;
  title: string;
  leetcodeNumber: number | null;
  tags: string[];
  methodName: string;
  statementMarkdown?: string;
  examples?: readonly unknown[];
  constraints?: readonly unknown[];
};

export type CoachUserContext = {
  displayName: string;
  strongPatterns: string[];
  weakPatterns: string[];
  outputPreferences: string[];
};

export type CoachReviewPlannerContext = {
  currentPlanItemId?: string;
  nextTodayItem?: {
    planItemId?: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    source: string;
  };
};

export type CoachReviewInput = {
  problem: CoachProblemContext;
  user: CoachUserContext;
  memory: CoachMemoryBrief;
  sessionPlan?: SessionPlan;
  planner?: CoachReviewPlannerContext;
  language: CodeRunnerLanguage;
  code: string;
  runResult: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
  userState?: string;
  userQuestion?: string;
  responseLanguage?: "zh" | "en";
  traceContext?: TraceContext;
};

export type CoachChatLoopMessage =
  | {
      role: "user" | "assistant";
      content: string;
    }
  | {
      role: "assistant";
      content?: string;
      toolCalls: CoachToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export type CoachToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type CoachChatIntent =
  | "concept_question"
  | "hint_request"
  | "anxiety_or_stuck"
  | "run_case_request"
  | "execute_failed_ask"
  | "debug_followup"
  | "optimization_request"
  | "full_code_request"
  | "practice_request"
  | "profile_meta_question"
  | "past_problem_recall_request"
  | "past_mistake_recall_request"
  | "mistake_book_save_request"
  | "api_reference_question"
  | "general_followup";

export type CoachCodeDisclosure = "guided" | "full_code";

export type ChatTurnSignals = {
  readonly explicitExecution: boolean;
  readonly candidateVerification: boolean;
  readonly hint: boolean;
  readonly debug: boolean;
  readonly history: boolean;
  readonly practice: boolean;
  readonly optimization: boolean;
  readonly apiReference: boolean;
  readonly handbookLookup: boolean;
  readonly walkthrough: boolean;
};

export type ChatTurnContextNeeds = {
  readonly workspace: boolean;
  readonly currentCode: boolean;
  readonly selectedTests: boolean;
  readonly runEvidence: boolean;
  readonly reviewContext: boolean;
  readonly learnerSignals: boolean;
  readonly handbook: boolean;
  readonly episodes: boolean;
};

/**
 * The single deterministic routing result for a Coach Chat turn.
 *
 * Durable-write capabilities are intentionally absent here: the requested-action
 * ledger owns those explicit state-changing obligations and merges them later.
 */
export type ChatTurnPlan = {
  readonly primaryIntent: CoachChatIntent;
  readonly confidence: number;
  readonly rationale: string;
  readonly codeDisclosure: CoachCodeDisclosure;
  readonly signals: ChatTurnSignals;
  readonly contextNeeds: ChatTurnContextNeeds;
  readonly toolCapabilities: readonly ChatToolName[];
};

export type CoachReviewContext = {
  reviewAttemptId: string;
  problemSlug: string;
  runStatus: string;
  failedCaseSummary?: string;
  userIssueSummary?: string;
  coachSummary?: string;
  mistakeTags: string[];
  skillTags: string[];
  currentConcept?: string;
  suspiciousLine?: string;
  stuckLayer?: string;
};

export type EvidenceProducer = "user_action" | "assistant_tool";
export type EvidenceSubject = "current_user_code" | "assistant_candidate";
export type EvidenceAuthority = "authoritative" | "advisory";
export type EvidenceScope = {
  kind: "selected_suite" | "specific_examples" | "runner_defined";
  totalCount?: number;
};
export type EvidenceOracle = "stored_expected" | "provided_expected" | "runner";

export type CurrentCodeAuthoritativeRunStatus =
  | "authoritative_run_matches_current_code"
  | "current_code_changed_since_authoritative_run"
  | "no_authoritative_run_yet"
  | "unknown_current_code_status";

/**
 * Backend-only evidence. Hashes are intentionally kept here for alignment and
 * trace metadata; this object must never be serialized directly into an LLM
 * message.
 */
export type InternalRunEvidenceEnvelope = {
  id: string;
  storageSource: string;
  producer: EvidenceProducer;
  subject: EvidenceSubject;
  authority: EvidenceAuthority;
  scope: EvidenceScope;
  oracle: EvidenceOracle;
  createdAt: string;
  codeHash?: string | null;
  executionFingerprint?: string | null;
  suiteFingerprint?: string | null;
  result: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
  reviewAttemptId?: string | null;
  candidateDescription?: string;
};

/** Positive, model-facing projection of run evidence. */
export type CoachRunEvidenceView = {
  source: "practice_run" | "review" | "chat_tool";
  producer: EvidenceProducer;
  subject: EvidenceSubject;
  authority: EvidenceAuthority;
  scope: EvidenceScope;
  oracle: EvidenceOracle;
  createdAt: string;
  status: CodeRunResult["status"];
  passedCount: number;
  failedCount: number;
  totalCount?: number;
  durationMs?: number;
  failureProvenance?: CodeRunResult["failureProvenance"];
  firstFailedCase?: {
    id: string;
    label: string;
    actualOutput?: string;
    expectedOutput?: string;
    errorSummary?: string;
    errorLocation?: CodeRunResult["errorLocation"];
  };
  errorLocation?: CodeRunResult["errorLocation"];
  errorDetail?: Omit<NonNullable<CodeRunResult["errorDetail"]>, "rawMessage">;
  evidenceVerdict?: EvidenceVerdict;
  candidateDescription?: string;
};

export type CurrentWorkspaceContext = {
  problem: {
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    tags: string[];
    methodName: string;
    statementMarkdown?: string;
    examples?: readonly unknown[];
    constraints?: readonly unknown[];
  };
  language?: CodeRunnerLanguage;
  currentCode: string;
  currentCodeHash?: string;
  currentExecutionFingerprint?: string;
  currentCodeLength: number;
  currentCodeLineCount: number;
  currentCodeTruncated: boolean;
  codeState: "missing" | "starter_or_placeholder" | "dummy_return" | "formed";
  currentCodeSummary: string;
  selectedTests: Array<{
    id: string;
    label: string;
    source: string;
    input: unknown;
    expected: unknown;
  }>;
  latestAuthoritativeRunEvidence?: InternalRunEvidenceEnvelope;
  currentTurnRunObservations: InternalRunEvidenceEnvelope[];
  currentCodeAuthoritativeRunStatus: CurrentCodeAuthoritativeRunStatus;
  latestRunAlignment: EvidenceAlignment;
  resumedWorkingRunEvidence?: InternalRunEvidenceEnvelope;
  resumedWorkingRunAlignment: EvidenceAlignment;
  latestReviewContext?: CoachReviewContext;
  strengthFallback?: {
    source:
      | "session_plan"
      | "validated_strategy"
      | "l2_strength"
      | "profile_strength"
      | "problem_first_principles";
    tag?: string;
    text: string;
  };
};

export type CoachTeachingState = {
  currentConcept?: string;
  hintLevel: number;
  nextAction: string;
  progressSignal?: string;
};

export type CoachChatPolicy = {
  intent: CoachChatIntent;
  confidence: number;
  rationale: string;
  styleMode:
    "concise" | "diagnostic" | "hint" | "reassuring" | "practice-planning";
  primaryGoal: string;
  responseShape: string;
  tone: string;
  maxMainPoints: number;
  codeDisclosure: CoachCodeDisclosure;
  mustDo: string[];
  avoid: string[];
  nextStepStyle: string;
};

export type CoachChatInteractionState = {
  turnPlan: ChatTurnPlan;
  policy: CoachChatPolicy;
  reviewContext?: CoachReviewContext;
  teachingState: CoachTeachingState;
};

export type CoachChatInput = {
  problem: CoachProblemContext;
  user: CoachUserContext;
  memory: CoachMemoryBrief;
  sessionPlan?: SessionPlan;
  workspaceContext?: CurrentWorkspaceContext;
  messages: CoachChatLoopMessage[];
  lastRunResult?: CodeRunResult;
  interactionState?: CoachChatInteractionState;
  turnUnderstanding?: TurnUnderstanding;
  turnUnderstandingV2?: TurnUnderstandingV2;
  campaignCoaching?: CampaignCoachingContext;
  responseLanguage?: "zh" | "en";
  thinking?: boolean;
  toolMode?: "tool_loop" | "finalize_without_tools";
  requiredActions?: ReadonlyArray<{
    toolName: ChatToolName;
    status: "pending" | "completed" | "failed" | "unfulfilled";
  }>;
  tools?: ChatToolManifestEntry[];
  toolChoice?: ChatToolName;
  /** Stable system text captured on the first LLM exchange of this turn. */
  frozenSystemPrompt?: string;
  traceContext?: TraceContext;
  /** Aggregate execution caveats; never learner memory and never a tool plan. */
  operationalNotes?: ReadonlyArray<{ toolName: "run_current_code" | "verify_proposed_repair"; text: string }>;
};

export type CoachChatTurnResult =
  | {
      type: "final";
      coachReply: string;
    }
  | {
      type: "tool_calls";
      toolCalls: CoachToolCall[];
      assistantContent?: string;
    }
  | {
      type: "protocol_violation";
      leak: SafeProtocolLeakSummary;
    };

export type CoachProvider = {
  /**
   * Providers that emit their own normalized LLM event declare ownership so
   * the orchestration seam does not add a duplicate call event.
   */
  runtimeTraceOwnership?: "provider";
  review(input: CoachReviewInput): Promise<CoachReviewResult>;
  chat(input: CoachChatInput): Promise<CoachChatTurnResult>;
};
