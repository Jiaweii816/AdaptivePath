import { describe, expect, it } from "vitest";
import { reduceLearnerNodeState } from "@/server/campaign/core/mastery-reducer";
import {
  CAMPAIGN_SELF_RATING_CONTRACT,
  resolveSettlementOutcome,
  type SettlementEvidenceCandidate,
} from "@/server/campaign/core/settlement-outcome-resolver";

const review = (overrides: Partial<SettlementEvidenceCandidate> = {}): SettlementEvidenceCandidate => ({
  source: "review",
  referenceId: "review-evidence",
  evidenceClass: "verdict_bearing",
  evidenceAuthority: "authoritative",
  evidenceScope: "selected_suite",
  subject: "current_user_code",
  canVerdict: true,
  verdict: "passed",
  ownershipAligned: true,
  revisionAligned: true,
  executionFingerprintAligned: true,
  suiteAligned: true,
  fullVisibleSuite: false,
  customInput: false,
  assistantCandidate: false,
  supersededAfterReview: false,
  ...overrides,
});

const local = (overrides: Partial<SettlementEvidenceCandidate> = {}): SettlementEvidenceCandidate => ({
  ...review(),
  source: "local_visible_run",
  referenceId: "local-run",
  evidenceClass: "local_only",
  evidenceAuthority: "advisory",
  evidenceScope: "full_visible_suite",
  fullVisibleSuite: true,
  ...overrides,
});

const resolve = (overrides: Partial<Parameters<typeof resolveSettlementOutcome>[0]> = {}) =>
  resolveSettlementOutcome({
    reviewCompleted: true,
    ownershipVerified: true,
    selfRating: "easy",
    reviewEvidence: review(),
    localEvidence: null,
    ...overrides,
  });

describe("Campaign Settlement outcome resolver", () => {
  it("pins canonical self-rating display semantics and polarity", () => {
    expect(CAMPAIGN_SELF_RATING_CONTRACT).toEqual({
      easy: { displayLabel: "Easy", localizedLabel: "简单", polarity: "positive" },
      hesitated: { displayLabel: "Hesitated", localizedLabel: "磕绊", polarity: "positive" },
      struggled: { displayLabel: "Struggled", localizedLabel: "困难", polarity: "negative" },
      unsolved: { displayLabel: "Unsolved", localizedLabel: "没有做出来", polarity: "negative" },
    });
    expect(resolve({ selfRating: "hesitated" }).outcome).toBe("positive");
  });
  it("prefers an aligned official Review pass", () => {
    expect(resolve()).toMatchObject({ outcome: "positive", passed: true, evidence: { source: "review" } });
  });

  it("uses an aligned full local visible pass when Review is unavailable", () => {
    expect(resolve({
      reviewEvidence: review({ canVerdict: false, verdict: "unavailable", evidenceClass: "evidence_unavailable" }),
      localEvidence: local(),
    })).toMatchObject({ outcome: "positive", passed: true, evidence: { source: "local_visible_run", evidenceScope: "full_visible_suite" } });
  });

  it.each([
    ["partial suite", { fullVisibleSuite: false }],
    ["custom input", { customInput: true }],
    ["stale revision", { revisionAligned: false }],
    ["wrong workspace ownership", { ownershipAligned: false }],
    ["wrong problem/suite", { suiteAligned: false }],
    ["assistant candidate", { assistantCandidate: true }],
    ["newer revision", { supersededAfterReview: true }],
  ])("rejects local fallback for %s", (_label, invalid) => {
    expect(resolve({
      reviewEvidence: review({ canVerdict: false, verdict: "unavailable" }),
      localEvidence: local(invalid),
    }).outcome).toBe("neutral");
  });

  it("keeps local success visibly scoped and never labels it official", () => {
    const result = resolve({
      reviewEvidence: review({ canVerdict: false, verdict: "unavailable" }),
      localEvidence: local(),
    });
    expect(result.evidence).toMatchObject({ evidenceClass: "local_only", evidenceAuthority: "advisory", evidenceScope: "full_visible_suite" });
  });

  it.each(["unsolved", "struggled"])("classifies static + %s as negative", (selfRating) => {
    expect(resolve({
      selfRating,
      reviewEvidence: review({ canVerdict: false, verdict: "unavailable" }),
    })).toMatchObject({ outcome: "negative", negativeOutcome: true });
  });

  it("classifies verdict failure + easy as negative", () => {
    expect(resolve({ reviewEvidence: review({ verdict: "failed" }) })).toMatchObject({ outcome: "negative", negativeOutcome: true });
  });

  it("keeps static + easy without local evidence neutral", () => {
    expect(resolve({ reviewEvidence: review({ canVerdict: false, verdict: "unavailable" }) }).outcome).toBe("neutral");
  });

  it("does not settle without a rating", () => {
    expect(resolve({ selfRating: null }).outcome).toBe("no_settlement");
  });

  it("masters a node stably from two different local-evidence positives", () => {
    const positive = resolve({
      reviewEvidence: review({ canVerdict: false, verdict: "unavailable" }),
      localEvidence: local(),
    });
    const reduced = reduceLearnerNodeState({
      currentState: {
        nodeId: "N7",
        exposureState: "internally_attempted",
        masteryState: "learning",
        masteryHealth: "stable",
        unlockedAt: new Date("2026-08-01T00:00:00.000Z"),
        startedAt: new Date("2026-08-01T00:00:00.000Z"),
        masteredAt: null,
        masteredBySettlementId: null,
        latestPositiveStreak: 0,
        latestSettlementIds: [],
      },
      settlements: ["majority-element", "jump-game-ii"].map((problemSlug, index) => ({
        settlementId: `local-${index}`,
        problemSlug,
        slotRole: index === 0 ? "advance" : "target",
        positiveForMastery: positive.positiveForMastery,
        negativeOutcome: positive.negativeOutcome,
        settledAt: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
      })),
    });
    expect(reduced.state).toMatchObject({ masteryState: "mastered", masteryHealth: "stable", latestPositiveStreak: 2 });
  });
});
