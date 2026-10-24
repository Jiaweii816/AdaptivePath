import type { RuntimeTraceEventViewModel } from "./runtime-trace-types";

type RecordValue = Record<string, unknown>;
type Candidate = RecordValue & { id?: string; title?: string; source?: string; truthClass?: string; sourceProblem?: unknown; retrievalSignals?: unknown; decisionReason?: string };

export type ContextMemoryProjection =
  | { type: "coach"; candidateLabel: string; selectedCount: number | null; retrievalStatus: string | null; queryPlan: RecordValue | null; selected: Candidate[]; rejected: Array<{ reason: string; count: number }>; candidates: unknown[]; truncated: boolean; sourceErrors: unknown[] }
  | { type: "history"; candidateLabel: string; selectedCount: number | null; mode: string | null; query: RecordValue | null; selected: Candidate[]; rejected: Array<{ reason: string; count: number }>; candidates: unknown[]; truncated: boolean }
  | { type: "unsupported"; source: string | null; raw: unknown };

export function projectContextMemory(event: RuntimeTraceEventViewModel): ContextMemoryProjection | null {
  if (event.stage !== "context_memory") return null;
  const metadata = record(event.payload?.metadata ?? event.metadata);
  const source = string(metadata?.source);
  const retrieval = record(event.payload?.retrieval);
  if (source !== "build_coach_memory_context" && source !== "history_recall_tool") return { type: "unsupported", source, raw: event.payload };
  const candidates = array(retrieval?.candidates);
  const decisions = array(retrieval?.decisions).filter(isRecord);
  const truncated = hasElision(candidates) || hasElision(decisions);
  const selectedIds = array(record(metadata?.application)?.selectedCandidateIds).filter((value): value is string => typeof value === "string");
  const selectedDecisions = decisions.filter((decision) => decision.selected === true);
  const selected = candidates.filter(isRecord).filter((candidate) => selectedIds.includes(String(candidate.id)) || selectedDecisions.some((decision) => decision.candidateId === candidate.id)).map((candidate) => withReason(candidate, decisions));
  const selectedCount = countSelected(metadata, decisions, truncated);
  const rejected = aggregateRejected(decisions, truncated);
  const candidateCount = candidateTotal(retrieval, metadata, decisions, truncated);
  const candidateLabel = `${candidateCount ?? "?"} → ${selectedCount ?? "?"}`;
  if (source === "build_coach_memory_context") return {
    type: "coach", candidateLabel, selectedCount, retrievalStatus: string(metadata?.retrievalStatus), queryPlan: record(retrieval?.queryPlan), selected, rejected, candidates, truncated, sourceErrors: array(retrieval?.sourceErrors),
  };
  return {
    type: "history", candidateLabel, selectedCount, mode: string(record(event.payload?.input)?.mode), query: record(event.payload?.input), selected, rejected, candidates, truncated,
  };
}

function countSelected(metadata: RecordValue | null, decisions: RecordValue[], truncated: boolean) {
  const selected = array(record(metadata?.application)?.selectedCandidateIds); if (selected.length) return selected.length;
  if (!truncated) return decisions.filter((decision) => decision.selected === true).length;
  return null;
}
function candidateTotal(retrieval: RecordValue | null, metadata: RecordValue | null, decisions: RecordValue[], truncated: boolean) {
  const count = number(retrieval?.candidateCount) ?? number(retrieval?.candidate_count); if (count !== null) return count;
  const selected = array(record(metadata?.application)?.selectedCandidateIds); if (selected.length) return selected.length;
  return !truncated ? decisions.filter((decision) => decision.selected === true).length : null;
}
function aggregateRejected(decisions: RecordValue[], truncated: boolean) {
  const tally = new Map<string, number>();
  for (const decision of decisions) if (decision.selected !== true) { const reason = string(decision.reason) ?? "Unspecified"; tally.set(reason, (tally.get(reason) ?? 0) + 1); }
  const rows = [...tally].map(([reason, count]) => ({ reason, count }));
  return truncated ? [...rows, { reason: "Retained decisions only; capture was truncated", count: 0 }] : rows;
}
function withReason(candidate: RecordValue, decisions: RecordValue[]): Candidate { const reason = string(decisions.find((decision) => decision.candidateId === candidate.id)?.reason) ?? string(candidate.decisionReason); return { ...candidate, ...(reason ? { decisionReason: reason } : {}) }; }
function record(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function isRecord(value: unknown): value is RecordValue { return Boolean(record(value)); }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function number(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function hasElision(items: unknown[]) { return items.some((item) => Boolean(record(item)?.traceCaptureElision)); }
