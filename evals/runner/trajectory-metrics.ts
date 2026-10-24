import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type {
  TrajectoryDatasetCase,
  TrajectoryIntegrationMarker,
  TrajectoryIntentStyle,
} from "./trajectory-dataset";

export type TrajectoryToolResultObservation = {
  toolName: ChatToolName | string;
  status: "ok" | "error" | string;
  errorKind: string | null;
};

export type TrajectoryRunObservation = {
  caseId: string;
  repeatIndex: number;
  category: string;
  toolCalls: string[];
  toolResults: TrajectoryToolResultObservation[];
  finalReply: string;
  failed: boolean;
};

export type TrajectoryCaseScore = {
  caseId: string;
  repeatIndex: number;
  category: string;
  intentStyle: TrajectoryIntentStyle;
  expectedTools: string[];
  expectedToolGroups: Array<{ label: string; anyOf: string[] }>;
  optionalTools: string[];
  forbiddenTools: string[];
  orderedSubsequence: TrajectoryOrderedStep[];
  orderedSubsequenceLabels: string[];
  toolCalls: string[];
  requiredToolsPresent: boolean;
  forbiddenToolsAbsent: boolean;
  orderedSubsequenceMatched: boolean;
  expectedToolMatch: boolean;
  unnecessaryToolCallCount: number;
  totalToolCallCount: number;
  invalidArgsCount: number;
  totalToolResultCount: number;
  multiStep: boolean;
  wrongOrder: boolean;
  integrationEligible: boolean;
  toolResultIntegrated: boolean;
  matchedIntegrationMarkers: string[];
};

export type TrajectoryOrderedStep =
  | string
  | {
      label: string;
      anyOf: string[];
    };

export type RateCount = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type TrajectorySuiteScore = {
  scoredRunCount: number;
  caseCount: number;
  expectedToolMatch: RateCount;
  unnecessaryToolCalls: {
    unnecessaryCount: number;
    totalToolCallCount: number;
    rate: number;
  };
  invalidArgs: {
    invalidArgsCount: number;
    totalToolResultCount: number;
    rate: number;
  };
  multiStepSubsequenceMatch: RateCount;
  multiStepExactMatch: RateCount;
  wrongOrder: RateCount;
  toolResultIntegration: RateCount;
  perCategory: Array<{
    category: string;
    runCount: number;
    expectedToolMatch: RateCount;
    toolResultIntegration: RateCount;
    unnecessaryToolCallRate: number;
    invalidArgsRate: number;
  }>;
  perIntentStyle: Array<{
    intentStyle: TrajectoryIntentStyle;
    runCount: number;
    expectedToolMatch: RateCount;
    toolResultIntegration: RateCount;
    unnecessaryToolCallRate: number;
    invalidArgsRate: number;
  }>;
  cases: TrajectoryCaseScore[];
};

export function computeTrajectorySuiteScore(args: {
  runs: TrajectoryRunObservation[];
  cases: TrajectoryDatasetCase[];
}): TrajectorySuiteScore {
  const casesById = new Map(args.cases.map((item) => [item.caseId, item]));
  const caseScores = args.runs.map((run) => {
    const trajectoryCase = casesById.get(run.caseId);

    if (!trajectoryCase) {
      throw new Error(`Cannot score unknown trajectory case ${run.caseId}.`);
    }

    return scoreTrajectoryRun(run, trajectoryCase);
  });
  const expectedMatches = caseScores.filter((item) => item.expectedToolMatch).length;
  const unnecessaryCount = caseScores.reduce(
    (sum, item) => sum + item.unnecessaryToolCallCount,
    0,
  );
  const totalToolCallCount = caseScores.reduce(
    (sum, item) => sum + item.totalToolCallCount,
    0,
  );
  const invalidArgsCount = caseScores.reduce(
    (sum, item) => sum + item.invalidArgsCount,
    0,
  );
  const totalToolResultCount = caseScores.reduce(
    (sum, item) => sum + item.totalToolResultCount,
    0,
  );
  const multiStepScores = caseScores.filter((item) => item.multiStep);
  const multiStepSubsequenceMatches = multiStepScores.filter(
    (item) => item.orderedSubsequenceMatched,
  ).length;
  const multiStepExactMatches = multiStepScores.filter((item) =>
    exactToolSequenceMatch(item.toolCalls, item.orderedSubsequence),
  ).length;
  const wrongOrderCount = multiStepScores.filter((item) => item.wrongOrder).length;
  const integrationEligible = caseScores.filter((item) => item.integrationEligible);
  const integratedCount = integrationEligible.filter(
    (item) => item.toolResultIntegrated,
  ).length;

  return {
    scoredRunCount: caseScores.length,
    caseCount: args.cases.length,
    expectedToolMatch: rateCount(expectedMatches, caseScores.length),
    unnecessaryToolCalls: {
      unnecessaryCount,
      totalToolCallCount,
      rate: totalToolCallCount > 0 ? unnecessaryCount / totalToolCallCount : 0,
    },
    invalidArgs: {
      invalidArgsCount,
      totalToolResultCount,
      rate: totalToolResultCount > 0 ? invalidArgsCount / totalToolResultCount : 0,
    },
    multiStepSubsequenceMatch: rateCount(
      multiStepSubsequenceMatches,
      multiStepScores.length,
    ),
    multiStepExactMatch: rateCount(multiStepExactMatches, multiStepScores.length),
    wrongOrder: rateCount(wrongOrderCount, multiStepScores.length),
    toolResultIntegration: rateCount(integratedCount, integrationEligible.length),
    perCategory: buildPerCategory(caseScores),
    perIntentStyle: buildPerIntentStyle(caseScores),
    cases: caseScores.sort(
      (left, right) =>
        left.caseId.localeCompare(right.caseId) ||
        left.repeatIndex - right.repeatIndex,
    ),
  };
}

