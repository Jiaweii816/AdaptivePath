import type { ConsolidationInput } from "./consolidation-provider";

export function buildConsolidationPrompt(input: ConsolidationInput): string {
  return [
    "Consolidate this coaching chat segment into long-term memory.",
    "",
    `Problem: ${input.problemTitle} (tags: ${input.problemTags.join(", ")})`,
    `Trigger reason: ${input.triggerReason}`,
    `Current rolling summary: ${input.currentRollingSummary ?? "none"}`,
    `Evidence trace ids you MUST cite in every fact candidate: ${input.evidenceTraceIds.join(", ")}`,
    "",
    "Conversation segment:",
    ...input.messages.map(
      (message) => `${message.role}: ${message.content.slice(0, 500)}`,
    ),
    "",
    "Return strict JSON with keys:",
    "- episodeSummary: { title (<=160 chars), summary (<=600 chars, what happened / where stuck / result), outcome (\"resolved\"|\"unresolved\"|\"abandoned\"), tags (string[]), salience (0..1, higher when the user stayed stuck) }",
    "- factCandidates: array of { factType (\"unresolved_confusion\" only in Chat), tag (snake_case concept), value (one factual sentence), evidenceKind (\"reinforce\"), observedBehavior (what the user explicitly said they still did not understand), evidenceTraceIds (subset of USER message trace ids above, non-empty) }",
    "  Emit unresolved_confusion ONLY when the user demonstrably did not reach understanding.",
    "  Do NOT create mistake, weakness, strength, or skill facts from chat text; those require verified Review execution evidence. Do NOT create preferences here; explicit preferences use note_memory.",
    "  Emit nothing rather than speculative facts. confidence values are decided by code, not by you.",
    "- strategySignals: [] (reserved)",
    `- strategiesApplied: subset of these planned strategies that the assistant ACTUALLY used, as { strategyTag, appliedAssistantMessageId }: ${
      input.plannedStrategies.length === 0
        ? "none planned - return []"
        : input.plannedStrategies
            .map((strategy) => `${strategy.strategyTag}@${strategy.assistantMessageId}`)
            .join(", ")
    }`,
    "- newRollingSummary: <=300 tokens running summary of the whole session so far",
  ].join("\n");
}
