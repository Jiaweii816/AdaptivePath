import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import type { TurnUnderstandingV2 } from "./turn-understanding-v2/turn-understanding-v2.types";

export type TurnCapabilityPolicy = {
  hardDenies: { history: boolean; learnerData: boolean; execute: boolean; persist: boolean; openWorld: boolean };
  explicitGrants: { executeCurrent: boolean; executeCandidate: boolean; persistPreference: boolean; persistKnowledge: boolean; persistMistake: boolean };
  resources: { userId: string; problemId: string; chatSessionId: string; memoryOrigin: string; currentCodeHash?: string };
};

export function buildTurnCapabilityPolicy(args: {
  understanding: Pick<TurnUnderstandingV2, "categoryDenials" | "effectDenials" | "requests">;
  requestedActions: readonly RequestedAction[];
  message: string;
  resources: TurnCapabilityPolicy["resources"];
}): TurnCapabilityPolicy {
  const deniedBasis = new Set(args.understanding.categoryDenials
    .filter((item) => item.category === "basis")
    .map((item) => item.value));
  const execute = args.understanding.effectDenials.some((item) => item.effect === "execute");
  // A collection-specific refusal ("don't save this to the mistake book")
  // must not erase a separate explicit grant for the Handbook in the same
  // turn. The existing requested-action ledger retains that fine-grained
  // denial; this global policy bit is only for an unqualified persist deny.
  const persist =
    args.understanding.effectDenials.some((item) => item.effect === "persist") &&
    !args.requestedActions.some((action) => action.decision === "granted");
  const message = args.message.toLowerCase();
  const hardDenies = {
    history: deniedBasis.has("past_problems") || deniedBasis.has("past_mistakes") ||
      /(?:不要|别|无需).{0,16}(?:查历史|看以前|参考以前|历史)/u.test(args.message) ||
      /(?:do\s+not|don't|never|without).{0,24}(?:look\s+(?:at|up)|use|check|search|reference)?\s*(?:my\s+)?(?:history|past\s+(?:problems?|mistakes?|work))/iu.test(message),
    learnerData: deniedBasis.has("learner_profile") ||
      /(?:不要|别|无需).{0,20}(?:根据我的学习|个性化|学习经历|学习情况)/u.test(args.message) ||
      /(?:do\s+not|don't|never|without).{0,24}(?:my\s+)?(?:learning\s+(?:history|experience|profile)|personal(?:ized|ization)?|learner\s+(?:data|profile))/iu.test(message),
    execute,
    persist,
    openWorld:
      /(?:不要|别|无需).{0,20}(?:联网|搜索网络|web\s*search|网络)/iu.test(message) ||
      /(?:do\s+not|don't|never|without).{0,24}(?:search(?:ing)?\s+the\s+web|web\s*search|use\s+the\s+web|go\s+online)/iu.test(message),
  };
  const hasExecute = (target: "current" | "candidate") => args.understanding.requests.some(
    (request) => request.kind === "execute" && request.target === target && request.authorization === "explicit_grant",
  );
  const granted = new Set(args.requestedActions.filter((action) => action.decision === "granted").map((action) => action.toolName));
  return {
    hardDenies,
    explicitGrants: {
      executeCurrent: !hardDenies.execute && hasExecute("current"),
      executeCandidate: !hardDenies.execute && hasExecute("candidate"),
      persistPreference: !hardDenies.persist && granted.has("note_memory"),
      persistKnowledge: !hardDenies.persist && granted.has("save_knowledge_note"),
      persistMistake: !hardDenies.persist && granted.has("save_mistake_book_entry"),
    },
    resources: args.resources,
  };
}

export function policyAllowsTool(policy: TurnCapabilityPolicy, name: ChatToolName): boolean {
  if (policy.hardDenies.execute && (name === "run_current_code" || name === "verify_proposed_repair")) return false;
  if (policy.hardDenies.persist && ["note_memory", "save_knowledge_note", "save_mistake_book_entry"].includes(name)) return false;
  if (policy.hardDenies.history && ["past_problem_recall", "past_mistake_recall", "recall_learning_experience"].includes(name)) return false;
  if (policy.hardDenies.learnerData && name === "recall_learning_experience") return false;
  return !(policy.hardDenies.openWorld && name === "search_interview_variant_candidates");
}
