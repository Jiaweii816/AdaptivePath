import { createHash } from "node:crypto";
import type { ChatToolName } from "./chat-tool-contracts";
import {
  ChatToolDispatchError,
  type PreparedChatToolCall,
} from "./chat-tool-dispatch";

export const DEFAULT_CHAT_TOOL_COST_BUDGET = 8;
export const HARD_MAX_CHAT_TOOL_COST_BUDGET = 12;
export const DEFAULT_CHAT_TOOL_REQUEST_LIMIT = 12;
export const HARD_MAX_CHAT_TOOL_REQUEST_LIMIT = 16;
export const DEFAULT_CHAT_TOOL_EXECUTION_LIMIT = 8;
export const HARD_MAX_CHAT_TOOL_EXECUTION_LIMIT = 10;
export const HARD_MAX_CHAT_TOOL_ROUNDS = 8;

export type ChatToolEffect = "read" | "write" | "execute";
export type ChatToolIdempotency = "turn_reusable" | "non_reusable";

export type ChatToolRuntimeMetadata = {
  effect: ChatToolEffect;
  costUnits: number;
  idempotency: ChatToolIdempotency;
  maxExecutionsPerTurn?: number;
};

const readTool = {
  effect: "read",
  costUnits: 1,
  idempotency: "turn_reusable",
} as const satisfies ChatToolRuntimeMetadata;

const singleHistoryReadTool = {
  ...readTool,
  maxExecutionsPerTurn: 1,
} as const satisfies ChatToolRuntimeMetadata;

// Unlike explicit history recall, the Pilot's model-written patterns are its
// actual semantic input. Do not collapse a later, different pattern into a
// cached user-message lookup; the per-turn execution cap denies it instead.
const singleLearningExperienceReadTool = {
  ...readTool,
  idempotency: "non_reusable",
  maxExecutionsPerTurn: 1,
} as const satisfies ChatToolRuntimeMetadata;

const durableWriteTool = {
  effect: "write",
  costUnits: 2,
  idempotency: "non_reusable",
  maxExecutionsPerTurn: 1,
} as const satisfies ChatToolRuntimeMetadata;

export const chatToolRuntimeMetadata: Record<
  ChatToolName,
  ChatToolRuntimeMetadata
> = {
  discover_capability: {
    effect: "read",
    costUnits: 1,
    idempotency: "non_reusable",
    maxExecutionsPerTurn: 2,
  },
  run_current_code: {
    effect: "execute",
    costUnits: 3,
    idempotency: "turn_reusable",
    maxExecutionsPerTurn: 1,
  },
  verify_proposed_repair: {
    effect: "execute",
    costUnits: 3,
    idempotency: "turn_reusable",
    maxExecutionsPerTurn: 1,
  },
  past_problem_recall: singleHistoryReadTool,
  past_mistake_recall: singleHistoryReadTool,
  recall_learning_experience: singleLearningExperienceReadTool,
  find_practice_problem: readTool,
  search_interview_variant_candidates: {
    effect: "read",
    costUnits: 2,
    idempotency: "non_reusable",
    maxExecutionsPerTurn: 1,
  },
  get_algorithm_hint: {
    effect: "write",
    costUnits: 2,
    idempotency: "non_reusable",
    maxExecutionsPerTurn: 1,
  },
  lookup_api_reference: readTool,
  note_memory: durableWriteTool,
  save_knowledge_note: durableWriteTool,
  save_mistake_book_entry: durableWriteTool,
} as const satisfies Record<ChatToolName, ChatToolRuntimeMetadata>;

export type ChatToolRuntimeConfig = {
  costBudget: number;
  requestLimit: number;
  executionLimit: number;
};

export function readChatToolRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChatToolRuntimeConfig {
  return {
    costBudget: readBoundedInteger(
      env.CHAT_TOOL_COST_BUDGET,
      DEFAULT_CHAT_TOOL_COST_BUDGET,
      HARD_MAX_CHAT_TOOL_COST_BUDGET,
    ),
    requestLimit: readBoundedInteger(
      env.CHAT_TOOL_REQUEST_LIMIT,
      DEFAULT_CHAT_TOOL_REQUEST_LIMIT,
      HARD_MAX_CHAT_TOOL_REQUEST_LIMIT,
    ),
    executionLimit: readBoundedInteger(
      env.CHAT_TOOL_EXECUTION_LIMIT,
      DEFAULT_CHAT_TOOL_EXECUTION_LIMIT,
      HARD_MAX_CHAT_TOOL_EXECUTION_LIMIT,
    ),
  };
}

