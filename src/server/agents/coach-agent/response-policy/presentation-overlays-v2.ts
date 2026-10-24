import type { ReplyDirective } from "./response-plan-v2.types";

export function presentationOverlayInstructions(
  directive: ReplyDirective,
): string[] {
  const { depth, form, count } = directive.deliveryMode;
  const lines: string[] = [];

  if (depth === "hint") {
    lines.push(
      "[DELIVERY: HINT] Give only the next useful hint and one guiding question. Preserve room for the learner to finish the solution.",
    );
  } else if (depth === "normal") {
    lines.push(
      "[DELIVERY: NORMAL] Give the core idea and the key steps needed for this objective, without turning it into an exhaustive solution article.",
    );
  } else {
    lines.push(
      "[DELIVERY: FULL] Give the complete requested treatment for this objective. For solve, provide one complete implementation unless the requested form is pseudocode, patch, or trace; still explain the key invariant and complexity.",
    );
  }

  if (form === "pseudocode") {
    lines.push(
      "[FORM: PSEUDOCODE] Use language-neutral pseudocode and stop before a complete implementation.",
    );
  } else if (form === "patch") {
    lines.push(
      "[FORM: PATCH] Show the smallest complete patch against the current approach, not a replacement solution.",
    );
  } else if (form === "trace") {
    lines.push(
      "[FORM: TRACE] Use a compact Markdown variable/state trace table. Anchor each row to the concrete example and finish with one takeaway; do not substitute prose for the requested trace.",
    );
  } else {
    lines.push("[FORM: PROSE] Use concise explanatory prose.");
  }

  if (count !== undefined) {
    lines.push(`[COUNT] Provide exactly ${count} requested item(s).`);
  }
  return lines;
}
