import type { TurnRequest } from "../turn-understanding-v2/turn-understanding-v2.types";
import type { ReplyDirective } from "./response-plan-v2.types";

export function responseTaskBackboneInstructions(
  directive: ReplyDirective,
): string[] {
  switch (directive.coreTask) {
    case "fix":
      return [
        "[FIX] Use a soft diagnostic rhythm: state one falsifiable root cause, walk one minimal case, give the smallest repair that preserves the learner's approach, then end with one next step. Diagnose only from the current truth anchors and aligned evidence.",
        "The editor has no save step. Never tell the learner to save or claim the editor contains an older revision; request fresh execution when new evidence is needed.",
      ];
    case "understand":
      return [
        "[UNDERSTAND] Answer the requested why/how directly, demonstrate it with one concrete example, and finish with one reusable takeaway. Do not expand into an unsolicited full solution.",
      ];
    case "improve":
      return [
        "[IMPROVE] Treat optimization as opt-in. If a current blocker exists, say the improvement applies after that blocker is repaired; then give the better invariant or structure, its complexity effect, and the first transition step.",
      ];
    case "solve":
      return [
        "[SOLVE] Move the learner toward a working solution. Let this objective's delivery depth decide whether to give one hint, the approach with key steps, or a complete solution; keep one coherent approach.",
      ];
    case "recommend":
      return [
        "[RECOMMEND] Focus on practice recommendations grounded in the request and available catalog results. Keep them metadata-only, respect the requested count, and do not include solutions.",
      ];
    case "recall":
      return [
        "[RECALL] Report compact evidence from the requested Basis and add one prevention or reuse rule. Never invent learner history. For learner_profile, separate self-reported cues, earned evidence, and what the supplied brief does not establish.",
      ];
    case "chat":
      return [
        "[CHAT] Give the shortest useful response to the current message.",
      ];
  }
}

export function effectBackboneInstructions(request: TurnRequest): string[] {
  if (request.kind === "execute") {
    return [
      `[EXECUTE] Run the ${request.target} code through the available capability before making execution claims. Keep every claim within the returned case or suite scope.`,
    ];
  }
  if (request.kind === "persist") {
    return [
      `[PERSIST] Persist only the learner-authored content for ${request.collection} through the authorized backend action. Never claim success without its result.`,
    ];
  }
  return [];
}
