import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { requestSignature } from "@/server/agents/coach-agent/turn-understanding-v2/evaluation/request-signature";

const CANDIDATE_THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8] as const;
const REQUIRED_PRECISION = 0.95;
const MAX_SCRIPT_ESCALATION_GAP = 0.1;

type QueryScript = "han" | "latin";
type LabeledCase = Readonly<{
  caseId: string;
  message: string;
  queryScript: QueryScript;
  workspace: { hasCurrentCode: boolean; hasAssistantCandidate: boolean };
  expectedRequests: readonly string[];
}>;
type Dataset = Readonly<{
  datasetVersion: string;
  status: "pending_review" | "approved";
  cases: readonly LabeledCase[];
}>;
type CalibrationRow = Readonly<{
  threshold: number;
  highCoverageCases: number;
  requestPrecision: number;
  escalationRate: number;
  hanEscalationRate: number;
  latinEscalationRate: number;
  scriptEscalationGap: number;
}>;

const dataset = readDataset();
const rows = CANDIDATE_THRESHOLDS.map((threshold) => calibrate(dataset.cases, threshold));

printTable(rows);
if (dataset.status !== "approved") {
  process.stdout.write(
    `\n${dataset.datasetVersion} is ${dataset.status}; values above are diagnostic only. ` +
      "No production threshold is selected until human review approves the labels.\n",
  );
} else {
  selectThreshold(rows);
}

function readDataset(): Dataset {
  return JSON.parse(readFileSync(
    resolve(process.cwd(), "evals/datasets/chat-intent-v3/labeled-intent-v1.json"),
    "utf8",
  )) as Dataset;
}

function calibrate(cases: readonly LabeledCase[], threshold: number): CalibrationRow {
  const compiled = cases.map((item) => ({
    item,
    ...compileCase(item),
  }));
  const highCoverage = compiled.filter(({ coverage }) => coverage >= threshold);
  const truePositiveAndFalsePositive = highCoverage.reduce(
    (tally, { actual, item }) => {
      const expected = new Set(item.expectedRequests);
      return {
        truePositive: tally.truePositive + actual.filter((value) => expected.has(value)).length,
        falsePositive: tally.falsePositive + actual.filter((value) => !expected.has(value)).length,
      };
    },
    { truePositive: 0, falsePositive: 0 },
  );
  const escalationRates = scriptEscalationRates(compiled, threshold);
  return {
    threshold,
    highCoverageCases: highCoverage.length,
    requestPrecision: ratio(
      truePositiveAndFalsePositive.truePositive,
      truePositiveAndFalsePositive.truePositive + truePositiveAndFalsePositive.falsePositive,
    ),
    escalationRate: ratio(compiled.filter(({ coverage }) => coverage < threshold).length, cases.length),
    hanEscalationRate: escalationRates.han,
    latinEscalationRate: escalationRates.latin,
    scriptEscalationGap: Math.abs(escalationRates.han - escalationRates.latin),
  };
}

function compileCase(item: LabeledCase): { coverage: number; actual: string[] } {
  const understanding = compileTurnUnderstandingV2(item.message, { workspace: item.workspace });
  return {
    coverage: understanding.coverage.ratio,
    actual: understanding.requests.map(requestSignature),
  };
}

function scriptEscalationRates(
  compiled: readonly { item: LabeledCase; coverage: number }[],
  threshold: number,
): Record<QueryScript, number> {
  return Object.fromEntries((['han', 'latin'] as const).map((script) => {
    const cases = compiled.filter(({ item }) => item.queryScript === script);
    return [script, ratio(cases.filter(({ coverage }) => coverage < threshold).length, cases.length)];
  })) as Record<QueryScript, number>;
}

function printTable(rows: readonly CalibrationRow[]): void {
  process.stdout.write("threshold highCoverage precision escalation hanEsc latinEsc gap\n");
  for (const row of rows) {
    process.stdout.write([
      row.threshold.toFixed(1),
      String(row.highCoverageCases),
      percent(row.requestPrecision),
      percent(row.escalationRate),
      percent(row.hanEscalationRate),
      percent(row.latinEscalationRate),
      percent(row.scriptEscalationGap),
    ].join(" ") + "\n");
  }
}

function selectThreshold(rows: readonly CalibrationRow[]): void {
  const selected = rows.find((row) => row.requestPrecision >= REQUIRED_PRECISION);
  if (!selected) {
    process.stderr.write(
      `No candidate reaches ${REQUIRED_PRECISION} request precision; retain the provisional threshold.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (selected.scriptEscalationGap > MAX_SCRIPT_ESCALATION_GAP) {
    process.stderr.write(
      `Selected threshold ${selected.threshold} has ${percent(selected.scriptEscalationGap)} Han/latin ` +
        "escalation gap; adjust HAN_CHARS_PER_UNIT before adopting it.\n",
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nRecommended threshold: ${selected.threshold.toFixed(1)}\n`);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
