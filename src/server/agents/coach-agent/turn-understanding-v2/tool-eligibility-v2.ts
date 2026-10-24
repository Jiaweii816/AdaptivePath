import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { isLearningExperienceRecallPilotEnabled } from "@/server/memory/learning-experience-recall/pilot-mode";

import type {
  RespondTurnRequest,
  TurnUnderstandingV2,
} from "./turn-understanding-v2.types";

/** Tools whose handler can execute code. An execute denial closes all of them,
 *  regardless of which category projected the capability. */
const EXECUTION_CAPABLE_TOOLS = new Set<ChatToolName>([
  "run_current_code",
  "verify_proposed_repair",
]);

const HISTORY_BASIS = ["past_problems", "past_mistakes"] as const;
const HISTORY_RECALL_TOOLS = new Set<ChatToolName>([
  "past_problem_recall",
  "past_mistake_recall",
]);

function responseTools(request: RespondTurnRequest): ChatToolName[] {
  const tools: ChatToolName[] = [];
  const basis = new Set(request.basis);

  if (basis.has("past_problems")) tools.push("past_problem_recall");
  if (basis.has("past_mistakes")) tools.push("past_mistake_recall");
  if (request.deliverable === "recommend") {
    tools.push(
      "find_practice_problem",
      "search_interview_variant_candidates",
    );
  }
  if (request.target === "api" || basis.has("api_kb")) {
    tools.push("lookup_api_reference");
  }
  if (request.deliverable === "solve" && request.delivery.depth === "hint") {
    tools.push("get_algorithm_hint");
  }

  return tools;
}

const PERSIST_TOOL: Record<
  Extract<
    TurnUnderstandingV2["requests"][number],
    { kind: "persist" }
  >["collection"],
  ChatToolName
> = {
  preference: "note_memory",
  knowledge_handbook: "save_knowledge_note",
  mistake_book: "save_mistake_book_entry",
};

/** Pure capability projection from canonical V2 categories (§5.2). */
export function deriveToolEligibilityV2(
  understanding: Pick<
    TurnUnderstandingV2,
    "requests" | "effectDenials" | "categoryDenials"
  >,
): ChatToolName[] {
  const capabilities: ChatToolName[] = [];
  const add = (tool: ChatToolName) => {
    if (!capabilities.includes(tool)) capabilities.push(tool);
  };
  const runDenied = understanding.effectDenials.some(
    (denial) => denial.effect === "execute",
  );
  const historyDenied = understanding.categoryDenials.some(
    (denial) =>
      denial.category === "basis" &&
      HISTORY_BASIS.some((basis) => basis === denial.value),
  );
  const historyRequested = understanding.requests.some(
    (request) =>
      request.kind === "respond" &&
      HISTORY_BASIS.some((basis) => request.basis.includes(basis)),
  );

  for (const request of understanding.requests) {
    if (request.kind === "respond") {
      responseTools(request)
        .filter(
          (tool) =>
            !(runDenied && EXECUTION_CAPABLE_TOOLS.has(tool)) &&
            !(historyDenied && HISTORY_RECALL_TOOLS.has(tool)),
        )
        .forEach(add);
      continue;
    }
    if (request.kind === "execute") {
      if (!runDenied) {
        add(
          request.target === "candidate"
            ? "verify_proposed_repair"
            : "run_current_code",
        );
      }
      continue;
    }
    if (request.authorization === "ledger_granted") {
      add(PERSIST_TOOL[request.collection]);
    }
  }

  // The pilot remains a rollback switch, but history retrieval has one owner:
  // explicit Basis. Coverage/model assembly handle missed history language;
  // category denials veto both the specific and aggregate recall tools.
  if (
    isLearningExperienceRecallPilotEnabled() &&
    historyRequested &&
    !historyDenied
  ) {
    add("recall_learning_experience");
  }

  return capabilities;
}