export function scoreTrajectoryRun(
  run: TrajectoryRunObservation,
  trajectoryCase: TrajectoryDatasetCase,
): TrajectoryCaseScore {
  const expectedTools = [...trajectoryCase.expectedTools];
  const expectedToolGroups = trajectoryCase.expectedToolGroups.map((group) => ({
    label: group.label,
    anyOf: [...group.anyOf],
  }));
  const optionalTools = [...trajectoryCase.optionalTools];
  const forbiddenTools = [...trajectoryCase.forbiddenTools];
  const orderedSubsequence = trajectoryCase.orderedSubsequence.map((step) =>
    typeof step === "string"
      ? step
      : { label: step.label, anyOf: [...step.anyOf] },
  );
  const requiredToolsPresent =
    expectedTools.every((toolName) => run.toolCalls.includes(toolName)) &&
    expectedToolGroups.every((group) =>
      group.anyOf.some((toolName) => run.toolCalls.includes(toolName)),
    );
  const forbiddenToolsAbsent = forbiddenTools.every(
    (toolName) => !run.toolCalls.includes(toolName),
  );
  const orderedSubsequenceMatched = isSubsequence(
    run.toolCalls,
    orderedSubsequence,
  );
  const allowedTools = new Set([
    ...expectedTools,
    ...optionalTools,
    ...expectedToolGroups.flatMap((group) => group.anyOf),
  ]);
  const unnecessaryToolCallCount = run.toolCalls.filter(
    (toolName) => !allowedTools.has(toolName as ChatToolName),
  ).length;
  const invalidArgsCount = run.toolResults.filter(
    (result) => result.errorKind === "invalid_args",
  ).length;
  const matchedIntegrationMarkers = findMatchedIntegrationMarkers(
    run.finalReply,
    trajectoryCase.integrationMarkers,
  );
  const multiStep = orderedSubsequence.length > 1;

  return {
    caseId: run.caseId,
    repeatIndex: run.repeatIndex,
    category: run.category,
    intentStyle: trajectoryCase.intentStyle,
    expectedTools,
    expectedToolGroups,
    optionalTools,
    forbiddenTools,
    orderedSubsequence,
    orderedSubsequenceLabels: orderedSubsequence.map(formatOrderedStep),
    toolCalls: run.toolCalls,
    requiredToolsPresent,
    forbiddenToolsAbsent,
    orderedSubsequenceMatched,
    expectedToolMatch:
      requiredToolsPresent && forbiddenToolsAbsent && orderedSubsequenceMatched,
    unnecessaryToolCallCount,
    totalToolCallCount: run.toolCalls.length,
    invalidArgsCount,
    totalToolResultCount: run.toolResults.length,
    multiStep,
    wrongOrder:
      multiStep && requiredToolsPresent && !orderedSubsequenceMatched,
    integrationEligible: trajectoryCase.integrationMarkers.length > 0,
    toolResultIntegrated: matchedIntegrationMarkers.length > 0,
    matchedIntegrationMarkers,
  };
}

export function isSubsequence(
  toolCalls: string[],
  orderedSubsequence: TrajectoryOrderedStep[],
): boolean {
  if (orderedSubsequence.length === 0) {
    return true;
  }

  let cursor = 0;

  for (const toolName of toolCalls) {
    if (orderedStepMatches(toolName, orderedSubsequence[cursor])) {
      cursor += 1;
      if (cursor === orderedSubsequence.length) {
        return true;
      }
    }
  }

  return false;
}

