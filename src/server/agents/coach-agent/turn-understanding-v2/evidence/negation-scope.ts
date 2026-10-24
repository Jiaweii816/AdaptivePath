import type {
  EffectDenial,
  TurnClauseV2,
} from "../turn-understanding-v2.types";
import type {
  CategoryDenial,
  EvidenceCategory,
  IntentEvidence,
} from "./intent-evidence.types";

/** Keeps a negation local while allowing a short verb phrase before evidence. */
const NEGATION_LOOKBEHIND = 24;

const NEGATION_SCOPE =
  /(?:不要|不想|不需要|不必|别|先别|无需|不用|禁止|不许)(?:[一-龥]{0,4})\s*$|(?:不|没)(?:觉得|认为|感觉)?(?:还|再)?\s*$|\b(?:don['’]t|do not|never|without|skip|avoid|no need to)(?:\s+\S+){0,2}\s*$/iu;

/** Target answers what the turn is about. In “不要运行我的代码”, the refusal
 * applies to Effect, not to the learner's current-code target. */
const DENIABLE_CATEGORIES: ReadonlySet<EvidenceCategory> = new Set([
  "deliverable",
  "basis",
  "delivery",
  "effect",
]);

/**
 * Checks the bounded text immediately before evidence in the same clause.
 * A denial only removes capability, so a local false positive degrades safely.
 */
export function hasNegationScope(
  clauseText: string,
  localStart: number,
): boolean {
  const prefix = clauseText.slice(
    Math.max(0, localStart - NEGATION_LOOKBEHIND),
    localStart,
  );
  return NEGATION_SCOPE.test(prefix);
}

export function deriveCategoryDenials(args: {
  clauses: readonly TurnClauseV2[];
  evidence: readonly IntentEvidence[];
  effectDenials: readonly EffectDenial[];
}): CategoryDenial[] {
  const clausesById = new Map(args.clauses.map((clause) => [clause.id, clause]));
  const denials = new Map<string, CategoryDenial>();

  for (const evidence of args.evidence) {
    if (!DENIABLE_CATEGORIES.has(evidence.category)) continue;
    const clause = clausesById.get(evidence.clauseId);
    if (!clause || !isNegatedEvidence(evidence, clause)) continue;
    upsertDenial(denials, {
      category: evidence.category,
      value: evidence.value,
      sourceClauseIds: [evidence.clauseId],
      evidence: [{ ...evidence, polarity: "deny" }],
    });
  }

  for (const denial of args.effectDenials) {
    upsertDenial(denials, {
      category: "effect",
      value: denial.effect,
      sourceClauseIds: denial.sourceClauseIds,
      evidence: [],
    });
  }

  return [...denials.values()];
}

function isNegatedEvidence(
  evidence: IntentEvidence,
  clause: TurnClauseV2,
): boolean {
  return evidence.polarity === "deny" || hasNegationScope(
    clause.text,
    evidence.start - clause.start,
  );
}

function upsertDenial(
  denials: Map<string, CategoryDenial>,
  denial: CategoryDenial,
): void {
  const key = `${denial.category}:${denial.value}`;
  const existing = denials.get(key);
  denials.set(key, existing ? mergeDenials(existing, denial) : denial);
}

function mergeDenials(
  existing: CategoryDenial,
  denial: CategoryDenial,
): CategoryDenial {
  return {
    ...existing,
    sourceClauseIds: [
      ...new Set([...existing.sourceClauseIds, ...denial.sourceClauseIds]),
    ],
    evidence: [...existing.evidence, ...denial.evidence],
  };
}
