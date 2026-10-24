import { buildCoachMemoryContext } from "@/server/memory";
import { ensureSessionPlan } from "@/server/memory/working/build-session-plan";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";
import {
  buildChatInteractionState,
  buildChatTurnPlan,
} from "./chat-intent-policy";
import {
  resolveAuthoritativeRunContext,
  resolveWorkingRunContext,
} from "./authoritative-run-context";
import {
  fingerprintCodeForExecution,
  hashSelectedTestSuite,
} from "@/server/code/code-hash";
import {
  resolveEvidenceAlignment,
  type CurrentEvidenceScope,
} from "./evidence-alignment";
import {
  loadCurrentHintLevel,
  loadLatestReviewProjection,
  loadStoredRecentMessages,
} from "./chat-context-loader";
import {
  hasSameRevisionAssistantCandidate,
  projectCurrentRevisionWindow,
  type ConversationProjection,
  type StoredChatMessageForProjection,
} from "./history-projection";
import { buildWorkspaceCodeRevision } from "./workspace-revision";
import {
  buildCurrentWorkspaceContext,
  buildWorkspaceMetadata,
} from "./current-workspace-context";
import {
  buildCoachUserContext,
  inferResponseLanguage,
} from "./review-pipeline";
import type { BootstrappedChatTurn } from "./chat-turn-bootstrap";
import { isPureDurableActionTurn } from "./chat-tool-plan";
import { buildContextPlan } from "./operation-plan/operation-context-plan";
import { deriveMemoryIntent } from "./operation-plan/operation-memory-intent";
import { deriveToolEligibility } from "./operation-plan/operation-tool-eligibility";
import { parseTurnUnderstanding } from "./turn-understanding/parse-turn-understanding";
import { captureShadowTurnUnderstandingBestEffort } from "./turn-understanding/shadow-trace";
import { resolveChatTurnUnderstandingV2 } from "./turn-classifier/resolve-chat-turn-understanding-v2";
import { resolveModelPersistConfirmation } from "./model-persist-confirmation";
import { compileTurnUnderstandingV2 } from "./turn-understanding-v2/compile-turn-understanding-v2";
import { buildContextPlanV2 } from "./turn-understanding-v2/context-plan-v2";
import { deriveMemoryIntentV2 } from "./turn-understanding-v2/memory-intent-v2";
import { deriveIntentMatchV2 } from "./turn-understanding-v2/intent-match-v2";
import { deriveToolEligibilityV2 } from "./turn-understanding-v2/tool-eligibility-v2";
import { captureTurnUnderstandingV2TraceBestEffort } from "./turn-understanding-v2/trace-v2";
import {
  consumesTurnUnderstandingV2,
  getTurnUnderstandingMode,
} from "./turn-understanding-v2/turn-understanding-mode";
import {
  AUTOMATIC_MEMORY_ASSEMBLY_DISABLED_RECEIPT,
  isLearningExperienceRecallPilotEnabled,
} from "@/server/memory/learning-experience-recall/pilot-mode";
import type { CoachMemoryBrief } from "@/server/memory/retrieval/candidate-core.types";
import {
  attachCampaignCoachingPolicy,
  deriveCampaignCoachingPolicy,
  projectCampaignMemoryAssembly,
  resolveCampaignCoachingTaskContext,
} from "@/server/campaign/coaching";

