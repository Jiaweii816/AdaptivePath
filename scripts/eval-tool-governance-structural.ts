import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { planChatCapabilities } from "@/server/agents/coach-agent/capability-planner";
import { discoverChatCapability } from "@/server/agents/coach-agent/capability-discovery";
import type { ConversationProjection } from "@/server/agents/coach-agent/history-projection";
import {
  completeAssemblerPrompt,
  resolveChatTurnUnderstandingV2,
} from "@/server/agents/coach-agent/turn-classifier/resolve-chat-turn-understanding-v2";
import { buildTurnCapabilityPolicy } from "@/server/agents/coach-agent/turn-capability-policy";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import type { TurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/turn-understanding-v2.types";
import { loadLocalEnv } from "@/lib/env";
import { createMemoryClient } from "@/server/llm/client";
import { getChatAssemblerModel } from "@/server/llm/models";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";
import {
  buildChatToolManifest,
  chatToolNameSchema,
  type ChatToolName,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import { getChatToolByCapabilityId } from "@/server/tools/chat-tools/chat-tool-registry";

type ToolGroup = { label: string; anyOf: string[] };
type DiscoveryExpectation = {
  expectedNeed?: string;
  expectedCapabilityId?: string;
};
type DatasetCase = {
  caseId?: string;
  sourceCaseId?: string;
  userMessage: string;
  requiredFinalToolGroups: ToolGroup[];
  forbiddenTools: string[];
  fixtureRequirements?: unknown;
  discoveryExpectation?: DiscoveryExpectation;
};
type Dataset = { cases: DatasetCase[] };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetPaths = [
  "evals/datasets/tool-governance/coverage-safety-v1.json",
] as const;
const knownTools = new Set<string>(chatToolNameSchema.options);
const LIVE_SEMANTIC_FLAG = "--live-semantic";
const liveSemantic = process.argv.includes(LIVE_SEMANTIC_FLAG);
const EMPTY_PROJECTION: ConversationProjection = { messages: [], decisions: [] };

function loadDataset(relativePath: string): Dataset {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8")) as Dataset;
}

function hasCurrentCode(value: unknown) {
  const text = JSON.stringify(value).toLowerCase();
  return text.includes("current python code") ||
    (text.includes("current code") && !text.includes("no current editor code"));
}

function toolSet(names: readonly string[]) {
  return new Set(
    names.filter((name): name is ChatToolName => knownTools.has(name)),
  );
}

function schemaChars(tools: ReadonlySet<ChatToolName>) {
  return JSON.stringify(buildChatToolManifest(tools)).length;
}

function groupsSatisfied(groups: ToolGroup[], tools: ReadonlySet<ChatToolName>) {
  return groups.filter((group) => group.anyOf.some((tool) => tools.has(tool as ChatToolName))).length;
}

function forbiddenExposureCount(caseItem: DatasetCase, tools: ReadonlySet<ChatToolName>) {
  return caseItem.forbiddenTools.filter((tool) => tools.has(tool as ChatToolName)).length;
}

type SemanticResolutionSummary = {
  eligible: boolean;
  provenance: "deterministic_nonsemantic" | "llm_validated" | "semantic_fallback";
  classifierActuallyCalled: boolean;
  fallbackReason?: string;
  latencyMs: number;
};

type EvaluationRow = {
  id: string;
  requiredGroups: ToolGroup[];
  legacy: Set<ChatToolName>;
  afterInitial: Set<ChatToolName>;
  afterFinal: Set<ChatToolName>;
  discoveryStatus: string | null;
  discoveryMatchedExpectedCapability: boolean;
  legacySchemaChars: number;
  afterInitialSchemaChars: number;
  legacyForbiddenExposure: number;
  afterForbiddenExposure: number;
  semantic: SemanticResolutionSummary;
};

async function resolveUnderstanding(
  caseItem: DatasetCase,
  workspace: { hasCurrentCode: boolean; hasAssistantCandidate: boolean },
): Promise<{ understanding: TurnUnderstandingV2; semantic: SemanticResolutionSummary }> {
  const requestedActions = resolveRequestedActions(caseItem.userMessage);
  const deterministic = compileTurnUnderstandingV2(caseItem.userMessage, {
    workspace,
    requestedActions,
  });
  if (!liveSemantic || deterministic.route.kind !== "model_assembled") {
    return {
      understanding: deterministic,
      semantic: {
        eligible: deterministic.route.kind === "model_assembled",
        provenance: "deterministic_nonsemantic",
        classifierActuallyCalled: false,
        latencyMs: 0,
      },
    };
  }

  const startedAt = Date.now();
  const resolution = await resolveChatTurnUnderstandingV2({
    input: {
      message: caseItem.userMessage,
      code: workspace.hasCurrentCode ? "def _evaluation_placeholder():\n    pass\n" : undefined,
      language: "Python",
    },
    deps: { modelAssembler: liveModelAssembler() },
    selectedTestCases: [],
    traceContext: undefined,
  } as never, {
    deterministic,
    requestedActions,
    historyProjection: workspace.hasAssistantCandidate
      ? assistantCandidateProjection()
      : EMPTY_PROJECTION,
  });
  return {
    understanding: resolution.understanding,
    semantic: {
      eligible: true,
      provenance: resolution.provenance,
      classifierActuallyCalled: resolution.classifierActuallyCalled,
      fallbackReason: resolution.fallbackReason,
      latencyMs: Date.now() - startedAt,
    },
  };
}

let assemblerClient: ReturnType<typeof createMemoryClient> | undefined;

function liveModelAssembler() {
  if (!assemblerClient) assemblerClient = createMemoryClient();
  const client = assemblerClient;
  const model = getChatAssemblerModel();
  return { complete: (prompt: string) => completeAssemblerPrompt(client, model, prompt) };
}

function assistantCandidateProjection(): ConversationProjection {
  return {
    messages: [{
      role: "assistant",
      content: "```python\nclass Solution:\n    def solve(self):\n        pass\n```",
    }],
    decisions: [],
  };
}

function assertLiveSemanticEnabled() {
  if (!liveSemantic) return;
  loadLocalEnv();
  if (process.env.RUN_TOOL_GOVERNANCE_LIVE_EVAL !== "1") {
    throw new Error(
      "Live semantic eval is opt-in; set RUN_TOOL_GOVERNANCE_LIVE_EVAL=1 and pass --live-semantic.",
    );
  }
  if (process.env.CHAT_MODEL_ASSEMBLER?.trim() === "0") {
    throw new Error("CHAT_MODEL_ASSEMBLER=0 disables the path this eval measures.");
  }
  if (!process.env.LLM_MEMORY_API_KEY?.trim()) {
    throw new Error("LLM_MEMORY_API_KEY is not configured for live semantic eval.");
  }
}

async function main() {
  assertLiveSemanticEnabled();
  const cases = datasetPaths.flatMap((datasetPath) => loadDataset(datasetPath).cases);
  const rows: EvaluationRow[] = [];
  for (const caseItem of cases) {
  const workspace = {
    hasCurrentCode: hasCurrentCode(caseItem.fixtureRequirements),
    hasAssistantCandidate: /assistant candidate|candidate code/i.test(
      JSON.stringify(caseItem.fixtureRequirements),
    ),
  };
  const requestedActions = resolveRequestedActions(caseItem.userMessage);
  const { understanding, semantic } = await resolveUnderstanding(caseItem, workspace);
  const policy = buildTurnCapabilityPolicy({
    understanding,
    requestedActions,
    message: caseItem.userMessage,
    resources: {
      userId: "eval-user",
      problemId: "eval-problem",
      chatSessionId: "eval-session",
      memoryOrigin: "evaluation",
    },
  });
  const planner = planChatCapabilities({
    understanding,
    policy,
    message: caseItem.userMessage,
    hasCurrentProblem: true,
    hasProblemTags: true,
    hasApiTopic: /(?:api|syntax|语法|deque|library)/iu.test(caseItem.userMessage),
  });
  const legacy = toolSet(buildChatTurnPlan(caseItem.userMessage).toolCapabilities);
  const afterInitial = new Set(planner.initialLoadedTools);
  const afterFinal = new Set(afterInitial);
  let discoveryStatus: string | null = null;
  let discoveryMatchedExpectedCapability = false;

  if (caseItem.discoveryExpectation?.expectedNeed) {
    const discovery = discoverChatCapability({
      need: caseItem.discoveryExpectation.expectedNeed,
      policy,
    });
    discoveryStatus = discovery.status;
    discoveryMatchedExpectedCapability = Boolean(
      caseItem.discoveryExpectation.expectedCapabilityId &&
        discovery.matchedCapabilities.some(
          (item) =>
            item.capabilityId ===
            caseItem.discoveryExpectation?.expectedCapabilityId,
        ),
    );
    if (discovery.status === "loaded") {
      for (const item of discovery.matchedCapabilities) {
        const tool = getChatToolByCapabilityId(item.capabilityId)?.name;
        if (tool) afterFinal.add(tool);
      }
    }
  }

    rows.push({
      id: caseItem.caseId ?? caseItem.sourceCaseId ?? "unknown",
      requiredGroups: caseItem.requiredFinalToolGroups,
      legacy,
      afterInitial,
      afterFinal,
      discoveryStatus,
      discoveryMatchedExpectedCapability,
      legacySchemaChars: schemaChars(legacy),
      afterInitialSchemaChars: schemaChars(afterInitial),
      legacyForbiddenExposure: forbiddenExposureCount(caseItem, legacy),
      afterForbiddenExposure: forbiddenExposureCount(caseItem, afterInitial),
      semantic,
    });
  }

const actionable = rows.filter((row) => row.requiredGroups.length > 0);
const discoveryRows = rows.filter((row) => row.discoveryStatus !== null);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? null : Number((numerator / denominator).toFixed(4));

const report = {
  reportType: liveSemantic
    ? "live_semantic_tool_governance_before_after"
    : "structural_tool_governance_before_after",
  limitations: [
    liveSemantic
      ? "The after arm invokes the production semantic assembler only when deterministic coverage is unknown or effect resolution is ambiguous. It does not run the foreground Coach function-calling loop or tool handlers."
      : "This is a zero-token structural ablation, not a real-LLM trajectory score.",
    "Before uses the retained legacy positive-intent hard gate (buildChatTurnPlan); after uses the current deterministic V2 understanding, Planner, Policy, and deterministic Discovery resolver.",
    "No handler, runner, web provider, or SQLite database is invoked. Labeled-forbidden schema exposure is diagnostic only, not an unauthorized-execution or safety-violation rate.",
    "All source labels remain draft_needs_human_review.",
  ],
  dataset: { caseCount: rows.length, actionableCaseCount: actionable.length, discoveryControlCaseCount: discoveryRows.length },
  beforeHardGate: {
    neededToolRecallAtInitial: rate(sum(actionable.map((row) => groupsSatisfied(row.requiredGroups, row.legacy))), sum(actionable.map((row) => row.requiredGroups.length))),
    averageSchemaCharsPerInitialRound: Number((sum(rows.map((row) => row.legacySchemaChars)) / rows.length).toFixed(1)),
    labeledForbiddenSchemaExposureCount: sum(rows.map((row) => row.legacyForbiddenExposure)),
  },
  afterGovernance: {
    neededToolRecallAtInitial: rate(sum(actionable.map((row) => groupsSatisfied(row.requiredGroups, row.afterInitial))), sum(actionable.map((row) => row.requiredGroups.length))),
    neededToolRecallAfterDeterministicDiscovery: rate(sum(actionable.map((row) => groupsSatisfied(row.requiredGroups, row.afterFinal))), sum(actionable.map((row) => row.requiredGroups.length))),
    averageSchemaCharsPerInitialRound: Number((sum(rows.map((row) => row.afterInitialSchemaChars)) / rows.length).toFixed(1)),
    labeledForbiddenSchemaExposureCount: sum(rows.map((row) => row.afterForbiddenExposure)),
  },
  discovery: {
    attempted: discoveryRows.length,
    loaded: discoveryRows.filter((row) => row.discoveryStatus === "loaded").length,
    policyDenied: discoveryRows.filter((row) => row.discoveryStatus === "policy_denied").length,
    requiresExplicitGrant: discoveryRows.filter((row) => row.discoveryStatus === "requires_explicit_user_grant").length,
    noMatch: discoveryRows.filter((row) => row.discoveryStatus === "no_match").length,
    matchedExpectedCapability: discoveryRows.filter(
      (row) => row.discoveryMatchedExpectedCapability,
    ).length,
  },
  semanticAssembler: {
    mode: liveSemantic ? "live_qwen" : "not_called_structural_preflight",
    eligible: rows.filter((row) => row.semantic.eligible).length,
    calls: rows.filter((row) => row.semantic.classifierActuallyCalled).length,
    llmValidated: rows.filter((row) => row.semantic.provenance === "llm_validated").length,
    fallback: rows.filter((row) => row.semantic.provenance === "semantic_fallback").length,
    averageLatencyMs: liveSemantic
      ? Number((sum(rows.map((row) => row.semantic.latencyMs)) / Math.max(1, rows.filter((row) => row.semantic.classifierActuallyCalled).length)).toFixed(1))
      : 0,
  },
  perCase: rows.map((row) => ({
    id: row.id,
    requiredToolGroups: row.requiredGroups,
    beforeLoadedTools: [...row.legacy],
    afterInitialLoadedTools: [...row.afterInitial],
    afterDiscoveryLoadedTools: [...row.afterFinal],
    discoveryStatus: row.discoveryStatus,
    discoveryMatchedExpectedCapability: row.discoveryMatchedExpectedCapability,
    semantic: row.semantic,
  })),
};

console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
