import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { requestSignature } from "@/server/agents/coach-agent/turn-understanding-v2/evaluation/request-signature";
import { resolveTurnUnderstandingForEvaluation } from "@/server/agents/coach-agent/turn-understanding-v2/evaluation/resolve-turn-understanding-for-evaluation";
import type { TurnRequest } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";

type ExpectedTier = "none" | "tier1" | "tier2";
type Axis = "deliverable" | "target" | "basis" | "delivery" | "effect";

type LabeledCase = {
  readonly caseId: string;
  readonly message: string;
  readonly queryScript: "han" | "latin";
  readonly slice: "easy" | "compound" | "negation" | "referent" | "effect" | "unknown";
  readonly workspace: { readonly hasCurrentCode: boolean; readonly hasAssistantCandidate: boolean };
  readonly expectedRequests: readonly string[];
  readonly expectedDenials: readonly { readonly category: string; readonly value: string }[];
  readonly expectedTier: ExpectedTier;
};

type Dataset = {
  readonly status: "pending_review" | "approved";
  readonly cases: readonly LabeledCase[];
};

const DATASET = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "evals/datasets/chat-intent-v3/labeled-intent-v1.json"),
    "utf8",
  ),
) as Dataset;

const RECORDINGS = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "evals/datasets/chat-intent-v3/model-assembler-recordings-v1.json"),
    "utf8",
  ),
) as { recordings: readonly { caseId: string; output: unknown }[] };

const RECORDING_BY_CASE = new Map(
  RECORDINGS.recordings.map(({ caseId, output }) => [caseId, output]),
);

function compile(item: LabeledCase) {
  return compileTurnUnderstandingV2(item.message, { workspace: item.workspace });
}

function resolveForEvaluation(item: LabeledCase) {
  return resolveTurnUnderstandingForEvaluation({
    message: item.message,
    workspace: item.workspace,
    recordedAssembly: RECORDING_BY_CASE.get(item.caseId),
  });
}

describe("labelled intent dataset", () => {
  it("keeps the hand-labelled seed in review status", () => {
    expect(DATASET.status).toBe("pending_review");
    expect(DATASET.cases).toHaveLength(30);
    expect(distribution("slice")).toEqual({
      compound: 5, easy: 5, effect: 5, negation: 5, referent: 5, unknown: 5,
    });
    expect(distribution("queryScript")).toEqual({ han: 15, latin: 15 });
  });

  it.each(DATASET.cases)("$caseId asserts every resolved request", async (item) => {
    expect((await resolveForEvaluation(item)).requests.map(requestSignature).sort()).toEqual(
      [...item.expectedRequests].sort(),
    );
  });

  it.each(historyCases())("$caseId opens history through Basis after resolution", async (item) => {
    const requests = (await resolveForEvaluation(item)).requests;
    const expectedBasis = expectedHistoryBasis(item);
    if (!expectedBasis) throw new Error(`Missing expected history basis for ${item.caseId}`);
    expect(requests.some((request) =>
      request.kind === "respond" && request.basis.includes(expectedBasis),
    )).toBe(true);
  });

  it.each(DATASET.cases)("$caseId asserts every denial", (item) => {
    const actual = compile(item).categoryDenials
      .map((denial) => `${denial.category}:${denial.value}`).sort();
    const expected = item.expectedDenials
      .map((denial) => `${denial.category}:${denial.value}`).sort();
    expect(actual).toEqual(expected);
  });

  it.each(DATASET.cases)("$caseId asserts its highest requested tier", (item) => {
    expect(highestTier(compile(item).requests)).toBe(item.expectedTier);
  });

  it("prints diagnostic per-axis alignment, not an accuracy claim", () => {
    process.stdout.write(`${JSON.stringify(scoreByCategory(DATASET.cases), null, 2)}\n`);
    expect(DATASET.cases.length).toBeGreaterThan(0);
  });

  it("prints coverage and unknown counts by query script", () => {
    const counts = { han: [0, 0], latin: [0, 0] } as Record<string, number[]>;
    for (const item of DATASET.cases) {
      const count = counts[item.queryScript]!;
      count[0] += 1;
      if (compile(item).coverage.resolution === "unknown") count[1] += 1;
    }
    process.stdout.write(`${JSON.stringify({ diagnosticCoverage: counts })}\n`);
    expect(counts.han![0] + counts.latin![0]).toBe(DATASET.cases.length);
  });
});

function distribution<Key extends "slice" | "queryScript">(
  key: Key,
): Record<string, number> {
  return DATASET.cases.reduce<Record<string, number>>((counts, item) => {
    const value = item[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function historyCases() {
  return DATASET.cases.filter((item) => expectedHistoryBasis(item) !== undefined);
}

function expectedHistoryBasis(item: LabeledCase) {
  const signature = item.expectedRequests.find((request) =>
    request.includes("past_problems") || request.includes("past_mistakes"),
  );
  return signature?.includes("past_mistakes") ? "past_mistakes" as const
    : signature?.includes("past_problems") ? "past_problems" as const
      : undefined;
}

function highestTier(requests: readonly TurnRequest[]): ExpectedTier {
  if (requests.some((request) => request.kind === "persist")) return "tier2";
  return requests.some((request) => request.kind === "execute") ? "tier1" : "none";
}

function scoreByCategory(cases: readonly LabeledCase[]) {
  const tallies = Object.fromEntries(
    (["deliverable", "target", "basis", "delivery", "effect"] as const)
      .map((axis) => [axis, { tp: 0, fp: 0, fn: 0 }]),
  ) as Record<Axis, { tp: number; fp: number; fn: number }>;
  for (const item of cases) scoreCase(tallies, item);
  return Object.fromEntries(Object.entries(tallies).map(([axis, tally]) => [
    axis, ratios(tally),
  ]));
}

function scoreCase(
  tallies: Record<Axis, { tp: number; fp: number; fn: number }>,
  item: LabeledCase,
): void {
  const actual = new Set(compile(item).requests.map(requestSignature));
  const expected = new Set(item.expectedRequests);
  for (const axis of Object.keys(tallies) as Axis[]) {
    tallyAxis(tallies[axis], axisSet(actual, axis), axisSet(expected, axis));
  }
}

function tallyAxis(
  tally: { tp: number; fp: number; fn: number }, actual: Set<string>, expected: Set<string>,
): void {
  for (const value of actual) {
    if (expected.has(value)) tally.tp++;
    else tally.fp++;
  }
  for (const value of expected) if (!actual.has(value)) tally.fn++;
}

function axisSet(signatures: Set<string>, axis: Axis): Set<string> {
  return new Set([...signatures].flatMap((signature) => {
    const value = axisValue(signature, axis);
    return value ? [value] : [];
  }));
}

function axisValue(signature: string, axis: Axis): string | undefined {
  const parts = signature.split(":");
  if (parts[0] === "respond") {
    return parts[{ deliverable: 1, target: 2, basis: 3, delivery: 4, effect: 0 }[axis]];
  }
  return axis === "effect" ? parts[0] : undefined;
}

function ratios({ tp, fp, fn }: { tp: number; fp: number; fn: number }) {
  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}