export async function loadChatTurnContext(turn: BootstrappedChatTurn) {
  const responseLanguage = inferResponseLanguage({
    explicit: turn.input.responseLanguage,
    userQuestion: turn.input.message,
    explanationStyle: turn.profile.explanationStyle,
    outputPreferences: turn.profile.outputPreferences,
  });
  const legacyPlan = buildChatTurnPlan(turn.input.message);
  const requestedActions = resolveRequestedActions(turn.input.message);
  const turnUnderstandingMode = getTurnUnderstandingMode();
  const currentRevision = buildWorkspaceCodeRevision({
    problemId: turn.problem.id,
    language: turn.input.language,
    code: turn.input.code,
  });
  const currentScope: CurrentEvidenceScope = {
    codeHash: currentRevision?.codeHash,
    executionFingerprint:
      turn.input.language && turn.input.code !== undefined
        ? fingerprintCodeForExecution({
            language: turn.input.language,
            code: turn.input.code,
          })
        : undefined,
    suiteFingerprint:
      turn.selectedTestCases.length > 0
        ? hashSelectedTestSuite(turn.selectedTestCases.map((test) => test.id))
        : undefined,
  };
  const storedMessages = await loadStoredRecentMessages(
    turn.chatSession.id,
    turn.chatSession.clearedBeforeSequence,
    turn.db,
  );
  const historyProjection = projectCurrentRevisionWindow({
    storedMessages,
    currentRevision,
    clearedBeforeSequence: turn.chatSession.clearedBeforeSequence,
    maxModelMessages: 8,
  });
  const pendingConfirmation = resolveModelPersistConfirmation(
    turn.input.message,
    storedMessages,
  );
  const compiledTurnUnderstandingV2 = compileTurnUnderstandingV2(
    turn.input.message,
    {
      requestedActions,
      workspace: {
        hasCurrentCode: (turn.input.code?.trim().length ?? 0) > 0,
        hasAssistantCandidate:
          hasSameRevisionAssistantCandidate(historyProjection),
      },
    },
  );
  const deterministic = parseTurnUnderstanding(
    turn.input.message,
    legacyPlan,
    requestedActions,
  );
  const consumeV2 = consumesTurnUnderstandingV2(turnUnderstandingMode);
  const semanticResolution = consumeV2
    ? await resolveChatTurnUnderstandingV2(turn, {
        deterministic: compiledTurnUnderstandingV2,
        requestedActions,
        historyProjection,
      })
    : undefined;
  const turnUnderstandingV2 =
    semanticResolution?.understanding ?? compiledTurnUnderstandingV2;
  const resolved = {
    understanding: deterministic,
    provenance:
      semanticResolution?.provenance === "llm_validated"
        ? ("llm_validated" as const)
        : semanticResolution?.provenance === "semantic_fallback"
          ? ("deterministic_fallback" as const)
          : compiledTurnUnderstandingV2.route.kind === "fast_path"
            ? ("deterministic_fast" as const)
            : ("deterministic_unconfigured" as const),
    classifierActuallyCalled:
      semanticResolution?.classifierActuallyCalled ?? false,
    fallbackReason: semanticResolution?.fallbackReason,
  };
  // Legacy understanding remains an independent rollback/telemetry sidecar.
  // The V2 consume path never projects its canonical requests back into it.
  const understanding = resolved.understanding;
  const campaignTaskContext = await resolveCampaignCoachingTaskContext(
    turn.db,
    {
      workspaceSessionId: turn.workspaceTraceTurn?.enabled
        ? turn.workspaceTraceTurn.workspaceSessionId
        : null,
      problemSlug: turn.problem.slug,
    },
  );
  const campaignPolicy = deriveCampaignCoachingPolicy({
    campaignContext: campaignTaskContext
      ? {
          slotRole: campaignTaskContext.slotRole,
          settled: campaignTaskContext.settled,
          nodeKind: campaignTaskContext.nodeKind,
          nodeNameInternal: campaignTaskContext.nodeNameInternal,
          nodeLabelAliasesInternal:
            campaignTaskContext.nodeLabelAliasesInternal,
          coreInvariantInternal: campaignTaskContext.coreInvariantInternal,
          repairReason: campaignTaskContext.repairReason,
        }
      : null,
    requests: deriveCampaignRequestSignals(
      turnUnderstandingV2,
      turn.input.message,
    ),
    disclosureCeiling: turnUnderstandingV2.disclosure.ceiling,
  });
  const campaignCoaching = campaignTaskContext
    ? attachCampaignCoachingPolicy(campaignTaskContext, campaignPolicy)
    : null;
  const contextNeeds = consumeV2
    ? buildContextPlanV2(turnUnderstandingV2)
    : buildContextPlan(understanding);
  const toolCapabilities = consumeV2
    ? deriveToolEligibilityV2(turnUnderstandingV2)
    : deriveToolEligibility(understanding);
  const memoryIntent = consumeV2
    ? deriveMemoryIntentV2(turnUnderstandingV2)
    : deriveMemoryIntent(understanding);
  const intentMatch = consumeV2
    ? deriveIntentMatchV2(turnUnderstandingV2)
    : {
        intent: legacyPlan.primaryIntent,
        confidence: legacyPlan.confidence,
        rationale: legacyPlan.rationale,
      };
  const operationPlan = {
    ...legacyPlan,
    primaryIntent: intentMatch.intent,
    confidence: intentMatch.confidence,
    rationale: intentMatch.rationale,
    contextNeeds,
    toolCapabilities,
  };
  await captureShadowTurnUnderstandingBestEffort(turn.traceContext, {
    understanding,
    legacyPlan,
    requestedActions,
    provenance: resolved.provenance,
    fallbackReason: resolved.fallbackReason,
    classifierActuallyCalled: resolved.classifierActuallyCalled,
  });
  await captureTurnUnderstandingV2TraceBestEffort(turn.traceContext, {
    understanding: turnUnderstandingV2,
    compiledRoute: compiledTurnUnderstandingV2.route,
    mode: turnUnderstandingMode,
    contextNeeds: buildContextPlanV2(turnUnderstandingV2),
    toolCapabilities: deriveToolEligibilityV2(turnUnderstandingV2),
    memoryIntent: deriveMemoryIntentV2(turnUnderstandingV2),
    provenance: semanticResolution?.provenance ?? "deterministic_nonsemantic",
    classifierActuallyCalled:
      semanticResolution?.classifierActuallyCalled ?? false,
    effectsBlocked: semanticResolution?.effectsBlocked ?? false,
    pendingPersists: semanticResolution?.pendingPersists ?? [],
    fallbackReason: semanticResolution?.fallbackReason,
  });
  const pureDurableActionTurn = isPureDurableActionTurn(
    turn.input.message,
    requestedActions,
  );
  const automaticMemoryAssemblyDisabled =
    isLearningExperienceRecallPilotEnabled();
  const rawLoaded = await loadContextSources(turn, {
    memoryIntent,
    currentRevision,
    currentScope,
    storedMessages,
    automaticMemoryAssemblyDisabled,
  });
  const loaded = {
    ...rawLoaded,
    retrievedMemory: rawLoaded.retrievedMemory
      ? projectCampaignMemoryAssembly(rawLoaded.retrievedMemory, campaignPolicy)
      : undefined,
  };
  const storedSessionPlan = loaded.retrievedMemory
    ? await ensureSessionPlan(turn.db, {
        chatSession: turn.chatSession,
        memoryAssembly: loaded.retrievedMemory,
      })
    : undefined;
  const projections = projectContext(turn, {
    ...loaded,
    storedSessionPlan,
    chatTurnPlan: operationPlan,
    pureDurableActionTurn,
    currentRevision,
    historyProjection,
  });
  const baseWorkspaceContext = buildWorkspace(turn, projections, loaded);
  const lastRunResult =
    baseWorkspaceContext.currentCodeAuthoritativeRunStatus ===
    "authoritative_run_matches_current_code"
      ? loaded.latestRunEvidenceContext?.result
      : undefined;
  const preliminaryInteractionState = buildChatInteractionState({
    intentMatch,
    turnPlan: operationPlan,
    userMessage: turn.input.message,
    problemTags: turn.problemTags,
    memory: projections.baseMemory,
    lastRunResult,
    reviewContext: projections.latestReviewContext,
    currentHintLevel: loaded.currentHintLevel,
  });
  return {
    responseLanguage,
    chatTurnPlan: operationPlan,
    turnUnderstandingMode,
    turnUnderstandingV2,
    pendingPersists: semanticResolution?.pendingPersists ?? [],
    pendingConfirmation,
    consumeTurnUnderstandingV2: consumeV2,
    understanding,
    intentMatch,
    requestedActions,
    pureDurableActionTurn,
    ...loaded,
    ...projections,
    baseWorkspaceContext,
    lastRunResult,
    preliminaryInteractionState,
    initialWorkspaceMetadata: buildWorkspaceMetadata(baseWorkspaceContext),
    campaignCoaching,
  };
}

