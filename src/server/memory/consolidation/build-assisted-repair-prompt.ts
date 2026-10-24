import type { AssistedRepairConsolidationInput } from "./assisted-repair-provider";

const CODE_LIMIT = 8_000;
const TEXT_LIMIT = 2_000;

export function buildAssistedRepairConsolidationPrompt(
  input: AssistedRepairConsolidationInput,
) {
  return [
    "Consolidate one relationally verified Assisted Repair Chain.",
    "Describe only this concrete repair experience. Do not infer a recurring learner weakness.",
    "A canonical mechanism proposal is optional; omit attribution when the evidence does not isolate one portable mechanism.",
    "Return strict JSON only.",
    "",
    `Problem: ${input.problemTitle}`,
    `Problem topics: ${input.problemTags.join(", ") || "none"}`,
    `Repair key: ${input.repairKey}`,
    `Evidence trace ids: ${input.evidenceTraceIds.join(", ")}`,
    "",
    "Failed learner revision:",
    truncate(input.failed.code, CODE_LIMIT),
    `Observed result: ${truncate(input.failed.resultSummary, TEXT_LIMIT)}`,
    "",
    `Learner question: ${truncate(input.userQuestion, TEXT_LIMIT)}`,
    `Aligned Coach reply: ${truncate(input.coachReply, TEXT_LIMIT)}`,
    "",
    "Later passing Review revision:",
    truncate(input.passed.code, CODE_LIMIT),
    `Observed result: ${truncate(input.passed.resultSummary, TEXT_LIMIT)}`,
    "",
    "JSON contract:",
    '- mistakeSummary: human-readable account of what was wrong in the failed revision (<=500 chars)',
    '- coachGuidance: human-readable account of the aligned Coach guidance (<=500 chars)',
    '- repairSummary: human-readable account of the later changed revision and passing result (<=500 chars)',
    '- attribution: either {status:"attributed", canonicalMechanismProposal, rationale}, {status:"uncertain", rationale}, or {status:"not_attributable", rationale}',
    "Use a controlled, portable mechanism phrase when attributed; never output an internal evidence id, raw snake_case label, confidence, or final L2 state.",
  ].join("\n");
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
