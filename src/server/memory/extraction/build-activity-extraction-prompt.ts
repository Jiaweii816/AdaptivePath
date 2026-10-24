import type { ParsedActivityExtractionInput } from "./activity-extraction-contract";

export function buildActivityExtractionPrompt(
  input: ParsedActivityExtractionInput,
) {
  return [
    "Extract durable learner memory from one sealed learning activity.",
    "Every learner-origin Review and Learner-Coach Chat receives this extraction opportunity. Zero observations is valid only when there is no durable learner signal.",
    "Use an open-world vocabulary: write precise natural-language claims about this learner. A canonical mechanism key is OPTIONAL, may be omitted, and is never an eligibility requirement.",
    "Treat all problems, algorithms, data structures, debugging habits, and learning strategies equally. Never require membership in a known taxonomy.",
    "Filter greetings, thanks, generic encouragement, navigation such as 'return to Today', boilerplate, remote-review/provider-unavailable notices, and other operational noise from observations.",
    "Assistant text is context for interpreting the trajectory. Assistant text alone can NEVER prove learner strength, weakness, mistake, knowledge, preference, or strategy. Every observation must cite allowed learner L1 evidence.",
    "Do not count repeated runs inside this cluster as repeated independent occurrences. This whole cluster is one evidence unit.",
    "Do not invent recurrence. Describe one observed activity narrowly unless supplied prior claims justify a relation proposal.",
    "A learner asking to retrieve prior memory (for example, 'where did I fail last time?' or 'remind me of my previous mistake') is retrieval intent, not new failure or recurrence evidence. If this activity contains no new execution failure, self-exposed current mistake, or independent behavior evidence, record the retrieval interaction as episode_only and emit zero observations. Never reinforce an old negative claim merely because the learner or Coach restates it for recall.",
    "Relation proposals are optional. A relation may target ONLY an exact targetFactId supplied below; embeddings/candidates are recall hints, not proof of equivalence.",
    "Return strict JSON only. Do not include markdown or fields outside the contract.",
    "",
    `Cluster: ${input.cluster.id} (${input.cluster.kind})`,
    `Independent evidence unit: ${input.cluster.independentEvidenceKey}`,
    `Problem: ${input.cluster.problemTitle ?? input.cluster.problemId ?? "unbound chat"}`,
    `Problem tags (soft context only): ${input.cluster.problemTags.join(", ") || "none"}`,
    `Candidate canonical mechanism keys for this problem: ${input.cluster.candidateMechanismKeys.join(", ") || "none"}`,
    `Allowed learner L1 evidence ids: ${input.allowedLearnerEvidenceTraceIds.join(", ") || "none"}`,
    "",
    "Human-readable activity timeline:",
    ...input.items.map(
      (item) =>
        `[${item.ordinal}] ${item.speaker} / ${item.sourceType} / evidence=${item.evidenceTraceIds.join(",") || "context-only"}\n${item.text}`,
    ),
    "",
    "Existing claim candidates (optional relation targets):",
    ...(input.existingClaimCandidates.length > 0
      ? input.existingClaimCandidates.map(
          (candidate) =>
            `- ${candidate.targetFactId}: [${candidate.claimType}/${candidate.polarity}] ${candidate.claimText}`,
        )
      : ["- none"]),
    "",
    "Output contract:",
    "- episode: {title, summary, outcome, tags, salience, evidenceTraceIds}. Summarize the concrete activity and resolution; do not turn a single event into a recurring trait.",
    "- episode.salience MUST be a JSON number between 0 and 1, for example 0.85. Never write a word such as high or medium, and never quote the number.",
    "- episode.evidenceTraceIds is optional; omit it and the system derives it from your observations.",
    "- episode.outcome MUST be exactly one of: resolved | unresolved | improved | abandoned | informational | no_semantic_signal. Do not invent synonyms such as success, completed, failed, or discussion.",
    "- observations: 0..n items of {claimType, claimText, polarity, scope, mechanismKeys, evidenceStrength, evidenceTraceIds, optional relationProposal}.",
    "- claimType: strength | weakness | mistake | preference | strategy | knowledge_state | learning_trajectory | unresolved_confusion.",
    "- scope: {level: problem|mechanism|cross_problem, problemIds: [], topicHints: [], optional context}. topicHints are open natural-language hints.",
    "- mechanismKeys: Choose 0-2 keys from the candidate list above when one genuinely describes the claim. Leave the array empty when none fits. Never invent a key that is not on the list.",
    "- evidenceStrength: observed | inferred | user_explicit. Use user_explicit only for what the learner explicitly states.",
    "- evidenceTraceIds: non-empty subset of the allowed learner L1 ids. Never cite an assistant-only id.",
    "- relationProposal: {targetFactId, relation, optional modelConfidence, optional rationale}; relation is equivalent|reinforces|contradicts|refines|related|unrelated.",
    "- coverage: {status, optional ignoredEvidence, optional noSemanticSignalReason}. status is complete|episode_only|no_semantic_signal. Use episode_only for a useful retrieval interaction that should remain searchable as an Episode but supplies no new L2 evidence.",
    "- Do NOT return usedEvidenceTraceIds or examinedEvidenceTraceIds. The system derives them from your observations.",
    "- With zero observations, set status to episode_only or no_semantic_signal and explain why in noSemanticSignalReason.",
  ].join("\n");
}