export type ChatToolRuntimePolicy = {
  explicitExecutionRequested?: boolean;
  workspaceIdentity?: {
    problemId: string;
    language?: string;
    codeHash?: string;
    executionFingerprint?: string;
    selectedSuiteFingerprint?: string;
  };
  authoritativeSelectedSuite?: {
    codeHash?: string | null;
    executionFingerprint?: string | null;
    suiteFingerprint?: string | null;
    canVerdict: boolean;
  };
};

export type ChatToolRuntimeDenialReason =
  | "invalid_tool_call"
  | "request_limit_reached"
  | "execution_limit_reached"
  | "cost_budget_exhausted"
  | "per_tool_cap_reached"
  | "tool_not_available_this_turn"
  | "fresh_selected_suite_already_available";

export type ChatToolRuntimeObservation = {
  observationKind: "chat_tool_runtime_observation";
  disposition: "denied" | "error";
  toolName: string;
  reason: ChatToolRuntimeDenialReason | "tool_execution_error";
  message: string;
  retryable: boolean;
  budget: {
    costSpent: number;
    costBudget: number;
    remainingCost: number;
  };
  modelInstruction: string;
  errorKind?: string;
};

export type ChatToolRuntimeDecision =
  | {
      disposition: "executed";
      name: ChatToolName;
      result: unknown;
      costUnits: number;
    }
  | {
      disposition: "reused";
      name: ChatToolName;
      result: unknown;
      costUnits: 0;
      reusedFromToolCallId: string;
    }
  | {
      disposition: "denied";
      name: string;
      costUnits: 0;
      observation: ChatToolRuntimeObservation;
    }
  | {
      disposition: "error";
      name: ChatToolName;
      costUnits: number;
      observation: ChatToolRuntimeObservation;
      error: unknown;
    };

export type ChatToolRuntimeSnapshot = {
  requested: number;
  executed: number;
  reused: number;
  denied: number;
  errors: number;
  costSpent: number;
  costBudget: number;
  remainingCost: number;
  requestLimit: number;
  executionLimit: number;
  perToolRequests: Partial<Record<ChatToolName, number>>;
  perToolExecutions: Partial<Record<ChatToolName, number>>;
};

type CachedToolResult = {
  toolCallId: string;
  result: unknown;
};

