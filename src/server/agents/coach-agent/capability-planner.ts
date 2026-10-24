import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { getChatToolSpec, optionalToolOrder } from "@/server/tools/chat-tools/chat-tool-registry";
import type { TurnCapabilityPolicy } from "./turn-capability-policy";
import { policyAllowsTool } from "./turn-capability-policy";
import type { TurnUnderstandingV2 } from "./turn-understanding-v2/turn-understanding-v2.types";

export type OptionalToolScore = {
  toolName: (typeof optionalToolOrder)[number];
  directMatch: 0 | 1;
  supportMatch: 0 | 1;
  stateFit: 0 | 1;
  largeSchema: 0 | 1;
  openWorld: 0 | 1;
  score: number;
};

export type CapabilityPlan = {
  pinnedTools: ChatToolName[];
  requiredTools: ChatToolName[];
  optionalScores: OptionalToolScore[];
  initialLoadedTools: ChatToolName[];
};

const cue = (text: string, pattern: RegExp) => pattern.test(text);

/**
 * Public interview variants are a different source from controlled-catalog
 * drills. Keep this vocabulary aligned with the tool contract so a learner's
 * ordinary Chinese wording does not silently downgrade to local practice.
 */
const INTERVIEW_VARIANT_CUE = /(?:\b(?:interview|company|follow[- ]?ups?|variants?|variations?|twists?)\b|面试(?:变体|变题|变式)?|公司(?:题|怎么考)?|面经|变体|变题|变式|变形题|追问|后续题)/iu;

export function planChatCapabilities(args: {
  understanding: Pick<TurnUnderstandingV2, "requests">;
  policy: TurnCapabilityPolicy;
  message: string;
  hasCurrentProblem: boolean;
  hasProblemTags: boolean;
  hasApiTopic?: boolean;
}): CapabilityPlan {
  const message = args.message.toLowerCase();
  const pinnedTools: ChatToolName[] = ["discover_capability"];
  if (!args.policy.hardDenies.history && !args.policy.hardDenies.learnerData) pinnedTools.push("recall_learning_experience");
  const requiredTools: ChatToolName[] = [];
  if (args.policy.explicitGrants.executeCurrent) requiredTools.push("run_current_code");
  if (args.policy.explicitGrants.executeCandidate) requiredTools.push("verify_proposed_repair");
  if (args.policy.explicitGrants.persistPreference) requiredTools.push("note_memory");
  if (args.policy.explicitGrants.persistKnowledge) requiredTools.push("save_knowledge_note");
  if (args.policy.explicitGrants.persistMistake) requiredTools.push("save_mistake_book_entry");
  const responses = args.understanding.requests.filter((request) => request.kind === "respond");
  const basis = new Set(responses.flatMap((request) => request.basis));
  const deliverables = new Set(responses.map((request) => request.deliverable));
  const targetApi = responses.some((request) => request.target === "api");
  const hint = responses.some((request) => request.deliverable === "solve" && request.delivery.depth === "hint");
  const optionalScores = optionalToolOrder.map((toolName) => {
    const spec = getChatToolSpec(toolName);
    const directMatch = (
      (toolName === "past_problem_recall" && basis.has("past_problems")) ||
      (toolName === "past_mistake_recall" && basis.has("past_mistakes")) ||
      (toolName === "find_practice_problem" && (deliverables.has("recommend") || basis.has("practice_catalog"))) ||
      (toolName === "search_interview_variant_candidates" && cue(message, INTERVIEW_VARIANT_CUE)) ||
      (toolName === "get_algorithm_hint" && hint) ||
      (toolName === "lookup_api_reference" && (targetApi || basis.has("api_kb")))
    ) ? 1 : 0;
    const supportMatch = (!directMatch && (
      (toolName === "past_problem_recall" && (deliverables.has("solve") || deliverables.has("understand")) && cue(message, /类似|之前|共同内核|迁移|similar|previous/iu)) ||
      (toolName === "past_mistake_recall" && deliverables.has("fix") && cue(message, /又|老是|常犯|类似错误|recurring|again/iu)) ||
      (toolName === "find_practice_problem" && cue(message, /reinforce|advance|巩固|进阶/iu)) ||
      (toolName === "get_algorithm_hint" && (deliverables.has("solve") || deliverables.has("understand"))) ||
      (toolName === "lookup_api_reference" && (deliverables.has("fix") || deliverables.has("understand")) && cue(message, /api|syntax|语法|deque|library/iu))
    )) ? 1 : 0;
    const stateFit = (toolName === "lookup_api_reference" ? Boolean(args.hasApiTopic) : toolName === "find_practice_problem" ? args.hasCurrentProblem || args.hasProblemTags : args.hasCurrentProblem) ? 1 : 0;
    const largeSchema = toolName === "get_algorithm_hint" ? 1 : 0;
    const openWorld = spec.openWorld ? 1 : 0;
    return { toolName, directMatch, supportMatch, stateFit, largeSchema, openWorld, score: directMatch * 60 + supportMatch * 25 + stateFit * 10 - largeSchema * 5 - openWorld * 10 } as OptionalToolScore;
  });
  const optional = optionalScores
    .filter((item) => item.score >= 30 && policyAllowsTool(args.policy, item.toolName))
    .sort((left, right) => right.score - left.score || Number(left.openWorld) - Number(right.openWorld) || getChatToolSpec(left.toolName).schemaChars - getChatToolSpec(right.toolName).schemaChars || optionalToolOrder.indexOf(left.toolName) - optionalToolOrder.indexOf(right.toolName))
    .slice(0, 3)
    .map((item) => item.toolName);
  return { pinnedTools, requiredTools, optionalScores, initialLoadedTools: [...new Set([...pinnedTools, ...requiredTools, ...optional])].filter((name) => policyAllowsTool(args.policy, name)) };
}
