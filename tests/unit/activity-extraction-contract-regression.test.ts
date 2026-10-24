import { describe, expect, it } from "vitest";
import {
  collectDisallowedObservations,
  parseActivityExtractionOutput,
  type ActivityExtractionInput,
} from "@/server/memory/extraction/activity-extraction-contract";
import { repairProviderShape } from "@/server/memory/extraction/activity-extraction-provider";

const input: ActivityExtractionInput = {
  cluster: {
    id: "cluster-1",
    kind: "review_rooted",
    inputHash: "hash-1",
    independentEvidenceKey: "unit-1",
    problemId: "problem-1",
    problemTitle: "Coin Change",
    problemTags: ["dynamic-programming"],
    startedAt: "2026-07-22T01:00:00.000Z",
    endedAt: "2026-07-22T01:05:00.000Z",
  },
  items: [
    {
      ordinal: 0,
      sourceType: "l1_event",
      sourceId: "trace-a",
      speaker: "learner",
      occurredAt: "2026-07-22T01:00:00.000Z",
      text: "我把 dp[j] 定义成最大价值，但题目要求方案数量。",
      evidenceTraceIds: ["trace-a"],
    },
  ],
  allowedLearnerEvidenceTraceIds: ["trace-a", "trace-b"],
  existingClaimCandidates: [],
};

const modelOutput = {
  episode: {
    title: "Coin Change state semantics",
    summary: "The learner defined dp[j] as a maximum instead of a count.",
    outcome: "improved",
    tags: ["dynamic programming"],
    salience: 0.7,
    evidenceTraceIds: ["trace-a"],
  },
  observations: [
    {
      claimType: "mistake",
      claimText:
        "The learner defined dp[j] as a maximum value instead of a count of ways.",
      polarity: "negative",
      scope: {
        level: "mechanism",
        problemIds: ["problem-1"],
        topicHints: ["dp state semantics"],
      },
      mechanismKeys: [],
      evidenceStrength: "observed",
      evidenceTraceIds: ["trace-a"],
    },
  ],
  coverage: { status: "complete" },
};

