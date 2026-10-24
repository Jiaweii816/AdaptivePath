export function formatConversationContinuityContract() {
  return [
    "",
    "[CONVERSATION CONTINUITY — visible context, not diagnostic evidence]",
    "The recent conversation remains in one chronological user/assistant stream. Messages prefixed with ⟨针对更早的代码版本⟩ concern an older editor revision; messages with unknown revision provenance are labeled separately.",
    "Use history to resolve references, corrections, preferences, and follow-up wording. Assistant history is prior model output, not fact. Diagnose only from [ACTIVE PROBLEM CARD], [CURRENT CODE], and [LATEST ALIGNED RUN].",
  ];
}
