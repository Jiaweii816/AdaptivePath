import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadTrajectoryDataset,
  type TrajectoryDatasetCase,
} from "../evals/runner/trajectory-dataset";
import { buildChatTurnPlan } from "../src/server/agents/coach-agent/chat-intent-policy";
import type { CoachChatIntent } from "../src/server/agents/coach-agent/coach-agent.types";
import { parseTurnUnderstanding } from "../src/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import type { Operation } from "../src/server/agents/coach-agent/turn-understanding/turn-understanding.types";
import type { ChatToolName } from "../src/server/tools/chat-tools/chat-tool-contracts";
import { resolveRequestedActions } from "../src/server/tools/chat-tools/requested-actions";
import {
  buildResponsePolicyCompliance,
  renderResponsePolicyCompliance,
  type ResponsePolicyCompliance,
} from "./response-policy-compliance";
export type OperationSignature = `${Operation["family"]}:${Operation["target"]}`;
export type SideEffectFlags = {
  executeFalsePositive: boolean;
  persistFalsePositive: boolean;
};
export type ShadowDiffRow = {
  caseId: string;
  category: TrajectoryDatasetCase["category"];
  message: string;
  scopeDisposition: "in_scope" | "unsupported_language";
  scopeEvidence?: string;
  expectedOperations: OperationSignature[];
  shadowOperations: OperationSignature[];
  missingOperations: OperationSignature[];
  unexpectedOperations: OperationSignature[];
  exact: boolean;
  precision: number;
  recall: number;
  f1: number;
  orderedMatch: boolean;
  route: "fast_path" | "llm";
  legacyPrimaryIntent: CoachChatIntent;
  legacyFamily: Operation["family"];
  expectedDeliveryMode: "direct" | "hint";
  actualDeliveryMode: "direct" | "hint";
  requiredCapabilityMissing: ChatToolName[];
  forbiddenCapabilityOpened: ChatToolName[];
} & SideEffectFlags;
export type ShadowDiffReport = {
  rows: ShadowDiffRow[];
  responsePolicyCompliance: ResponsePolicyCompliance;
  aggregate: {
    inScopeCases: number;
    exactCases: number;
    exactRate: number;
    precision: number;
    recall: number;
    f1: number;
    requiredCapabilities: number;
    missingCapabilities: number;
    forbiddenCapabilitiesOpened: number;
    executeFalsePositives: number;
    persistFalsePositives: number;
    deliveryMismatches: number;
    deliveryAccuracy: number;
    unsupportedCases: number;
  };
};
const TOOL_OPERATION: Partial<Record<ChatToolName, OperationSignature>> = {
  run_current_code: "execute:current_user_code",
  verify_proposed_repair: "execute:assistant_candidate",
  past_problem_recall: "recall:past_problem",
  past_mistake_recall: "recall:past_mistake",
  find_practice_problem: "recommend:practice_problem",
  get_algorithm_hint: "answer:active_problem",
  lookup_api_reference: "lookup_api:api_object",
  note_memory: "persist:preference",
  save_knowledge_note: "persist:knowledge_handbook",
  save_mistake_book_entry: "persist:mistake_book",
};
const REQUIRED_OPERATION_SIDECAR: Readonly<Record<string, OperationSignature[]>> = {
  "traj-v2-natural-multi-debug-run-then-history": [
    "diagnose:current_user_code",
  ],
};
const P0_FIXTURES = [
  ["explain again", "Can you explain that again?", ["answer:concept"]],
  ["full code again", "Show me the full code again", ["answer:active_problem"]],
  ["bug still", "Why is this bug still happening?", ["diagnose:current_user_code"]],
  ["optimize current", "Can you optimize my current code?", ["optimize:current_user_code"]],
  ["full Python", "Give me the full Python code", ["answer:active_problem"]],
  ["run again", "Run it again...", ["execute:current_user_code"]],
] as const;
function signature(operation: Pick<Operation, "family" | "target">): OperationSignature {
  return `${operation.family}:${operation.target}`;
}
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function expectedOperations(item: TrajectoryDatasetCase): OperationSignature[] {
  const toolOperations = item.expectedTools.flatMap((tool) => {
    const operation = TOOL_OPERATION[tool];
    return operation ? [operation] : [];
  });
  const concept = item.category === "concept_question_no_tool"
    ? (["answer:concept"] as OperationSignature[])
    : [];
  return unique([
    ...toolOperations,
    ...concept,
    ...(REQUIRED_OPERATION_SIDECAR[item.caseId] ?? []),
  ]);
}
function legacyFamily(intent: CoachChatIntent): Operation["family"] {
  if (intent.includes("recall")) return "recall";
  if (intent.includes("run_case")) return "execute";
  if (intent.includes("debug") || intent === "execute_failed_ask") return "diagnose";
  if (intent.includes("optimization")) return "optimize";
  if (intent.includes("practice")) return "recommend";
  if (intent.includes("profile")) return "profile_meta";
  if (intent.includes("api_reference")) return "lookup_api";
  if (intent.includes("save")) return "persist";
  return "answer";
}
function scoreSets(required: OperationSignature[], actual: OperationSignature[], optional: OperationSignature[]) {
  const requiredSet = new Set(required);
  const optionalSet = new Set(optional);
  const missing = required.filter((item) => !actual.includes(item));
  const unexpected = actual.filter(
    (item) => !requiredSet.has(item) && !optionalSet.has(item),
  );
  const truePositive = required.length - missing.length;
  const precision = ratio(truePositive, truePositive + unexpected.length);
  const recall = ratio(truePositive, required.length);
  return { missing, unexpected, precision, recall, f1: f1(precision, recall) };
}
function orderedMatches(item: TrajectoryDatasetCase, actual: OperationSignature[]): boolean {
  let cursor = 0;
  for (const step of item.orderedSubsequence) {
    const tools = typeof step === "string" ? [step] : step.anyOf;
    const choices = tools.flatMap((tool) => TOOL_OPERATION[tool] ?? []);
    const index = actual.findIndex((value, at) => at >= cursor && choices.includes(value));
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}
export function detectSideEffectFalsePositives(
  operations: readonly Operation[],
  forbiddenTools: readonly ChatToolName[],
): SideEffectFlags {
  const opened = new Set(
    operations.filter((operation) => operation.resolution === "explicit").map(signature),
  );
  const forbidden = new Set(forbiddenTools);
  const executeFalsePositive =
    (opened.has("execute:current_user_code") && forbidden.has("run_current_code")) ||
    (opened.has("execute:assistant_candidate") && forbidden.has("verify_proposed_repair"));
  const persistFalsePositive =
    (opened.has("persist:preference") && forbidden.has("note_memory")) ||
    (opened.has("persist:knowledge_handbook") && forbidden.has("save_knowledge_note")) ||
    (opened.has("persist:mistake_book") && forbidden.has("save_mistake_book_entry"));
  return { executeFalsePositive, persistFalsePositive };
}
function buildRow(item: TrajectoryDatasetCase): ShadowDiffRow {
  const legacy = buildChatTurnPlan(item.userMessage);
  const actions = resolveRequestedActions(item.userMessage);
  const understanding = parseTurnUnderstanding(item.userMessage, legacy, actions);
  const shadowOperations = unique(understanding.operations.map(signature));
  const expected = expectedOperations(item);
  const optional = unique(item.optionalTools.flatMap((tool) => TOOL_OPERATION[tool] ?? []));
  const scores = scoreSets(expected, shadowOperations, optional);
  const granted = actions.filter((action) => action.decision === "granted").map((action) => action.toolName);
  const effectiveCapabilities = new Set<ChatToolName>([
    ...legacy.toolCapabilities,
    ...granted,
  ]);
  const scopeEvidence = item.category === "preference_requires_note_memory"
    ? undefined
    : understanding.unsupportedScope.languageMention ??
      (item.language !== "Python" ? `${item.language} dataset context` : undefined);
  return {
    caseId: item.caseId,
    category: item.category,
    message: item.userMessage,
    scopeDisposition: scopeEvidence ? "unsupported_language" : "in_scope",
    ...(scopeEvidence ? { scopeEvidence } : {}),
    expectedOperations: expected,
    shadowOperations,
    missingOperations: scores.missing,
    unexpectedOperations: scores.unexpected,
    exact: scores.missing.length === 0 && scores.unexpected.length === 0,
    precision: scores.precision,
    recall: scores.recall,
    f1: scores.f1,
    orderedMatch: orderedMatches(item, shadowOperations),
    route: understanding.route,
    legacyPrimaryIntent: legacy.primaryIntent,
    legacyFamily: legacyFamily(legacy.primaryIntent),
    expectedDeliveryMode: item.expectedTools.includes("get_algorithm_hint") ? "hint" : "direct",
    actualDeliveryMode: understanding.modifiers.deliveryMode,
    requiredCapabilityMissing: item.expectedTools.filter((tool) => !effectiveCapabilities.has(tool)),
    forbiddenCapabilityOpened: item.forbiddenTools.filter((tool) => effectiveCapabilities.has(tool)),
    ...detectSideEffectFalsePositives(understanding.operations, item.forbiddenTools),
  };
}
export function buildShadowDiff(cases: readonly TrajectoryDatasetCase[]): ShadowDiffReport {
  const rows = cases.map(buildRow);
  const inScope = rows.filter((row) => row.scopeDisposition === "in_scope");
  const missing = inScope.reduce((sum, row) => sum + row.missingOperations.length, 0);
  const unexpected = inScope.reduce((sum, row) => sum + row.unexpectedOperations.length, 0);
  const expected = inScope.reduce((sum, row) => sum + row.expectedOperations.length, 0);
  const truePositive = expected - missing;
  const precision = ratio(truePositive, truePositive + unexpected);
  const recall = ratio(truePositive, expected);
  const deliveryMismatches = inScope.filter((row) => row.expectedDeliveryMode !== row.actualDeliveryMode).length;
  return { rows, responsePolicyCompliance: buildResponsePolicyCompliance(cases), aggregate: {
    inScopeCases: inScope.length,
    exactCases: inScope.filter((row) => row.exact).length,
    exactRate: ratio(inScope.filter((row) => row.exact).length, inScope.length),
    precision, recall, f1: f1(precision, recall),
    requiredCapabilities: inScope.reduce((sum, row) => sum + cases.find((item) => item.caseId === row.caseId)!.expectedTools.length, 0),
    missingCapabilities: inScope.reduce((sum, row) => sum + row.requiredCapabilityMissing.length, 0),
    forbiddenCapabilitiesOpened: inScope.reduce((sum, row) => sum + row.forbiddenCapabilityOpened.length, 0),
    executeFalsePositives: inScope.filter((row) => row.executeFalsePositive).length,
    persistFalsePositives: inScope.filter((row) => row.persistFalsePositive).length,
    deliveryMismatches,
    deliveryAccuracy: ratio(inScope.length - deliveryMismatches, inScope.length),
    unsupportedCases: rows.length - inScope.length,
  } };
}
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
function cells(values: readonly string[]): string {
  return values.length > 0 ? values.join("<br>") : "—";
}
export function renderShadowDiff(report: ShadowDiffReport): string {
  const { aggregate: a } = report;
  const lines = [
    "# Shadow Turn Understanding Diff",
    "",
    "> Deterministic P1 shadow measurement. Unsupported-language rows stay visible but are excluded from in-scope accuracy.",
    "",
    "## Aggregate",
    "",
    `- Cases: ${report.rows.length} total; ${a.inScopeCases} in scope; ${a.unsupportedCases} unsupported-language.`,
    `- In-scope operation exact: ${a.exactCases}/${a.inScopeCases} (${percent(a.exactRate)}); precision ${percent(a.precision)}, recall ${percent(a.recall)}, F1 ${percent(a.f1)}.`,
    `- Capabilities: ${a.requiredCapabilities - a.missingCapabilities}/${a.requiredCapabilities} required present; ${a.forbiddenCapabilitiesOpened} forbidden opened.`,
    `- Side-effect false positives: execute ${a.executeFalsePositives}; persist ${a.persistFalsePositives}.`,
    `- Delivery modifier: ${a.deliveryMismatches} mismatch; accuracy ${percent(a.deliveryAccuracy)}.`,
    ...renderResponsePolicyCompliance(report.responsePolicyCompliance),
    "",
    "## All trajectory-v2 cases",
    "",
    "| Status | Case | Scope | Expected operations | Shadow operations | Diff | Order | Route / legacy | Delivery | Capability safety |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of report.rows) {
    const modifierMismatch = row.expectedDeliveryMode !== row.actualDeliveryMode;
    const hasSafetyIssue = row.requiredCapabilityMissing.length > 0 || row.forbiddenCapabilityOpened.length > 0 || row.executeFalsePositive || row.persistFalsePositive;
    const status = !row.exact || !row.orderedMatch || modifierMismatch || hasSafetyIssue ? "❌" : row.scopeDisposition === "unsupported_language" ? "⚠️" : "✅";
    const diff = [`missing: ${cells(row.missingOperations)}`, `unexpected: ${cells(row.unexpectedOperations)}`].join("<br>");
    const safety = [
      `missing: ${cells(row.requiredCapabilityMissing)}`,
      `forbidden: ${cells(row.forbiddenCapabilityOpened)}`,
      `executeFP: ${row.executeFalsePositive ? "❌" : "no"}`,
      `persistFP: ${row.persistFalsePositive ? "❌" : "no"}`,
    ].join("<br>");
    lines.push(`| ${status} | ${row.caseId}<br>${row.message.replaceAll("|", "\\|")} | ${row.scopeDisposition === "unsupported_language" ? `⚠️ ${row.scopeEvidence}` : "in_scope"} | ${cells(row.expectedOperations)} | ${cells(row.shadowOperations)} | ${diff}<br>P/R/F1 ${percent(row.precision)}/${percent(row.recall)}/${percent(row.f1)} | ${row.orderedMatch ? "✅" : "❌"} | ${row.route}<br>${row.legacyPrimaryIntent} → ${row.legacyFamily} | ${row.expectedDeliveryMode} / ${row.actualDeliveryMode}${row.expectedDeliveryMode === row.actualDeliveryMode ? "" : " ❌"} | ${safety} |`);
  }
  lines.push("", "## P0 regression fixtures", "", "| Status | Fixture | Expected | Shadow | Route / legacy |", "|---|---|---|---|---|");
  for (const [label, message, expected] of P0_FIXTURES) {
    const understanding = parseTurnUnderstanding(message);
    const actual = unique(understanding.operations.map(signature));
    const ok = actual.length === expected.length && expected.every((value) => actual.includes(value as OperationSignature));
    lines.push(`| ${ok ? "✅" : "❌"} | ${label}<br>${message} | ${cells(expected)} | ${cells(actual)} | ${understanding.route} / ${understanding.legacyPrimaryIntent} |`);
  }
  return `${lines.join("\n")}\n`;
}
function main(): void {
  const report = buildShadowDiff(loadTrajectoryDataset().cases);
  const outputPath = path.resolve("evals/reports/shadow-understanding-diff.md");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderShadowDiff(report), "utf8");
  console.log(`Wrote ${outputPath}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