function deriveCampaignRequestSignals(
  understanding: ReturnType<typeof compileTurnUnderstandingV2>,
  message: string,
) {
  const responses = understanding.requests.filter(
    (request) => request.kind === "respond",
  );
  const basis = new Set(responses.flatMap((request) => request.basis));
  return {
    explicitFullRequest:
      understanding.disclosure.ceiling === "full_code" ||
      responses.some((request) => request.delivery.depth === "full"),
    explicitHistoryRequest:
      basis.has("past_problems") || basis.has("past_mistakes"),
    explicitProfileRequest: basis.has("learner_profile"),
    explicitPatternRequest: isExplicitPatternRequest(message),
  };
}

function isExplicitPatternRequest(message: string) {
  return [
    /(?:这|它)?(?:是|属于)(?:什么|哪种)?(?:题型|类型|模式)|(?:应该|该|要|需要)?用什么算法|直接告诉我(?:算法|模式|题型)|是不是.{0,20}(?:滑动窗口|动态规划|\bDP\b|二分|双指针|哈希|贪心|回溯|BFS|DFS)/iu,
    /\b(?:what|which)\s+(?:algorithm|pattern|problem type)\b|\bis\s+(?:this|it)\s+(?:a\s+)?(?:sliding window|dynamic programming|dp|binary search|two pointers?|hash(?:ing| map)?|greedy|backtracking|bfs|dfs)\b|\btell me (?:the|which) (?:algorithm|pattern)\b/iu,
  ].some((pattern) => pattern.test(message));
}

