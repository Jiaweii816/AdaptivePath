import type { InternalRunEvidenceEnvelope } from "./coach-agent.types";

/** Alignment distinguishes a revision change from a test-suite change. */
export type EvidenceAlignment =
  | "exact"
  | "code_aligned_suite_drifted"
  | "stale"
  | "none";

export type CurrentEvidenceScope = {
  codeHash?: string;
  executionFingerprint?: string;
  suiteFingerprint?: string;
};

const ALIGNMENT_RANK: Record<EvidenceAlignment, number> = {
  exact: 0,
  code_aligned_suite_drifted: 1,
  stale: 2,
  none: 3,
};

export function resolveEvidenceAlignment(args: {
  current: CurrentEvidenceScope;
  evidence?: InternalRunEvidenceEnvelope;
}): EvidenceAlignment {
  if (!args.evidence) return "none";
  if (!sameExecutedCode(args.current, args.evidence)) return "stale";
  if (!args.current.suiteFingerprint || !args.evidence.suiteFingerprint) {
    return "code_aligned_suite_drifted";
  }
  return args.current.suiteFingerprint === args.evidence.suiteFingerprint
    ? "exact"
    : "code_aligned_suite_drifted";
}

export function pickBestAlignedEvidence(
  candidates: readonly InternalRunEvidenceEnvelope[],
  current: CurrentEvidenceScope,
): { evidence?: InternalRunEvidenceEnvelope; alignment: EvidenceAlignment } {
  let best: { evidence: InternalRunEvidenceEnvelope; alignment: EvidenceAlignment } | undefined;
  for (const evidence of candidates) {
    const alignment = resolveEvidenceAlignment({ current, evidence });
    if (!best || ALIGNMENT_RANK[alignment] < ALIGNMENT_RANK[best.alignment]) {
      best = { evidence, alignment };
    }
  }
  return best ?? { alignment: "none" };
}

function sameExecutedCode(
  current: CurrentEvidenceScope,
  evidence: InternalRunEvidenceEnvelope,
) {
  if (current.executionFingerprint && evidence.executionFingerprint) {
    return current.executionFingerprint === evidence.executionFingerprint;
  }
  return Boolean(
    current.codeHash && evidence.codeHash && current.codeHash === evidence.codeHash,
  );
}