describe("activity extraction coverage derivation", () => {
  it("derives used, examined, and ignored evidence without model bookkeeping", () => {
    const output = parseActivityExtractionOutput(modelOutput, input);

    expect(output.coverage.usedEvidenceTraceIds).toEqual(["trace-a"]);
    expect(output.coverage.examinedEvidenceTraceIds).toEqual([
      "trace-a",
      "trace-b",
    ]);
    expect(output.coverage.ignoredEvidence).toEqual([
      { evidenceTraceId: "trace-b", reason: "insufficient_learner_signal" },
    ]);
  });

  it("accepts a model that omits coverage bookkeeping entirely", () => {
    const output = parseActivityExtractionOutput(
      { ...modelOutput, coverage: { status: "complete" } },
      input,
    );

    expect(output.observations).toHaveLength(1);
  });

  it("derives coverage status from the observation list instead of trusting the model", () => {
    // The model sometimes emits observations while labelling coverage
    // episode_only. Code owns the bookkeeping, so the observations decide.
    const output = parseActivityExtractionOutput(
      { ...modelOutput, coverage: { status: "episode_only" } },
      input,
    );

    expect(output.coverage.status).toBe("complete");
    expect(output.observations).toHaveLength(1);
  });

  it("keeps a zero-observation activity non-complete", () => {
    const output = parseActivityExtractionOutput(
      {
        ...modelOutput,
        observations: [],
        coverage: {
          status: "episode_only",
          noSemanticSignalReason: "Retrieval interaction only.",
        },
      },
      input,
    );

    expect(output.coverage.status).toBe("episode_only");
    expect(output.coverage.usedEvidenceTraceIds).toEqual([]);
  });

  it("derives episode evidence when the model omits it", () => {
    // Told not to restate coverage bookkeeping, qwen3-8b also drops
    // episode.evidenceTraceIds. It is derivable, so code supplies it.
    const { episode, ...rest } = modelOutput;
    const episodeWithoutEvidence = { ...episode } as Record<string, unknown>;
    delete episodeWithoutEvidence.evidenceTraceIds;
    const output = parseActivityExtractionOutput(
      { ...rest, episode: episodeWithoutEvidence },
      input,
    );

    expect(output.episode.evidenceTraceIds).toEqual(["trace-a"]);
  });

  it("falls back to the allowed evidence when there are no observations", () => {
    const { episode, ...rest } = modelOutput;
    const episodeWithoutEvidence = { ...episode } as Record<string, unknown>;
    delete episodeWithoutEvidence.evidenceTraceIds;
    const output = parseActivityExtractionOutput(
      {
        ...rest,
        episode: episodeWithoutEvidence,
        observations: [],
        coverage: { status: "episode_only", noSemanticSignalReason: "Recall only." },
      },
      input,
    );

    expect(output.episode.evidenceTraceIds).toEqual(["trace-a", "trace-b"]);
  });

  it("drops an observation citing disallowed evidence and keeps the valid ones", () => {
    const output = parseActivityExtractionOutput(
      {
        ...modelOutput,
        observations: [
          modelOutput.observations[0],
          {
            ...modelOutput.observations[0],
            claimText: "This observation cites an id the system never supplied.",
            evidenceTraceIds: ["trace-hallucinated"],
          },
        ],
      },
      input,
    );

    expect(output.observations).toHaveLength(1);
    expect(output.observations[0].evidenceTraceIds).toEqual(["trace-a"]);
    expect(output.coverage.usedEvidenceTraceIds).toEqual(["trace-a"]);
  });

  it("reports which observations were dropped for disallowed evidence", () => {
    const dropped = collectDisallowedObservations(
      {
        ...modelOutput,
        observations: [
          modelOutput.observations[0],
          {
            ...modelOutput.observations[0],
            evidenceTraceIds: ["trace-hallucinated"],
          },
        ],
      },
      input,
    );

    expect(dropped).toEqual([
      {
        index: 1,
        reason: "observation_evidence_not_allowed:trace-hallucinated",
      },
    ]);
  });

  it("falls back to derived episode evidence when every supplied id is disallowed", () => {
    const output = parseActivityExtractionOutput(
      {
        ...modelOutput,
        episode: {
          ...modelOutput.episode,
          evidenceTraceIds: ["trace-hallucinated"],
        },
      },
      input,
    );

    expect(output.episode.evidenceTraceIds).toEqual(["trace-a"]);
  });
});

describe("provider shape repair", () => {
  it("coerces a numeric salience string to a clamped number", () => {
    const repaired = repairProviderShape({
      episode: { outcome: "improved", salience: "0.7" },
    }) as { episode: { salience: unknown } };

    expect(repaired.episode.salience).toBe(0.7);
  });

  it("clamps an out-of-range numeric string", () => {
    const repaired = repairProviderShape({
      episode: { outcome: "improved", salience: "1.4" },
    }) as { episode: { salience: unknown } };

    expect(repaired.episode.salience).toBe(1);
  });

  it("maps a qualitative salience word to a number", () => {
    // qwen3-8b returns "high" rather than 0.85 for episode.salience.
    const repaired = repairProviderShape({
      episode: { outcome: "improved", salience: "high" },
    }) as { episode: { salience: unknown } };

    expect(repaired.episode.salience).toBe(0.85);
  });

  it("leaves an unrecognised salience string invalid", () => {
    const repaired = repairProviderShape({
      episode: { outcome: "improved", salience: "somewhat notable" },
    }) as { episode: { salience: unknown } };

    expect(repaired.episode.salience).toBe("somewhat notable");
  });

  it("still normalizes outcome aliases", () => {
    const repaired = repairProviderShape({
      episode: { outcome: "completed", salience: 0.5 },
    }) as { episode: { outcome: unknown } };

    expect(repaired.episode.outcome).toBe("resolved");
  });
});
