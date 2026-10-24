import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type { EvalRuntimeConfig } from "./eval-runtime";
import type { PlaceholderScore } from "./placeholder-suite";

export type EvalCoachReport = {
  suiteName: string;
  runId: string;
  generatedAt: string;
  dbPath: string;
  dbKept: boolean;
  backgroundJobsPolicy: string;
  traceOptions: {
    enabled: boolean;
  };
  score: PlaceholderScore;
  observability: {
    sampleCounts: AgentObservabilityReport["sampleCounts"];
    providerUsage: AgentObservabilityReport["providerUsage"];
    review: {
      count: number;
      traceRunCount: number;
      llmCallCount: number;
    };
    chat: {
      count: number;
      traceRunCount: number;
      llmCallCount: number;
      toolCallsPerChat: number | null | undefined;
    };
    malformedEventJsonCount: number;
    warningCount: number;
    warnings: string[];
  };
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function buildEvalCoachReport(args: {
  runtime: EvalRuntimeConfig;
  dbKept: boolean;
  score: PlaceholderScore;
  observability: AgentObservabilityReport;
}): EvalCoachReport {
  return {
    suiteName: args.runtime.suiteName,
    runId: args.runtime.runId,
    generatedAt: args.runtime.generatedAt.toISOString(),
    dbPath: args.runtime.dbPath,
    dbKept: args.dbKept,
    backgroundJobsPolicy: args.runtime.backgroundJobsPolicy,
    traceOptions: args.runtime.traceOptions,
    score: args.score,
    observability: {
      sampleCounts: args.observability.sampleCounts,
      providerUsage: args.observability.providerUsage,
      review: {
        count: args.observability.review.count,
        traceRunCount: args.observability.review.traceRunCount,
        llmCallCount: args.observability.review.llmCallCount,
      },
      chat: {
        count: args.observability.chat.count,
        traceRunCount: args.observability.chat.traceRunCount,
        llmCallCount: args.observability.chat.llmCallCount,
        toolCallsPerChat: args.observability.chat.toolCallsPerChat,
      },
      malformedEventJsonCount: args.observability.malformedEventJsonCount,
      warningCount: args.observability.warningCount,
      warnings: args.observability.warnings,
    },
    reportPaths: args.runtime.reportPaths,
  };
}

export function writeEvalCoachReport(report: EvalCoachReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(report.reportPaths.markdown, renderEvalCoachMarkdown(report), "utf8");
  writeFileSync(report.reportPaths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderEvalCoachMarkdown(report: EvalCoachReport) {
  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Eval DB path: ${report.dbPath}`,
    `- DB kept: ${report.dbKept ? "yes" : "no"}`,
    `- Suite name: ${report.suiteName}`,
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Background jobs policy: ${report.backgroundJobsPolicy}`,
    `- Trace enabled: ${report.traceOptions.enabled ? "yes" : "no"}`,
    "",
    "## Score",
    "",
    `- Case count: ${report.score.caseCount}`,
    `- Pass count: ${report.score.passCount}`,
    `- Fail count: ${report.score.failCount}`,
    "",
    "| Case | Status | Message |",
    "|---|---|---|",
    ...report.score.cases.map(
      (item) => `| ${item.name} | ${item.status} | ${item.message} |`,
    ),
    "",
    "## Observability",
    "",
    `- Review path count: ${report.observability.sampleCounts.reviewPathCount}`,
    `- Chat path count: ${report.observability.sampleCounts.chatPathCount}`,
    `- LLM call count: ${report.observability.sampleCounts.llmCallCount}`,
    `- Tool call count: ${report.observability.sampleCounts.toolCallCount}`,
    `- Provider usage missing: ${report.observability.providerUsage.missingCount}/${report.observability.sampleCounts.llmCallCount}`,
    `- Malformed eventJson rows: ${report.observability.malformedEventJsonCount}`,
    "",
    "## Warnings",
    "",
    ...(report.observability.warnings.length > 0
      ? report.observability.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
  ].join("\n");
}

export function evalReportPaths(args: {
  suiteName: string;
  timestamp: Date;
  outputDir?: string;
}) {
  const outputDir = args.outputDir ?? resolve(process.cwd(), "evals", "reports");
  const stamp = formatTimestamp(args.timestamp);

  return {
    markdown: resolve(outputDir, `eval-${args.suiteName}-${stamp}.md`),
    json: resolve(outputDir, `eval-${args.suiteName}-${stamp}.json`),
  };
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