export function createChatToolRuntime(args: {
  config?: ChatToolRuntimeConfig;
  policy?: ChatToolRuntimePolicy;
}) {
  const requestedConfig = args.config ?? readChatToolRuntimeConfig();
  const config: ChatToolRuntimeConfig = {
    costBudget: clampRuntimeLimit(
      requestedConfig.costBudget,
      DEFAULT_CHAT_TOOL_COST_BUDGET,
      HARD_MAX_CHAT_TOOL_COST_BUDGET,
    ),
    requestLimit: clampRuntimeLimit(
      requestedConfig.requestLimit,
      DEFAULT_CHAT_TOOL_REQUEST_LIMIT,
      HARD_MAX_CHAT_TOOL_REQUEST_LIMIT,
    ),
    executionLimit: clampRuntimeLimit(
      requestedConfig.executionLimit,
      DEFAULT_CHAT_TOOL_EXECUTION_LIMIT,
      HARD_MAX_CHAT_TOOL_EXECUTION_LIMIT,
    ),
  };
  const policy = args.policy ?? {};
  const perToolExecutions: Partial<Record<ChatToolName, number>> = {};
  const perToolRequests: Partial<Record<ChatToolName, number>> = {};
  const reusableResults = new Map<string, CachedToolResult>();
  let requested = 0;
  let executed = 0;
  let reused = 0;
  let denied = 0;
  let errors = 0;
  let costSpent = 0;
  let mutationEpoch = 0;

  function snapshot(): ChatToolRuntimeSnapshot {
    return {
      requested,
      executed,
      reused,
      denied,
      errors,
      costSpent,
      costBudget: config.costBudget,
      remainingCost: Math.max(0, config.costBudget - costSpent),
      requestLimit: config.requestLimit,
      executionLimit: config.executionLimit,
      perToolRequests: { ...perToolRequests },
      perToolExecutions: { ...perToolExecutions },
    };
  }

  function recordInvalidRequest(args: {
    toolName: string;
    error: unknown;
  }): Extract<ChatToolRuntimeDecision, { disposition: "denied" }> {
    requested += 1;
    denied += 1;
    if (args.toolName in chatToolRuntimeMetadata) {
      const name = args.toolName as ChatToolName;
      perToolRequests[name] = (perToolRequests[name] ?? 0) + 1;
    }
    return {
      disposition: "denied",
      name: args.toolName,
      costUnits: 0,
      observation: buildRuntimeObservation(
        "denied",
        args.toolName,
        requested > config.requestLimit
          ? "request_limit_reached"
          : "invalid_tool_call",
        snapshot(),
        args.error,
      ),
    };
  }

  function recordPreflightDenial(args: {
    toolName: string;
    reason: Extract<
      ChatToolRuntimeDenialReason,
      "tool_not_available_this_turn"
    >;
    error?: unknown;
  }): Extract<ChatToolRuntimeDecision, { disposition: "denied" }> {
    denied += 1;
    return {
      disposition: "denied",
      name: args.toolName,
      costUnits: 0,
      observation: buildRuntimeObservation(
        "denied",
        args.toolName,
        args.reason,
        snapshot(),
        args.error,
      ),
    };
  }

  async function invoke(
    toolCall: PreparedChatToolCall,
    execute: () => Promise<{ name: ChatToolName; result: unknown }>,
    admission?: {
      availableToolNames: ReadonlySet<ChatToolName>;
    },
  ): Promise<ChatToolRuntimeDecision> {
    const preflightReason = preflightDenialReason(toolCall, admission);
    if (preflightReason) {
      denied += 1;
      return {
        disposition: "denied",
        name: toolCall.name,
        costUnits: 0,
        observation: buildRuntimeObservation(
          "denied",
          toolCall.name,
          preflightReason,
          snapshot(),
        ),
      };
    }
    requested += 1;
    perToolRequests[toolCall.name] = (perToolRequests[toolCall.name] ?? 0) + 1;
    const metadata = chatToolRuntimeMetadata[toolCall.name];
    if (requested > config.requestLimit) {
      denied += 1;
      return {
        disposition: "denied",
        name: toolCall.name,
        costUnits: 0,
        observation: buildRuntimeObservation(
          "denied",
          toolCall.name,
          "request_limit_reached",
          snapshot(),
        ),
      };
    }
    const fingerprint = buildToolFingerprint({
      toolCall,
      policy,
      mutationEpoch: metadata.effect === "read" ? mutationEpoch : undefined,
    });

    if (metadata.idempotency === "turn_reusable") {
      const cached = reusableResults.get(fingerprint);
      if (cached) {
        reused += 1;
        return {
          disposition: "reused",
          name: toolCall.name,
          result: cached.result,
          costUnits: 0,
          reusedFromToolCallId: cached.toolCallId,
        };
      }
    }

    const denialReason = denialReasonFor(toolCall, metadata);
    if (denialReason) {
      denied += 1;
      return {
        disposition: "denied",
        name: toolCall.name,
        costUnits: 0,
        observation: buildRuntimeObservation(
          "denied",
          toolCall.name,
          denialReason,
          snapshot(),
        ),
      };
    }

    executed += 1;
    costSpent += metadata.costUnits;
    perToolExecutions[toolCall.name] =
      (perToolExecutions[toolCall.name] ?? 0) + 1;
    if (metadata.effect === "write") {
      mutationEpoch += 1;
    }

    try {
      const dispatched = await execute();
      if (metadata.idempotency === "turn_reusable") {
        reusableResults.set(fingerprint, {
          toolCallId: toolCall.id,
          result: dispatched.result,
        });
      }
      return {
        disposition: "executed",
        name: dispatched.name,
        result: dispatched.result,
        costUnits: metadata.costUnits,
      };
    } catch (error) {
      errors += 1;
      return {
        disposition: "error",
        name: toolCall.name,
        costUnits: metadata.costUnits,
        observation: buildRuntimeObservation(
          "error",
          toolCall.name,
          "tool_execution_error",
          snapshot(),
          error,
        ),
        error,
      };
    }
  }

  function hasReachedToolCap(
    name: ChatToolName,
    metadata: ChatToolRuntimeMetadata,
  ) {
    return (
      metadata.maxExecutionsPerTurn !== undefined &&
      (perToolExecutions[name] ?? 0) >= metadata.maxExecutionsPerTurn
    );
  }

  function denialReasonFor(
    toolCall: PreparedChatToolCall,
    metadata: ChatToolRuntimeMetadata,
  ): ChatToolRuntimeDenialReason | undefined {
    if (isRedundantSelectedSuiteRerun(toolCall, policy)) {
      return "fresh_selected_suite_already_available";
    }
    if (executed >= config.executionLimit) {
      return "execution_limit_reached";
    }
    if (hasReachedToolCap(toolCall.name, metadata)) {
      return "per_tool_cap_reached";
    }
    if (costSpent + metadata.costUnits > config.costBudget) {
      return "cost_budget_exhausted";
    }
    return undefined;
  }

  function preflightDenialReason(
    toolCall: PreparedChatToolCall,
    admission?: {
      availableToolNames: ReadonlySet<ChatToolName>;
    },
  ): ChatToolRuntimeDenialReason | undefined {
    if (admission && !admission.availableToolNames.has(toolCall.name)) {
      return "tool_not_available_this_turn";
    }
    return undefined;
  }

  return {
    invoke,
    recordInvalidRequest,
    recordPreflightDenial,
    snapshot,
  };
}

