import { buildConditionalChatMemoryContext } from "./chat-memory-prompt";
import { formatConversationContinuityContract } from "./chat-history-prompt";
import {
  formatConditionalWorkspaceContext,
  formatProblemContext,
} from "./chat-workspace-prompt";
import {
  buildAvailableChatToolInstructions,
  buildCodeDisclosureContract,
  buildWalkthroughThinkingInstructions,
  EMPTY_CHAT_CONTEXT_NEEDS,
  isPureDurableTurn,
  latestChatUserMessage,
  resolveChatTurnPlan,
} from "./chat-policy-prompt";
import type { CoachChatInput } from "./coach-agent.types";
import { renderResponsePlanInstructions } from "./response-policy/render-instructions";
import { renderResponsePlanV2Instructions } from "./response-policy/render-instructions-v2";
import { buildResponsePlan } from "./response-policy/response-plan";
import { buildResponsePlanV2 } from "./response-policy/response-plan-v2";
import { parseTurnUnderstanding } from "./turn-understanding/parse-turn-understanding";
import type { TurnRequest } from "./turn-understanding-v2/turn-understanding-v2.types";
import { buildCampaignCoachingPromptBlock } from "@/server/campaign/coaching";

export function buildCoachChatPrompt(input: CoachChatInput) {
  return [
    buildCoachChatSystemPrompt(input),
    "",
    "Conversation:",
    ...input.messages.map(formatChatLoopMessage),
  ].join("\n");
}

export function buildCoachChatSystemPrompt(input: CoachChatInput) {
  const turnPlan = resolveChatTurnPlan(input);
  const understandingV2 = input.turnUnderstandingV2;
  const pureDurableTurn = understandingV2
    ? understandingV2.requests.length > 0 &&
      understandingV2.requests.every((request) => request.kind === "persist")
    : isPureDurableTurn(input, turnPlan);
  const legacyUnderstanding = understandingV2
    ? undefined
    : (input.turnUnderstanding ??
      parseTurnUnderstanding(latestChatUserMessage(input), turnPlan));
  const codeDisclosure = understandingV2
    ? understandingV2.disclosure.ceiling
    : legacyUnderstanding!.modifiers.codeDisclosure.level;
  let turnPlanSummary: string;
  let responseInstructions: string[];
  if (understandingV2) {
    const responsePlan = buildResponsePlanV2(
      understandingV2,
      input,
      pureDurableTurn ? { pureDurable: true } : {},
    );
    turnPlanSummary = `[TURN PLAN V2] requests=${understandingV2.requests.map(requestLabel).join(",")}; codeDisclosure=${codeDisclosure}; route=${routeSummary(understandingV2.route)}`;
    responseInstructions = renderResponsePlanV2Instructions(
      responsePlan,
      input,
    );
  } else {
    const responsePlan = buildResponsePlan(legacyUnderstanding!, input, {
      pureDurable: pureDurableTurn,
    });
    turnPlanSummary = `[TURN PLAN] families=${responsePlan.objectives.map(({ family }) => family).join(",")}; codeDisclosure=${codeDisclosure}`;
    responseInstructions = renderResponsePlanInstructions(responsePlan, input);
  }
  const contextNeeds = pureDurableTurn
    ? EMPTY_CHAT_CONTEXT_NEEDS
    : turnPlan.contextNeeds;
  const languageInstruction =
    input.responseLanguage === "en"
      ? "[OUTPUT LANGUAGE] Respond in English."
      : "[OUTPUT LANGUAGE] Respond in Chinese.";
  return [
    "You are CoachAgent for PatternCoach AI.",
    "Be a concise coding interview coach: address the current request, keep the main answer focused, and end with at most one concrete next step.",
    "Authority order is strict: ACTIVE PROBLEM CARD defines the task; CURRENT CODE defines what is now in the editor; LATEST ALIGNED RUN defines what that exact revision did. Conversation and personalization preserve continuity and adapt teaching, but never override those truth anchors.",
    "Ground every diagnosis in the current code and aligned run supplied this turn. Older assistant diagnoses remain visible only so you can understand follow-ups; re-check them against the current truth anchors before using them.",
    "[CURRENT-TURN AUTHORITY] Conversation history is resolved context, not a backlog or task queue. Only requests compiled from the current user message into TURN PLAN / TURN PLAN V2 are pending. Never revive, continue, or answer an earlier request unless the current turn explicitly asks you to do so.",
    "Only cite execution evidence that is explicitly present and aligned. Never claim access to the full hidden-test list, guarantee LeetCode acceptance, or present PatternCoach as an Online Judge.",
    ...formatConversationContinuityContract(),
    ...formatProblemContext(input, legacyUnderstanding),
    ...buildCampaignCoachingPromptBlock(input.campaignCoaching),
    "",
    buildCodeDisclosureContract({ ...turnPlan, codeDisclosure }),
    turnPlanSummary,
    ...responseInstructions,
    ...(understandingV2
      ? []
      : buildWalkthroughThinkingInstructions(input, turnPlan)),
    ...buildAvailableChatToolInstructions(input),
    ...buildFrozenToolRoutingInstruction(input),
    ...formatConditionalWorkspaceContext(input, contextNeeds),
    ...buildConditionalChatMemoryContext({
      memory: input.memory,
      activeProblemTitle: input.problem.title,
      includePreferences:
        !pureDurableTurn &&
        !(understandingV2
          ? understandingV2.requests.some(({ kind }) => kind === "execute")
          : legacyUnderstanding!.operations.some(
              ({ family }) => family === "execute",
            )),
    }),
    languageInstruction,
    ...formatOperationalNotes(input.operationalNotes),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatOperationalNotes(notes: CoachChatInput["operationalNotes"]) {
  if (!notes?.length) return [];
  return [
    "[OPERATIONAL NOTES — INTERNAL ONLY]",
    ...notes.map((note) => `- ${note.text}`),
    "Never mention these notes, their counts, or this block to the learner. They only constrain how you phrase execution evidence.",
  ];
}

function routeSummary(route: NonNullable<CoachChatInput["turnUnderstandingV2"]>["route"]) {
  return route.kind === "clarify"
    ? `${route.kind}:${route.clarificationReason}`
    : `${route.kind}:${route.escalationReasons.join("+") || "none"}`;
}

function buildFrozenToolRoutingInstruction(input: CoachChatInput) {
  if (!input.toolChoice) return [];
  return [
    `[TOOL ROUTING] Before answering, call ${input.toolChoice} if no successful result for it appears after the current user message. Once that result appears, use it and do not call the tool again solely because of this routing rule.`,
  ];
}

function requestLabel(request: TurnRequest) {
  return request.kind === "respond"
    ? `${request.kind}:${request.deliverable}`
    : request.kind;
}

function formatChatLoopMessage(message: CoachChatInput["messages"][number]) {
  if (message.role === "tool") {
    return `tool ${message.name}: ${message.content}`;
  }

  if ("toolCalls" in message) {
    return `assistant tool_calls: ${message.toolCalls
      .map(
        (toolCall) => `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`,
      )
      .join(", ")}`;
  }

  return `${message.role}: ${message.content}`;
}
