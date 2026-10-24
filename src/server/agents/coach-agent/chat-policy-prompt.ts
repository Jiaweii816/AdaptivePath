import { buildChatTurnPlan } from "./chat-intent-policy";
import type {
  ChatTurnContextNeeds,
  ChatTurnPlan,
  CoachChatInput,
  CoachChatIntent,
} from "./coach-agent.types";

export const EMPTY_CHAT_CONTEXT_NEEDS: ChatTurnContextNeeds = {
  workspace: false,
  currentCode: false,
  selectedTests: false,
  runEvidence: false,
  reviewContext: false,
  learnerSignals: false,
  handbook: false,
  episodes: false,
};

export const INTENT_INSTRUCTIONS: Record<CoachChatIntent, string[]> = {
  execute_failed_ask: [
    "[DEBUG] Diagnose from current code plus aligned evidence. Preserve a repairable approach, identify one concrete mechanism, and give the smallest complete edit set that survives all known selected cases. Keep interval conventions consistent.",
    "The editor has no save step. Never tell the learner to save, press Ctrl/Cmd+S, or claim the editor still contains an older revision; request a rerun when fresh evidence is needed.",
  ],
  debug_followup: [
    "[DEBUG] Diagnose from current code plus aligned evidence. Preserve a repairable approach, identify one concrete mechanism, and give the smallest complete edit set that survives all known selected cases. Keep interval conventions consistent.",
    "The editor has no save step. Never tell the learner to save, press Ctrl/Cmd+S, or claim the editor still contains an older revision; request a rerun when fresh evidence is needed.",
  ],
  run_case_request: [
    "[RUN] Use the available execution capability for the requested subject. Do not state a pass/fail result until a matching tool result or aligned execution record exists, and keep every claim within the observed case/suite scope.",
  ],
  optimization_request: [
    "[OPTIMIZATION] Evaluate the learner's stated idea, name its time/space complexity, then give only the core optimization idea: the better invariant/data-structure, why it improves complexity, and the first transition step. For the default explanation artifact, you may include at most one or two language-neutral core pseudocode lines if they clarify the idea, but never provide complete pseudocode, helper signatures, code blocks, or a line-by-line algorithm plan. Complete pseudocode is allowed only when the current turn explicitly asks for pseudocode, a patch, or full implementation.",
  ],
  hint_request: [
    "[HINT] Give only the next useful hint level and one guiding question. Missing/starter code is not a reason to run code; run only when the learner explicitly asks to execute or verify.",
  ],
  api_reference_question: [
    "[API] Answer only the requested language/API usage with a compact syntax example. Do not continue the active algorithm solution or import current code/tests/run evidence. Use at most the one exact Handbook note included below.",
  ],
  past_problem_recall_request: [
    "[HISTORY] Call past_problem_recall before answering. Use only its result for claims about past problems or successful transfer. An empty result means only that this query returned no matching trusted evidence; never call this the first session or claim that cross-session memory is unavailable. Do not expose tool names. Do not import current code, tests, run evidence, or a complete solution.",
  ],
  past_mistake_recall_request: [
    "[HISTORY] Call past_mistake_recall before answering. Use only its structured result for claims about past mistakes; choose 2–3 items, state the mechanism and transfer to the current problem. A learner_confirmed_artifact is a saved mistake-book guide, not verified weakness. Local, mixed, or unknown authority is never an official verdict. An empty result means only that this query returned no matching trusted evidence; never call this the first session or claim that cross-session memory is unavailable. Do not expose tool names. Do not import current code, tests, run evidence, or a complete solution.",
  ],
  profile_meta_question: [
    "[LEARNER PROFILE] Answer only from the Coach Memory Brief. Account for every selected strength/growth cue and every listed output preference; present preferences separately from ability claims. The brief is a deliberately compressed view, not an exhaustive profile: never claim that an unlisted topic or preference is absent or unknown. Separate self-reported cues from earned evidence; when no earned cue is shown, say only that no earned evidence is shown in this brief. Never call a listed preference unknown. Do not discuss the active problem, editor code, or a machine tag unless the learner explicitly asks. If any profile cue or preference exists, do not invite the learner to rebuild, repeat, or add background; simply explain that future earned evidence can refine the current profile.",
  ],
  practice_request: [
    "[PRACTICE] Base recommendations on the request and practice-tool results. Keep them metadata-only and do not include current code, tests, run evidence, or solutions.",
  ],
  mistake_book_save_request: [
    "[DURABLE ACTION] Save only the requested problem-specific guide through the required backend action. Never claim it was saved without a successful result.",
  ],
  concept_question: [
    "[CONCEPT] Explain the named line, condition, or invariant directly with one small example; do not expand into an unsolicited full solution.",
  ],
  anxiety_or_stuck: [
    "[STUCK] Reduce cognitive load: acknowledge briefly, narrow the task to one decision, and give one doable next step.",
  ],
  full_code_request: [
    "[FULL CODE] Provide one implementation for the requested approach, with a short complexity note and no competing solutions.",
  ],
  general_followup: [
    "[FOLLOW-UP] Answer the narrow question directly; do not turn it into a full review or multi-solution article.",
  ],
};

