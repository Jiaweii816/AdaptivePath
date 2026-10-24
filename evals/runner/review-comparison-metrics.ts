import { computePercentile } from "@/server/observability/agent-observability";

export type TagSetRun = {
  caseId: string;
  repeatIndex: number;
  mistakeTags: string[];
};

export type DiagnosisTagStability = {
  rate: number | null;
  matchingComparisons: number;
  totalComparisons: number;
  perCase: Array<{
    caseId: string;
    baselineTags: string[];
    matchingComparisons: number;
    totalComparisons: number;
    rate: number | null;
  }>;
};

export type MutualDiagnosisTagConsistency = {
  rate: number | null;
  matchingComparisons: number;
  totalComparisons: number;
  perCase: Array<{
    caseId: string;
    matchingComparisons: number;
    totalComparisons: number;
    rate: number | null;
  }>;
};

export type NumericPercentiles = {
  p50: number | null;
  p95: number | null;
};

export function normalizeMistakeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
}

export function sameTagSet(left: string[], right: string[]) {
  const normalizedLeft = normalizeMistakeTags(left);
  const normalizedRight = normalizeMistakeTags(right);

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function computeDiagnosisTagStability(
  runs: TagSetRun[],
): DiagnosisTagStability {
  const perCase: DiagnosisTagStability["perCase"] = [];

  for (const [caseId, caseRuns] of groupByCase(runs)) {
    const sortedRuns = [...caseRuns].sort(
      (a, b) => a.repeatIndex - b.repeatIndex,
    );
    const baseline = sortedRuns[0]?.mistakeTags ?? [];
    let matchingComparisons = 0;

    for (const run of sortedRuns) {
      if (sameTagSet(run.mistakeTags, baseline)) {
        matchingComparisons += 1;
      }
    }

    perCase.push({
      caseId,
      baselineTags: normalizeMistakeTags(baseline),
      matchingComparisons,
      totalComparisons: sortedRuns.length,
      rate: rate(matchingComparisons, sortedRuns.length),
    });
  }

  const matchingComparisons = perCase.reduce(
    (sum, item) => sum + item.matchingComparisons,
    0,
  );
  const totalComparisons = perCase.reduce(
    (sum, item) => sum + item.totalComparisons,
    0,
  );

  return {
    rate: rate(matchingComparisons, totalComparisons),
    matchingComparisons,
    totalComparisons,
    perCase,
  };
}

export function computeMutualDiagnosisTagConsistency(args: {
  oneCallRuns: TagSetRun[];
  twoCallRuns: TagSetRun[];
}): MutualDiagnosisTagConsistency {
  const oneByKey = new Map(
    args.oneCallRuns.map((run) => [runKey(run.caseId, run.repeatIndex), run]),
  );
  const twoByCase = groupByCase(args.twoCallRuns);
  const perCase: MutualDiagnosisTagConsistency["perCase"] = [];

  for (const [caseId, twoRuns] of twoByCase) {
    let matchingComparisons = 0;
    let totalComparisons = 0;

    for (const twoRun of twoRuns) {
      const oneRun = oneByKey.get(runKey(twoRun.caseId, twoRun.repeatIndex));

      if (!oneRun) {
        continue;
      }

      totalComparisons += 1;
      if (sameTagSet(oneRun.mistakeTags, twoRun.mistakeTags)) {
        matchingComparisons += 1;
      }
    }

    perCase.push({
      caseId,
      matchingComparisons,
      totalComparisons,
      rate: rate(matchingComparisons, totalComparisons),
    });
  }

  const matchingComparisons = perCase.reduce(
    (sum, item) => sum + item.matchingComparisons,
    0,
  );
  const totalComparisons = perCase.reduce(
    (sum, item) => sum + item.totalComparisons,
    0,
  );

  return {
    rate: rate(matchingComparisons, totalComparisons),
    matchingComparisons,
    totalComparisons,
    perCase,
  };
}

export function summarizePercentiles(values: number[]): NumericPercentiles {
  return {
    p50: computePercentile(values, 50),
    p95: computePercentile(values, 95),
  };
}

function groupByCase<T extends { caseId: string }>(runs: T[]) {
  const grouped = new Map<string, T[]>();

  for (const run of runs) {
    const current = grouped.get(run.caseId) ?? [];
    current.push(run);
    grouped.set(run.caseId, current);
  }

  return grouped;
}

function runKey(caseId: string, repeatIndex: number) {
  return `${caseId}\u001f${repeatIndex}`;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
