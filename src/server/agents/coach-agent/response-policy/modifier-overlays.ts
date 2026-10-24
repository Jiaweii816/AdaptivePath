import { INTENT_INSTRUCTIONS } from "../chat-policy-prompt";
import type { TurnModifiers } from "../turn-understanding/turn-understanding.types";

function requestsFullCode(modifiers: TurnModifiers): boolean {
  return (
    modifiers.codeDisclosure.level === "full_code" ||
    modifiers.requestedArtifact === "full_implementation"
  );
}

export function modifierOverlayInstructions(
  modifiers: TurnModifiers,
): string[] {
  const lines: string[] = [];
  if (requestsFullCode(modifiers)) {
    lines.push(...INTENT_INSTRUCTIONS.full_code_request);
  } else if (modifiers.deliveryMode === "hint") {
    lines.push(...INTENT_INSTRUCTIONS.hint_request);
  }
  if (modifiers.affect === "anxious_stuck") {
    lines.push(...INTENT_INSTRUCTIONS.anxiety_or_stuck);
  }
  return lines;
}