async function loadContextSources(
  turn: BootstrappedChatTurn,
  args: {
    memoryIntent: ReturnType<typeof deriveMemoryIntent>;
    currentRevision: ReturnType<typeof buildWorkspaceCodeRevision>;
    currentScope: CurrentEvidenceScope;
    storedMessages?: StoredChatMessageForProjection[];
    automaticMemoryAssemblyDisabled: boolean;
  },
) {
  const values = await Promise.all([
    args.automaticMemoryAssemblyDisabled
      ? Promise.resolve(undefined)
      : buildCoachMemoryContext(turn.db, {
          userId: turn.user.id,
          problemId: turn.problem.id,
          problemTags: turn.problemTags,
          queryText: turn.input.message,
          entry: { kind: "chat", intent: args.memoryIntent },
          profile: turn.profile,
          code: turn.input.code,
          ftsStore: turn.ftsStore,
          traceContext: turn.traceContext,
        }),
    args.storedMessages ??
      loadStoredRecentMessages(
        turn.chatSession.id,
        turn.chatSession.clearedBeforeSequence,
        turn.db,
      ),
    resolveAuthoritativeRunContext(
      { chatSessionId: turn.chatSession.id, currentScope: args.currentScope },
      turn.db,
    ),
    resolveWorkingRunContext(
      { chatSessionId: turn.chatSession.id, currentScope: args.currentScope },
      turn.db,
    ),
    loadLatestReviewProjection(
      {
        userId: turn.user.id,
        problemId: turn.problem.id,
        chatSessionId: turn.chatSession.id,
        currentRevision: args.currentRevision,
      },
      turn.db,
    ),
    loadCurrentHintLevel(
      { userId: turn.user.id, problemId: turn.problem.id },
      turn.db,
    ),
  ]);
  const [
    retrievedMemory,
    storedMessages,
    latestRunEvidenceContext,
    resumedWorkingRun,
    latestReviewProjection,
    currentHintLevel,
  ] = values;
  return {
    retrievedMemory,
    automaticMemoryAssemblyDisabled: args.automaticMemoryAssemblyDisabled,
    storedMessages,
    latestRunEvidenceContext,
    resumedWorkingRun,
    currentScope: args.currentScope,
    latestReviewProjection,
    currentHintLevel,
  };
}