function isRedundantSelectedSuiteRerun(
  toolCall: PreparedChatToolCall,
  policy: ChatToolRuntimePolicy,
) {
  if (
    toolCall.name !== "run_current_code" ||
    policy.explicitExecutionRequested ||
    !isSelectedSuiteRun(toolCall.arguments)
  ) {
    return false;
  }
  const workspace = policy.workspaceIdentity;
  const authoritative = policy.authoritativeSelectedSuite;
  return Boolean(
    authoritative?.canVerdict &&
    executionIdentityMatches(workspace, authoritative) &&
    workspace?.selectedSuiteFingerprint &&
    authoritative.suiteFingerprint === workspace.selectedSuiteFingerprint,
  );
}

function executionIdentityMatches(
  workspace: ChatToolRuntimePolicy["workspaceIdentity"],
  authoritative: ChatToolRuntimePolicy["authoritativeSelectedSuite"],
) {
  if (workspace?.executionFingerprint && authoritative?.executionFingerprint) {
    return (
      workspace.executionFingerprint === authoritative.executionFingerprint
    );
  }

  return Boolean(
    workspace?.codeHash &&
    authoritative?.codeHash &&
    workspace.codeHash === authoritative.codeHash,
  );
}

function isSelectedSuiteRun(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const args = value as { tests?: unknown; dataInput?: unknown };
  return (
    !args.dataInput && (!Array.isArray(args.tests) || args.tests.length === 0)
  );
}

function buildToolFingerprint(args: {
  toolCall: PreparedChatToolCall;
  policy: ChatToolRuntimePolicy;
  mutationEpoch?: number;
}) {
  // History retrieval is scoped by the authoritative runtime user message.
  // The model-supplied query is only a soft hint, so two calls that merely
  // rewrite that hint must share one read result within the turn.
  const toolArguments = isHistoryRecallTool(args.toolCall.name)
    ? "runtime_user_message"
    : args.toolCall.arguments;
  return createHash("sha256")
    .update(
      canonicalJson({
        name: args.toolCall.name,
        arguments: toolArguments,
        workspace: args.policy.workspaceIdentity ?? null,
        mutationEpoch: args.mutationEpoch,
      }),
    )
    .digest("hex");
}

function isHistoryRecallTool(name: ChatToolName) {
  return name === "past_problem_recall" || name === "past_mistake_recall";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function buildRuntimeObservation(
  disposition: "denied" | "error",
  toolName: string,
  reason: ChatToolRuntimeObservation["reason"],
  state: ChatToolRuntimeSnapshot,
  error?: unknown,
): ChatToolRuntimeObservation {
  const errorKind =
    error instanceof ChatToolDispatchError ? error.errorKind : undefined;
  const message = runtimeMessage(reason);
  return {
    observationKind: "chat_tool_runtime_observation",
    disposition,
    toolName,
    reason,
    message,
    retryable:
      reason === "tool_execution_error" || reason === "invalid_tool_call",
    budget: {
      costSpent: state.costSpent,
      costBudget: state.costBudget,
      remainingCost: state.remainingCost,
    },
    modelInstruction:
      reason === "invalid_tool_call"
        ? "Correct the tool name or arguments using the available tool schema, then replan. Do not invent a tool result."
        : disposition === "error"
          ? "The tool failed. Do not invent a result. Use the available evidence, choose a different permitted tool if useful, or explain the limitation."
          : "Do not retry the same denied action. Use the supplied reason and remaining permitted tools to replan, then answer the learner.",
    errorKind,
  };
}

function runtimeMessage(reason: ChatToolRuntimeObservation["reason"]) {
  switch (reason) {
    case "invalid_tool_call":
      return "The model requested an unknown tool or supplied arguments that do not match the tool schema.";
    case "request_limit_reached":
      return "The per-turn tool request limit has been reached.";
    case "execution_limit_reached":
      return "The per-turn actual tool execution limit has been reached.";
    case "cost_budget_exhausted":
      return "The remaining weighted tool budget is insufficient for this call.";
    case "per_tool_cap_reached":
      return "This tool has already reached its per-turn execution cap.";
    case "tool_not_available_this_turn":
      return "This tool is not available in the current turn plan.";
    case "fresh_selected_suite_already_available":
      return "A verdict-bearing authoritative run already matches this exact code and selected test suite. Use that evidence; a custom scoped case may still be run if needed.";
    case "tool_execution_error":
      return "The tool handler failed before returning a valid result.";
  }
}

function readBoundedInteger(
  rawValue: string | undefined,
  fallback: number,
  hardMax: number,
) {
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, hardMax);
}

function clampRuntimeLimit(value: number, fallback: number, hardMax: number) {
  return Number.isInteger(value) && value >= 0
    ? Math.min(value, hardMax)
    : fallback;
}