export function findMatchedIntegrationMarkers(
  finalReply: string,
  markers: TrajectoryIntegrationMarker[],
): string[] {
  return markers
    .filter((marker) => integrationMarkerMatches(finalReply, marker))
    .map((marker) => marker.label);
}

export function integrationMarkerMatches(
  finalReply: string,
  marker: TrajectoryIntegrationMarker,
): boolean {
  if (marker.match === "compact_substring") {
    return compact(finalReply).includes(compact(marker.value));
  }

  if (marker.match === "regex") {
    return new RegExp(marker.value, "i").test(finalReply);
  }

  return finalReply.toLowerCase().includes(marker.value.toLowerCase());
}

function exactToolSequenceMatch(
  toolCalls: string[],
  expected: TrajectoryOrderedStep[],
) {
  return (
    toolCalls.length === expected.length &&
    toolCalls.every((toolName, index) => orderedStepMatches(toolName, expected[index]))
  );
}

function orderedStepMatches(toolName: string, step: TrajectoryOrderedStep | undefined) {
  if (!step) {
    return false;
  }

  return typeof step === "string" ? toolName === step : step.anyOf.includes(toolName);
}

function formatOrderedStep(step: TrajectoryOrderedStep) {
  return typeof step === "string" ? step : `${step.label}(${step.anyOf.join("|")})`;
}

function buildPerCategory(caseScores: TrajectoryCaseScore[]) {
  return [...groupBy(caseScores, (score) => score.category).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, scores]) => {
      const expectedMatches = scores.filter((item) => item.expectedToolMatch).length;
      const integrationEligible = scores.filter((item) => item.integrationEligible);
      const integratedCount = integrationEligible.filter(
        (item) => item.toolResultIntegrated,
      ).length;
      const unnecessaryCount = scores.reduce(
        (sum, item) => sum + item.unnecessaryToolCallCount,
        0,
      );
      const totalToolCallCount = scores.reduce(
        (sum, item) => sum + item.totalToolCallCount,
        0,
      );
      const invalidArgsCount = scores.reduce(
        (sum, item) => sum + item.invalidArgsCount,
        0,
      );
      const totalToolResultCount = scores.reduce(
        (sum, item) => sum + item.totalToolResultCount,
        0,
      );

      return {
        category,
        runCount: scores.length,
        expectedToolMatch: rateCount(expectedMatches, scores.length),
        toolResultIntegration: rateCount(
          integratedCount,
          integrationEligible.length,
        ),
        unnecessaryToolCallRate:
          totalToolCallCount > 0 ? unnecessaryCount / totalToolCallCount : 0,
        invalidArgsRate:
          totalToolResultCount > 0 ? invalidArgsCount / totalToolResultCount : 0,
      };
    });
}

function buildPerIntentStyle(caseScores: TrajectoryCaseScore[]) {
  return [...groupBy(caseScores, (score) => score.intentStyle).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([intentStyle, scores]) => {
      const expectedMatches = scores.filter((item) => item.expectedToolMatch).length;
      const integrationEligible = scores.filter((item) => item.integrationEligible);
      const integratedCount = integrationEligible.filter(
        (item) => item.toolResultIntegrated,
      ).length;
      const unnecessaryCount = scores.reduce(
        (sum, item) => sum + item.unnecessaryToolCallCount,
        0,
      );
      const totalToolCallCount = scores.reduce(
        (sum, item) => sum + item.totalToolCallCount,
        0,
      );
      const invalidArgsCount = scores.reduce(
        (sum, item) => sum + item.invalidArgsCount,
        0,
      );
      const totalToolResultCount = scores.reduce(
        (sum, item) => sum + item.totalToolResultCount,
        0,
      );

      return {
        intentStyle: intentStyle as TrajectoryIntentStyle,
        runCount: scores.length,
        expectedToolMatch: rateCount(expectedMatches, scores.length),
        toolResultIntegration: rateCount(
          integratedCount,
          integrationEligible.length,
        ),
        unnecessaryToolCallRate:
          totalToolCallCount > 0 ? unnecessaryCount / totalToolCallCount : 0,
        invalidArgsRate:
          totalToolResultCount > 0 ? invalidArgsCount / totalToolResultCount : 0,
      };
    });
}

function groupBy<T>(
  caseScores: T[],
  getKey: (score: T) => string,
) {
  const grouped = new Map<string, TrajectoryCaseScore[]>();

  for (const score of caseScores as TrajectoryCaseScore[]) {
    const key = getKey(score as T);
    const current = grouped.get(key) ?? [];
    current.push(score);
    grouped.set(key, current);
  }

  return grouped;
}

function rateCount(numerator: number, denominator: number): RateCount {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}
