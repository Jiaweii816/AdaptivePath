import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../src/lib/env";
import { createChatClient } from "../src/server/llm/client";
import { getChatModel } from "../src/server/llm/models";
import { buildChatTurnPlan } from "../src/server/agents/coach-agent/chat-intent-policy";
import { deriveToolEligibility } from "../src/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import {
  buildClassifierBackendFacts,
  buildClassifierContext,
} from "../src/server/agents/coach-agent/turn-classifier/chat-turn-classifier-context";
import { createOpenAiTurnClassifier } from "../src/server/agents/coach-agent/turn-classifier/openai-turn-classifier";
import { resolveTurnUnderstanding } from "../src/server/agents/coach-agent/turn-classifier/resolve-turn-understanding";
import type { TurnClassifier } from "../src/server/agents/coach-agent/turn-classifier/turn-classifier.types";
import { parseTurnUnderstanding } from "../src/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { compileTurnUnderstandingV2 } from "../src/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveToolEligibilityV2 } from "../src/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";
import type { TurnRequest } from "../src/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import type { ConversationProjection } from "../src/server/agents/coach-agent/history-projection";
import { resolveRequestedActions } from "../src/server/tools/chat-tools/requested-actions";
import {
  loadTrajectoryDataset,
  type TrajectoryDatasetCase,
} from "../evals/runner/trajectory-dataset";
import {
  buildClassifierEvalArm,
  buildClassifierEvalReport,
  isClassifierEvalCaseInScope,
  type ClassifierEvalSample,
  type ProviderUsageDelta,
} from "./turn-classifier-eval-metrics";
import { renderClassifierEvalReport } from "./turn-classifier-eval-report";

const EMPTY_PROJECTION: ConversationProjection = {
  messages: [],
  decisions: [],
};
const LIMITATIONS = [
  "The trajectory-v2 dataset has no real revision-safe conversation history; classifier projection is empty.",
  "The dataset has no candidate registry. Candidate availability uses only a conservative deterministic same-input anchor and never expected-tool ground truth.",
  "This eval performs no database reads/writes and does not execute tools; it measures validated operation and capability plans.",
  "Durable grants come only from resolveRequestedActions on the current message.",
  "Active unsupported-language rows remain visible but are excluded from the shared in-scope accuracy denominator.",
];
const TAXONOMY_ACCEPTANCE_FLAG = "--taxonomy-acceptance";

const TAXONOMY_ACCEPTANCE_CASES = [
  {
    caseId: "design-section-6-transfer",
    message:
      "结合我之前做过的 DP 买股票题，看看当前题和之前几题有何不同，我该如何用共同内核做这题",
    expectedRequests: [
      {
        kind: "respond",
        deliverable: "understand",
        target: "concept",
        basis: ["past_problems"],
        delivery: { depth: "normal", form: "prose" },
        dependsOn: [],
      },
      {
        kind: "respond",
        deliverable: "solve",
        target: "current",
        basis: ["current_evidence", "past_problems"],
        delivery: { depth: "hint", form: "prose" },
        dependsOn: ["req0"],
      },
    ],
    expectedTools: ["past_problem_recall", "get_algorithm_hint"],
  },
  {
    caseId: "design-section-8-query-7",
    message: "再给更进一步提示…dp[i] 啥含义",
    expectedRequests: [
      {
        kind: "respond",
        deliverable: "solve",
        target: "current",
        basis: ["current_evidence"],
        delivery: { depth: "hint", form: "prose" },
        dependsOn: [],
      },
      {
        kind: "respond",
        deliverable: "understand",
        target: "concept",
        basis: ["current_evidence"],
        delivery: { depth: "hint", form: "prose" },
        dependsOn: ["req0"],
      },
    ],
    expectedTools: ["get_algorithm_hint"],
  },
] as const;

export function runTaxonomyAcceptance() {
  const cases = TAXONOMY_ACCEPTANCE_CASES.map((item) => {
    const understanding = compileTurnUnderstandingV2(item.message, {
      workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
    });
    const requests = understanding.requests.map(projectTaxonomyRequest);
    const tools = deriveToolEligibilityV2(understanding);
    const passed =
      JSON.stringify(requests) === JSON.stringify(item.expectedRequests) &&
      JSON.stringify(tools) === JSON.stringify(item.expectedTools);
    return { caseId: item.caseId, passed, requests, tools };
  });
  const failed = cases.filter(({ passed }) => !passed);
  if (failed.length > 0) {
    throw new Error(
      `V2 taxonomy acceptance failed: ${JSON.stringify(failed)}`,
    );
  }
  return { gate: "passed" as const, cases };
}

function projectTaxonomyRequest(request: TurnRequest) {
  return request.kind === "respond"
    ? {
        kind: request.kind,
        deliverable: request.deliverable,
        target: request.target,
        basis: request.basis,
        delivery: request.delivery,
        dependsOn: request.dependsOn,
      }
    : {
        kind: request.kind,
        dependsOn: request.dependsOn,
      };
}

export function assertClassifierEvalEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.RUN_CLASSIFIER_EVAL !== "1") {
    throw new Error(
      "Real classifier eval is opt-in; set RUN_CLASSIFIER_EVAL=1.",
    );
  }
}

