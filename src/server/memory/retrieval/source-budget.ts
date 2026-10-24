import type { MemoryCandidate, SourceBudget } from "./candidate-core.types";

/** Applies a source budget only after candidate truth/facets are known. */
export function applySourceBudget(
  candidates: MemoryCandidate[],
  budget: SourceBudget,
): MemoryCandidate[] {
  const ranked = [...candidates].sort(compareCandidates);
  const selected: MemoryCandidate[] = [];
  const selectedIds = new Set<string>();
  for (const [role, count] of Object.entries(budget.reservedRoleSlots ?? {})) {
    for (const candidate of ranked) {
      if (selected.length >= budget.candidateLimit) break;
      if (candidate.role !== role || selectedIds.has(candidate.id)) continue;
      selected.push(candidate);
      selectedIds.add(candidate.id);
      if (selected.filter((item) => item.role === role).length >= count!) break;
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= budget.candidateLimit) break;
    if (!selectedIds.has(candidate.id)) {
      selected.push(candidate);
      selectedIds.add(candidate.id);
    }
  }
  return selected;
}

function compareCandidates(left: MemoryCandidate, right: MemoryCandidate) {
  const score = (candidate: MemoryCandidate) => {
    const lexical = candidate.retrievalSignals.lexicalRank;
    const vector = candidate.retrievalSignals.vectorRank;
    return (lexical === undefined ? 0 : 1 / (1 + lexical)) +
      (vector === undefined ? 0 : 1 / (1 + vector));
  };
  return score(right) - score(left) || left.id.localeCompare(right.id);
}
