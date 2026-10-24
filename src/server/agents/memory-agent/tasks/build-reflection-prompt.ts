import type { ReflectionInput } from "./reflection-provider";

export function buildReflectionPrompt(input: ReflectionInput): string {
  return [
    "Reflect over this learner's recent memory and propose synthesis updates.",
    "",
    `Learner: ${input.userHandle}`,
    "",
    "Recent episodes (id | outcome | tags | title - summary):",
    ...input.episodes.map(
      (episode) =>
        `- ${episode.id} | ${episode.outcome} | ${episode.tags.join(",")} | ${episode.title} - ${episode.summary.slice(0, 200)}`,
    ),
    "",
    "Changed and recent trusted open-world claims (id | type | polarity | confidence | independent clusters/problems | scope/topics | learner claim):",
    ...input.changedFacts.map(
      (fact) => {
        const problemCount = new Set(
          fact.evidenceClusters.flatMap((cluster) =>
            cluster.problemId ? [cluster.problemId] : [],
          ),
        ).size;
        const scope = fact.scope
          ? `${fact.scope.level}; problems=${fact.scope.problemIds.join(",") || "none"}; topics=${fact.scope.topicHints.join(",") || "open"}${fact.scope.context ? `; context=${fact.scope.context}` : ""}`
          : "open";
        return `- ${fact.id} | ${fact.factType} | ${fact.polarity ?? "unspecified"} | ${fact.confidence.toFixed(2)} | ${fact.evidenceClusters.length}/${problemCount} | ${scope} | ${fact.claimText ?? fact.value ?? ""}`;
      },
    ),
    "",
    "Existing active slots:",
    ...(input.activeSlots.length === 0
      ? ["- none"]
      : input.activeSlots.map(
          (slot) => `- ${slot.slot}/${slot.synthesisKey}: ${slot.text}`,
        )),
    "",
    "Unconsumed strategy signals:",
    ...(input.strategySignals.length === 0
      ? ["- none"]
      : input.strategySignals.map(
          (signal) =>
            `- ${signal.tag} (${signal.polarity}): ${signal.observation}`,
        )),
    "",
    "Rules:",
    "- Treat every problem, data structure, algorithm, debugging habit, reasoning habit, and learner strategy equally. There is no privileged demo-topic list.",
    "- Synthesize by the natural-language meaning of learner claims. mechanismKeys and topic hints are optional ranking/projecting metadata, never eligibility gates.",
    "- Do not require a canonical mechanism and do not invent one. A valid recurring learner pattern may be entirely open vocabulary.",
    "- A slot needs at least 2 independent trusted Evidence Clusters spanning different problems; otherwise do not emit it.",
    "- One aggregated fact may satisfy the gate when it contains 2 cross-problem clusters. Two fact rows from the same problem do not satisfy it.",
    "- strengths must cite positive evidence only; weakness_patterns must cite negative evidence only. Other slots may combine compatible evidence when the text accurately reflects it.",
    "- Use hedged language. Write slot text in English only, even when episodes or learner claims appear in another language. Keep each slot text <=220 characters.",
    "- slotUpserts must be an array. Each item is { slot, synthesisKey, text, evidenceFactIds, confidence, status }.",
    "- slots: weakness_patterns | strengths | teaching_strategy | practice_plan | recent_overview.",
    "- evidenceFactIds must be an array of existing changed/related fact ids; it may contain one fact id when that fact carries 2 cross-problem clusters.",
    "- evidenceFactIds: [] is invalid inside a slotUpsert. Copy at least one exact eligible fact id from the changed/related facts list, or omit the entire slotUpsert object.",
    "- confidence must be a number from 0 to 1, not a quoted string.",
    "- status must be active | stale | resolved. Use active unless clearly stale/resolved.",
    "- strategyProposals must be an array. Each item is { tag, hypothesis, expectedObservable, evidenceTraceIds }.",
    "- If Unconsumed strategy signals says none, strategyProposals must be []. Never invent a teaching strategy from facts or episodes.",
    "- strategyProposals.expectedObservable must be exactly one of reviewTransition | repeatMistakeRate | hintEscalation | selfCorrection.",
    "- strategyProposals.evidenceTraceIds must be an array of trace id strings, never a single string.",
    "- You only PROPOSE. Promotion/demotion of strategies is decided by deterministic code, never by you.",
    "- factAudits must be an array. Each item uses the FactCandidate contract: { factType, tag, value, evidenceKind, observedBehavior, evidenceTraceIds }.",
    "- factAudits.evidenceKind must be exactly one of reinforce | weaken | resolve | contradict | preference_set.",
    "- factAudits.evidenceTraceIds must be a non-empty array of trace id strings.",
    "- If you are unsure, emit [] for that array rather than malformed or speculative objects.",
    "",
    "Return strict JSON only: { \"slotUpserts\": [], \"strategyProposals\": [], \"factAudits\": [] }",
  ].join("\n");
}
