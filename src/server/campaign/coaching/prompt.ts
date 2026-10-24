import type { CampaignCoachingContext } from "./contracts";

export function buildCampaignCoachingPromptBlock(
  context: CampaignCoachingContext | undefined,
): string[] {
  if (!context) return [];
  const policy = context.policy;
  const lines = [
    "[CAMPAIGN TASK POLICY — trusted server context]",
    `- role: ${context.slotRole}; settled: ${context.settled}; mode: ${policy.coachingMode}`,
    `- default disclosure depth: ${policy.defaultDisclosureDepth}; effective code ceiling: ${policy.effectiveDisclosureCeiling}`,
    `- automatic technical memory cues: ${policy.automaticTechnicalMemoryCueBudget}; proactive node naming: ${policy.mayProactivelyNameNode ? "allowed" : "withheld"}`,
    "- Explicit user requests still take precedence within product safety and evidence boundaries.",
  ];

  if (context.settled) {
    lines.push(
      `- The task is settled. Normal review is allowed; the revealed node is ${context.nodeNameInternal}.`,
    );
    return lines;
  }
  switch (context.slotRole) {
    case "advance":
      lines.push(
        `- Visible learning node: ${context.nodeNameInternal}. Use at most this one core invariant: ${context.coreInvariantInternal}`,
        "- Build the learner's state or pointer meaning before escalating; do not turn the node label into a long tutorial.",
      );
      break;
    case "target":
      lines.push(
        `- Visible learning node: ${context.nodeNameInternal}. Ask what state is shared, what condition changed, and how the prior invariant must adapt.`,
        "- Do not reteach the whole node or copy a prior solution.",
      );
      break;
    case "remedial":
      lines.push(
        context.repairReason
          ? `- Trusted repair focus: ${context.repairReason}`
          : "- Start with one concrete condition, update-order, boundary, or state-definition check.",
        "- Do not expose repair codes or expand into the learner's complete history unless explicitly requested.",
      );
      break;
    case "probe":
      lines.push(
        "- Preserve assessment validity by default: give one narrow local hint or one checking question; do not proactively reveal the pattern, full steps, pseudocode, patch, or code.",
        ...(policy.shouldWarnAssessmentContamination
          ? [
              "- Open with a brief assessment-contamination warning, then honor the learner's explicit request without a confirmation step.",
            ]
          : []),
      );
      break;
    case "mixed":
      lines.push(
        policy.mayProactivelyNamePattern
          ? "- The learner explicitly asked for the pattern or full solution; answer that request directly under the normal disclosure contract."
          : "- Do not proactively name the node or pattern. Start from constraints, maintainable state, brute-force duplication, or current-code evidence.",
      );
      break;
  }
  return lines;
}
