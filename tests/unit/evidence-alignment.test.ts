import { describe, expect, it } from "vitest";
import {
  pickBestAlignedEvidence,
  resolveEvidenceAlignment,
  type CurrentEvidenceScope,
} from "@/server/agents/coach-agent/evidence-alignment";
import type { InternalRunEvidenceEnvelope } from "@/server/agents/coach-agent/coach-agent.types";

const current: CurrentEvidenceScope = {
  codeHash: "sha256:code-a",
  executionFingerprint: "execfp:v1:sha256:code-a",
  suiteFingerprint: "sha256:suite-a",
};

function evidence(id: string, overrides: Partial<InternalRunEvidenceEnvelope> = {}) {
  return {
    id,
    storageSource: "practice_run",
    producer: "user_action",
    subject: "current_user_code",
    authority: "authoritative",
    scope: { kind: "selected_suite", totalCount: 1 },
    oracle: "stored_expected",
    createdAt: "2026-08-19T10:00:00.000Z",
    codeHash: current.codeHash,
    executionFingerprint: current.executionFingerprint,
    suiteFingerprint: current.suiteFingerprint,
    result: { status: "failed", passedCount: 0, failedCount: 1, stdout: "", stderr: "", testResults: [] },
    ...overrides,
  } as InternalRunEvidenceEnvelope;
}

describe("run evidence alignment", () => {
  it("separates exact, suite drift, stale, and absent evidence", () => {
    expect(resolveEvidenceAlignment({ current })).toBe("none");
    expect(resolveEvidenceAlignment({ current, evidence: evidence("exact") })).toBe("exact");
    expect(resolveEvidenceAlignment({ current, evidence: evidence("drift", { suiteFingerprint: null }) })).toBe("code_aligned_suite_drifted");
    expect(resolveEvidenceAlignment({ current, evidence: evidence("stale", { executionFingerprint: "execfp:v1:sha256:other" }) })).toBe("stale");
  });

  it("prefers an older matching revision and otherwise retains stale evidence for invalidation", () => {
    const stale = evidence("newer", { executionFingerprint: "execfp:v1:sha256:other" });
    const exact = evidence("older");
    expect(pickBestAlignedEvidence([stale, exact], current)).toEqual({ evidence: exact, alignment: "exact" });
    expect(pickBestAlignedEvidence([stale], current)).toEqual({ evidence: stale, alignment: "stale" });
  });
});
