import type { TrajectoryDatasetCase } from "../evals/runner/trajectory-dataset";
import { buildCoachChatSystemPrompt } from "../src/server/agents/coach-agent/build-chat-prompt";
import { buildChatTurnPlan } from "../src/server/agents/coach-agent/chat-intent-policy";
import type { CoachChatInput } from "../src/server/agents/coach-agent/coach-agent.types";
import { renderResponsePlanInstructions } from "../src/server/agents/coach-agent/response-policy/render-instructions";
import { buildResponsePlan } from "../src/server/agents/coach-agent/response-policy/response-plan";
import { parseTurnUnderstanding } from "../src/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { resolveRequestedActions } from "../src/server/tools/chat-tools/requested-actions";

export type RenderedDeliveryRow = {
  caseId: string;
  scopeDisposition: "in_scope" | "unsupported_language";
  expectedHint: boolean;
  renderedHint: boolean;
  matches: boolean;
};

export type DisclosureComplianceRow = {
  fixtureId: string;
  message: string;
  expectedDisclosure: "full_code" | "guided";
  hasExpectedContract: boolean;
  hasUnexpectedContract: boolean;
  hasFullCodeTag: boolean;
  hasHintTag: boolean;
  passed: boolean;
};

export type ResponsePolicyCompliance = {
  deliveryRows: RenderedDeliveryRow[];
  disclosureRows: DisclosureComplianceRow[];
  aggregate: {
    inScopeCases: number;
    deliveryMatches: number;
    deliveryMismatches: number;
    deliveryAccuracy: number;
    disclosureFixtures: number;
    disclosurePassed: number;
    contradictionFullWinsHint: boolean;
  };
};

const DISCLOSURE_FIXTURES = [
  ["full-python", "Give me the full Python code", "full_code", true, false],
  ["guided-hint", "Give me a hint", "guided", false, true],
  ["explicit-deny", "Don't give me the full code, just a hint", "guided", false, true],
  ["full-wins-hint", "不要只给提示，直接给完整代码", "full_code", true, false],
  ["java-hard-negative", "Give me the full Java code", "guided", false, false],
] as const;

function inputFor(message: string): CoachChatInput {
  return {
    problem: {
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      tags: ["Array", "Hash Table"],
      methodName: "twoSum",
    },
    user: {
      displayName: "Policy Compliance",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: {
      profileId: "policy-compliance",
      teachableMemories: [],
      outputPreferences: [],
      domainReferences: [],
      retrievalStatus: "full",
    },
    messages: [{ role: "user", content: message }],
    responseLanguage: "en",
  };
}

function isUnsupportedLanguage(
  item: TrajectoryDatasetCase,
  languageMention: string | undefined,
): boolean {
  if (item.category === "preference_requires_note_memory") return false;
  return Boolean(languageMention ?? (item.language !== "Python"));
}

function buildDeliveryRow(item: TrajectoryDatasetCase): RenderedDeliveryRow {
  const legacy = buildChatTurnPlan(item.userMessage);
  const actions = resolveRequestedActions(item.userMessage);
  const understanding = parseTurnUnderstanding(item.userMessage, legacy, actions);
  const input = inputFor(item.userMessage);
  const policy = renderResponsePlanInstructions(
    buildResponsePlan(understanding, input),
    input,
  ).join("\n");
  const expectedHint = item.expectedTools.includes("get_algorithm_hint");
  const renderedHint = policy.includes("[HINT]");
  return {
    caseId: item.caseId,
    scopeDisposition: isUnsupportedLanguage(
      item,
      understanding.unsupportedScope.languageMention,
    )
      ? "unsupported_language"
      : "in_scope",
    expectedHint,
    renderedHint,
    matches: expectedHint === renderedHint,
  };
}

function buildDisclosureRow(
  fixture: (typeof DISCLOSURE_FIXTURES)[number],
): DisclosureComplianceRow {
  const [fixtureId, message, expectedDisclosure, expectedFull, expectedHint] = fixture;
  const prompt = buildCoachChatSystemPrompt(inputFor(message));
  const hasFullCodeTag = prompt.includes("[FULL CODE]");
  const hasHintTag = prompt.includes("[HINT]");
  const hasExpectedContract = prompt.includes(
    `[CODE DISCLOSURE — ${expectedDisclosure}]`,
  );
  const unexpectedDisclosure =
    expectedDisclosure === "full_code" ? "guided" : "full_code";
  const hasUnexpectedContract = prompt.includes(
    `[CODE DISCLOSURE — ${unexpectedDisclosure}]`,
  );
  return {
    fixtureId,
    message,
    expectedDisclosure,
    hasExpectedContract,
    hasUnexpectedContract,
    hasFullCodeTag,
    hasHintTag,
    passed:
      hasExpectedContract &&
      !hasUnexpectedContract &&
      hasFullCodeTag === expectedFull &&
      hasHintTag === expectedHint,
  };
}

export function buildResponsePolicyCompliance(
  cases: readonly TrajectoryDatasetCase[],
): ResponsePolicyCompliance {
  const deliveryRows = cases.map(buildDeliveryRow);
  const inScope = deliveryRows.filter(
    (row) => row.scopeDisposition === "in_scope",
  );
  const deliveryMatches = inScope.filter((row) => row.matches).length;
  const disclosureRows = DISCLOSURE_FIXTURES.map(buildDisclosureRow);
  const disclosurePassed = disclosureRows.filter((row) => row.passed).length;
  const contradiction = disclosureRows.find(
    (row) => row.fixtureId === "full-wins-hint",
  );
  return {
    deliveryRows,
    disclosureRows,
    aggregate: {
      inScopeCases: inScope.length,
      deliveryMatches,
      deliveryMismatches: inScope.length - deliveryMatches,
      deliveryAccuracy: inScope.length === 0 ? 1 : deliveryMatches / inScope.length,
      disclosureFixtures: disclosureRows.length,
      disclosurePassed,
      contradictionFullWinsHint: Boolean(
        contradiction?.passed &&
          contradiction.hasFullCodeTag &&
          !contradiction.hasHintTag,
      ),
    },
  };
}

export function renderResponsePolicyCompliance(
  compliance: ResponsePolicyCompliance,
): string[] {
  const { aggregate } = compliance;
  const accuracy = `${(aggregate.deliveryAccuracy * 100).toFixed(1)}%`;
  return [
    `- P2 rendered policy delivery: ${aggregate.deliveryMismatches} mismatch; accuracy ${accuracy} (${aggregate.deliveryMatches}/${aggregate.inScopeCases} in scope).`,
    `- P2 rendered policy disclosure: ${aggregate.disclosurePassed}/${aggregate.disclosureFixtures} fixtures passed; full-wins-hint ${aggregate.contradictionFullWinsHint ? "yes" : "no"}.`,
  ];
}