export async function runRealClassifierEval() {
  assertClassifierEvalEnabled();
  loadLocalEnv();
  const model = getChatModel();
  const keyConfigured = Boolean(process.env.LLM_CHAT_API_KEY?.trim());
  console.log(JSON.stringify({ chatApiKeyConfigured: keyConfigured, model }));
  if (!keyConfigured) {
    throw new Error("LLM_CHAT_API_KEY is not configured for classifier eval.");
  }

  const dataset = loadTrajectoryDataset();
  const providerUsage = emptyUsage();
  const classifier = createOpenAiTurnClassifier({
    client: createChatClient(),
    model,
    traceWriter: async ({ usage }) => addProviderUsage(providerUsage, usage),
  });
  const baselineSamples = dataset.cases.map(buildBaselineSample);
  const classifierSamples: ClassifierEvalSample[] = [];
  for (const item of dataset.cases) {
    classifierSamples.push(await evaluateCase(item, classifier));
  }
  const report = buildClassifierEvalReport({
    datasetVersion: dataset.datasetVersion,
    model,
    baseline: buildClassifierEvalArm(dataset.cases, baselineSamples),
    classifier: buildClassifierEvalArm(dataset.cases, classifierSamples),
    providerUsage,
    limitations: LIMITATIONS,
  });
  const outputPath = writeReport(report.generatedAt, renderClassifierEvalReport(report));
  return { report, outputPath };
}

function buildBaselineSample(item: TrajectoryDatasetCase): ClassifierEvalSample {
  const prepared = prepareCase(item);
  return {
    caseId: item.caseId,
    understanding: prepared.deterministic,
    capabilities: effectiveCapabilities(
      prepared.deterministic,
      prepared.grantedTools,
    ),
    classifierCalled: false,
    provenance:
      prepared.deterministic.route === "fast_path"
        ? "deterministic_fast"
        : "deterministic_unconfigured",
    latencyMs: 0,
    inScope: prepared.inScope,
  };
}

async function evaluateCase(
  item: TrajectoryDatasetCase,
  classifier: TurnClassifier,
): Promise<ClassifierEvalSample> {
  const prepared = prepareCase(item);
  let classifierCalled = false;
  const countingClassifier: TurnClassifier = {
    classify: async (context) => {
      classifierCalled = true;
      return classifier.classify(context);
    },
  };
  const startedAt = Date.now();
  const resolved = await resolveTurnUnderstanding({
    deterministic: prepared.deterministic,
    classifierFactory: () => countingClassifier,
    loadClassifierContext: () => prepared.context,
    facts: prepared.facts,
  });
  return {
    caseId: item.caseId,
    understanding: resolved.understanding,
    capabilities: effectiveCapabilities(
      resolved.understanding,
      prepared.grantedTools,
    ),
    classifierCalled,
    provenance: resolved.provenance,
    fallbackReason: resolved.fallbackReason,
    latencyMs: classifierCalled ? Date.now() - startedAt : 0,
    inScope: prepared.inScope,
  };
}

function prepareCase(item: TrajectoryDatasetCase) {
  const legacy = buildChatTurnPlan(item.userMessage);
  const requestedActions = resolveRequestedActions(item.userMessage);
  const deterministic = parseTurnUnderstanding(
    item.userMessage,
    legacy,
    requestedActions,
  );
  const deterministicCandidate = deterministic.operations.some(
    ({ family, target, resolution }) =>
      family === "execute" &&
      target === "assistant_candidate" &&
      resolution === "explicit",
  );
  const baseContext = buildClassifierContext({
    message: item.userMessage,
    projection: EMPTY_PROJECTION,
    language: item.language,
    code: item.code,
    selectedTestCount: item.selectedTests.length,
  });
  const context = {
    ...baseContext,
    workspace: {
      ...baseContext.workspace,
      hasAssistantCandidate: deterministicCandidate,
    },
  };
  const facts = buildClassifierBackendFacts({
    message: item.userMessage,
    workspace: context.workspace,
    requestedActions,
  });
  const grantedTools = requestedActions
    .filter(({ decision }) => decision === "granted")
    .map(({ toolName }) => toolName);
  return {
    deterministic,
    context,
    facts,
    grantedTools,
    inScope: isClassifierEvalCaseInScope(item, deterministic),
  };
}

function effectiveCapabilities(
  understanding: Parameters<typeof deriveToolEligibility>[0],
  grantedTools: ReturnType<typeof prepareCase>["grantedTools"],
) {
  return [...new Set([...deriveToolEligibility(understanding), ...grantedTools])];
}

function emptyUsage(): ProviderUsageDelta {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addProviderUsage(target: ProviderUsageDelta, usage: unknown): void {
  const value = record(usage);
  target.inputTokens += token(value, "prompt_tokens", "input_tokens");
  target.outputTokens += token(value, "completion_tokens", "output_tokens");
  target.totalTokens += token(value, "total_tokens");
  target.cachedTokens = (target.cachedTokens ?? 0) + token(value, "cached_tokens");
  target.reasoningTokens =
    (target.reasoningTokens ?? 0) + token(value, "reasoning_tokens");
}

function token(
  value: Record<string, unknown>,
  primary: string,
  fallback?: string,
): number {
  const candidate = value[primary] ?? (fallback ? value[fallback] : undefined);
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function writeReport(generatedAt: string, markdown: string): string {
  const timestamp = generatedAt.replaceAll(/[:.]/gu, "-");
  const outputPath = path.resolve(
    `evals/reports/classifier-eval-${timestamp}.md`,
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  try {
    if (process.argv.includes(TAXONOMY_ACCEPTANCE_FLAG)) {
      console.log(JSON.stringify(runTaxonomyAcceptance(), null, 2));
      return;
    }
    const { report, outputPath } = await runRealClassifierEval();
    console.log(`Wrote ${outputPath}`);
    if (!report.gate.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void main();
}
