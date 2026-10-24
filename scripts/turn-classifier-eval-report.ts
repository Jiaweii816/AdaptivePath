import type { ClassifierEvalReport } from "./turn-classifier-eval-metrics";

export function renderClassifierEvalReport(
  report: ClassifierEvalReport,
): string {
  const baseline = report.baseline.aggregate;
  const classifier = report.classifier.aggregate;
  const lines = [
    "# Turn Classifier Trajectory Eval",
    "",
    `- Result: **${report.gate.passed ? "PASS" : "FAIL"}**`,
    `- Model: ${report.model}`,
    `- Dataset/version: ${report.datasetVersion} / ${report.reportVersion}`,
    `- Generated: ${report.generatedAt}`,
    `- Operation exact: ${baseline.operationExact}/${baseline.inScopeCases} → ${classifier.operationExact}/${classifier.inScopeCases}`,
    `- Operation P/R/F1: ${percent(baseline.operationPrecision)}/${percent(baseline.operationRecall)}/${percent(baseline.operationF1)} → ${percent(classifier.operationPrecision)}/${percent(classifier.operationRecall)}/${percent(classifier.operationF1)}`,
    `- Target matched: ${baseline.targetMatched}/${baseline.targetTotal} → ${classifier.targetMatched}/${classifier.targetTotal}`,
    `- Required capability: ${baseline.requiredMatched}/${baseline.requiredTotal} → ${classifier.requiredMatched}/${classifier.requiredTotal}`,
    `- Forbidden opened: ${baseline.forbiddenOpened} → ${classifier.forbiddenOpened}`,
    `- Side-effect FP (execute/persist/hint): ${classifier.executeFalsePositives}/${classifier.persistFalsePositives}/${classifier.hintStateFalsePositives}`,
    `- Classifier calls/validated/fallback/validator rejects/fast calls: ${classifier.classifierCalls}/${classifier.validated}/${classifier.fallbacks}/${classifier.validatorRejects}/${classifier.fastRouteClassifierCalls}`,
    `- Wall classifier latency: ${classifier.wallLatencyMs} ms`,
    `- Provider token delta (baseline=0): input ${report.providerUsage.inputTokens}, output ${report.providerUsage.outputTokens}, total ${report.providerUsage.totalTokens}`,
    `- Gate failures: ${report.gate.failures.join(", ") || "none"}`,
    `- Regressed baseline-correct cases: ${report.regressedCorrectCaseIds.join(", ") || "none"}`,
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    "## Per case",
    "",
    "| Case | Scope | Baseline ops | Classifier ops | Required | Forbidden | Route/provenance | Latency |",
    "|---|---|---|---|---|---|---|---|",
  ];
  appendRows(lines, report);
  return `${lines.join("\n")}\n`;
}

function appendRows(lines: string[], report: ClassifierEvalReport): void {
  const baselineRows = new Map(
    report.baseline.rows.map((row) => [row.caseId, row]),
  );
  for (const row of report.classifier.rows) {
    const baseline = baselineRows.get(row.caseId);
    if (!baseline) throw new Error(`Missing baseline eval row: ${row.caseId}`);
    const fallback = row.fallbackReason ? `<br>${row.fallbackReason}` : "";
    lines.push(
      `| ${row.caseId} | ${row.inScope ? "in" : "out"} | ${cells(baseline.actualOperations)} | ${cells(row.actualOperations)} | ${row.requiredMatched}/${row.requiredTotal} | ${cells(row.forbiddenOpened)} | ${row.route}/${row.provenance}${fallback} | ${row.latencyMs} ms |`,
    );
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function cells(values: readonly string[]): string {
  return values.length ? values.join("<br>") : "—";
}