export const PURE_DURABLE_INSTRUCTION =
  "[DURABLE ACTION] The backend owns completion state. Emit pending required tool calls when available; never announce a save or memory write without a successful result.";

export const REQUIRED_ACTION_INSTRUCTION =
  "[DURABLE ACTION] Required writes are backend-owned. Call every pending required action in user order when available, and never claim completion without a successful result.";

export function resolveChatTurnPlan(input: CoachChatInput) {
  return (
    input.interactionState?.turnPlan ??
    buildChatTurnPlan(latestChatUserMessage(input))
  );
}

export function latestChatUserMessage(input: CoachChatInput) {
  return (
    [...input.messages].reverse().find((message) => message.role === "user")
      ?.content ?? ""
  );
}

export function isPureDurableTurn(
  input: CoachChatInput,
  turnPlan: ChatTurnPlan,
) {
  return Boolean(
    input.requiredActions?.some((action) => action.status === "pending") &&
      turnPlan.primaryIntent === "general_followup" &&
      Object.values(turnPlan.signals).every((signal) => !signal),
  );
}

export function buildCodeDisclosureContract(turnPlan: ChatTurnPlan) {
  if (turnPlan.codeDisclosure === "full_code") {
    return "[CODE DISCLOSURE — full_code] The learner explicitly requested complete code in this turn. A complete implementation is allowed, but keep it scoped to the requested approach and do not claim unverified correctness.";
  }

  return "[CODE DISCLOSURE — guided] You may use prose, examples, pseudocode, local edits, one condition or loop fragment, and small API syntax snippets. You MUST NOT provide a complete target function/method, a complete class Solution, or reconstruct the full solution across several snippets. This boundary remains guided even if the user asks for a complete idea, solution explanation, or optimization plan.";
}

export function buildWalkthroughThinkingInstructions(
  input: CoachChatInput,
  turnPlan: ChatTurnPlan,
) {
  if (!(input.thinking === true || turnPlan.signals.walkthrough)) {
    return [];
  }

  const concreteCase = looksLikeConcreteWalkthroughCase(
    latestChatUserMessage(input),
  );
  return [
    "[WALKTHROUGH] Keep trial, backtracking, and self-correction out of the visible answer; present only the clean final walkthrough.",
    "[WALKTHROUGH TABLE FORMAT] Use plain Markdown only. Do not use HTML tags such as <br>, <div>, or &nbsp;. Keep table cells short; if a cell needs several facts, separate them with semicolons or move the detail to one short bullet after the table.",
    concreteCase
      ? "You MUST use a compact Markdown table with columns for step, current item/index, key variables, branch or condition, and state after the step; add at most two takeaway bullets."
      : "You MUST use a compact Markdown state-transition table when variables change; if no variable state changes, use a tiny two-column table for concept and meaning. Group repetitive iterations.",
  ];
}

function looksLikeConcreteWalkthroughCase(message: string) {
  const normalized = message.trim().toLowerCase();
  return [
    /\bcase\b/,
    /\bexamples?\s*\d+\b/,
    /\bexamples?\d+\b/,
    /用例/,
    /例子\s*\d+/,
    /\b(?:nums|target|s|input|arr|array|grid|head|root)\s*=/,
    /\[[^\]]+\]/,
    /"[^"]+"/,
    /“[^”]+”/,
    /'[^']+'/,
  ].some((pattern) => pattern.test(normalized));
}

export function buildAvailableChatToolInstructions(
  input: CoachChatInput,
): string[] {
  const availableToolNames = input.tools?.map((tool) => tool.function.name) ?? [];
  if (availableToolNames.length === 0) {
    return [
      "[TOOLS] No tool is callable in this request. Do not emit tool-call syntax or claim that anything was run, verified, recalled, looked up, remembered, or saved.",
    ];
  }

  const lines = [
    `[TOOLS] Callable schemas are supplied separately for exactly: ${availableToolNames.join(", ")}. Their schema descriptions are the sole per-tool instructions.`,
    "Use only the capabilities needed by the request; compound requests may require multiple calls in the user's stated order. Treat successful results as scoped evidence and do not claim an action succeeded without its result.",
  ];
  const pending = input.requiredActions?.filter(
    (action) => action.status === "pending",
  );
  if (pending?.length) {
    lines.push(
      `Pending backend-required actions, in user order: ${pending.map((action) => action.toolName).join(", ")}. Return independent pending calls together when possible; backend wording owns final status.`,
    );
  }
  return lines;
}