function projectContext(
  turn: BootstrappedChatTurn,
  args: Awaited<ReturnType<typeof loadContextSources>> & {
    storedSessionPlan?: Awaited<ReturnType<typeof ensureSessionPlan>>;
    chatTurnPlan: ReturnType<typeof buildChatTurnPlan>;
    pureDurableActionTurn: boolean;
    currentRevision: ReturnType<typeof buildWorkspaceCodeRevision>;
    historyProjection?: ConversationProjection;
  },
) {
  const historyProjection =
    args.historyProjection ??
    projectCurrentRevisionWindow({
      storedMessages: args.storedMessages,
      currentRevision: args.currentRevision,
      clearedBeforeSequence: turn.chatSession.clearedBeforeSequence,
      maxModelMessages: 8,
    });
  return {
    historyProjection,
    memoryAssembly: args.retrievedMemory,
    baseMemory:
      args.retrievedMemory?.brief ?? automaticMemoryAssemblyDisabledBrief(),
    sessionPlan: args.storedSessionPlan,
    latestReviewContext: args.latestReviewProjection.context,
  };
}

function automaticMemoryAssemblyDisabledBrief(): CoachMemoryBrief {
  return {
    profileId: AUTOMATIC_MEMORY_ASSEMBLY_DISABLED_RECEIPT,
    teachableMemories: [],
    outputPreferences: [],
    domainReferences: [],
    retrievalStatus: "disabled",
  };
}

function buildWorkspace(
  turn: BootstrappedChatTurn,
  projection: ReturnType<typeof projectContext>,
  loaded: Awaited<ReturnType<typeof loadContextSources>>,
) {
  return buildCurrentWorkspaceContext({
    problem: problemView(turn),
    language: turn.input.language,
    code: turn.input.code,
    selectedTests: turn.selectedTestCases,
    latestAuthoritativeRunEvidence: loaded.latestRunEvidenceContext,
    latestRunAlignment: resolveEvidenceAlignment({
      current: loaded.currentScope,
      evidence: loaded.latestRunEvidenceContext,
    }),
    resumedWorkingRunEvidence: loaded.resumedWorkingRun.evidence,
    resumedWorkingRunAlignment: loaded.resumedWorkingRun.alignment,
    latestReviewContext: projection.latestReviewContext,
    memory: projection.baseMemory,
    user: buildCoachUserContext(turn.profile),
    sessionPlan: projection.sessionPlan,
  });
}

function problemView(turn: BootstrappedChatTurn) {
  return {
    slug: turn.problem.slug,
    title: turn.problem.title,
    leetcodeNumber: turn.problem.leetcodeNumber,
    tags: turn.problemTags,
    methodName: turn.problem.methodName,
    statementMarkdown: turn.problem.statementMarkdown,
    examples: parseProblemCardList(turn.problem.examplesJson),
    constraints: parseProblemCardList(turn.problem.constraintsJson),
  };
}

function parseProblemCardList(value: string): readonly unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type LoadedChatTurnContext = Awaited<
  ReturnType<typeof loadChatTurnContext>
>;
export {
  finalizeChatTurnContext,
  type FinalChatTurnContext,
} from "./chat-turn-final-context";
