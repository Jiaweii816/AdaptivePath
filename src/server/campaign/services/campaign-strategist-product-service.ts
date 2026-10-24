import type { PrismaClient } from "@prisma/client";
import { campaignCurriculumAssets } from "../curriculum";
import type {
  CampaignStrategistCandidateView,
  CampaignStrategistProductView,
} from "../presentation";
import { readCalendarMcpConfig } from "./calendar-mcp-client";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((entry): entry is JsonRecord => Boolean(entry)) : [];
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 30) : [];
}

function uniqueReasons(value: unknown) {
  return [...new Set(strings(value).map(safeReason))];
}

function parseState(value: string | null) {
  if (!value) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function calendarConfigured() {
  try {
    const config = readCalendarMcpConfig();
    return config.enabled && Boolean(config.endpoint && config.accessToken);
  } catch {
    return false;
  }
}

const statusLabels: Record<string, string> = {
  queued: "Queued",
  running: "Planning",
  needs_clarification: "Awaiting your decision",
  waiting_approval: "Proposal awaiting review",
  proposed: "Proposal awaiting review",
  no_change: "Planning complete",
  failed: "Planning incomplete",
  invalid: "Planning result is invalid",
  stale: "Planning evidence is stale",
  budget_exhausted: "Planning budget exhausted",
  canceled: "Canceled",
};

const reasonLabels: Record<string, string> = {
  required_edge_violation: "A required dependency cannot be satisfied",
  same_day_unlock_violation: "A downstream node cannot unlock on the same day",
  problem_supply_shortfall: "Not enough eligible problems are available",
  insufficient_sample: "Recent evidence is insufficient",
  out_of_observed_range: "This is outside the observed capability range",
  missing_supported_outcome: "A supporting outcome sample is missing",
  incomplete_settlement_history: "Recent settlement history is incomplete",
  stale_external_observation: "Calendar data is stale",
  constraint_extraction_budget_exhausted: "The planning budget was exhausted while reading route constraints",
  planner_budget_exhausted: "The planning budget was exhausted while building candidates",
  clarification_budget_exhausted: "Planning stopped after too many clarification requests",
  simulation_budget_exhausted: "The simulation budget was exhausted while evaluating candidates",
  proposal_budget_exhausted: "The proposal budget was exhausted while creating a formal proposal",
  stale_worker: "The planning worker timed out. Try again.",
  stale_dispatch: "The planning job could not start. Try again.",
  dispatch_failed: "The planning job failed to start. Try again.",
  resume_dispatch_failed: "The planning job failed to resume. Try again.",
  stale_skeleton: "The route version changed. Run Strategist again.",
  stale_context: "The planning evidence changed. Run Strategist again.",
  pending_patch_exists: "A proposal is already awaiting review. Resolve it first.",
  unsupported_scope_today_immutable: "Strategist cannot modify Today's materialized task",
  invalid_action_schema: "The planning service returned an unusable step",
  finalize_policy_rejected: "The candidate did not pass safety validation",
};

function safeReason(code: string) {
  return reasonLabels[code] ?? "Strategist Runtime could not complete this request. Try again.";
}

function explicitFocusNodeIds(state: JsonRecord) {
  const constraints = record(state.resolvedConstraints);
  return records(constraints?.userGoals)
    .filter((goal) => typeof goal.id === "string" && !goal.id.startsWith("campaign-goal-"))
    .flatMap((goal) => typeof goal.nodeId === "string" ? [goal.nodeId] : []);
}

function branchReachability(value: JsonRecord, focusNodeIds: readonly string[], horizonEnd: string | null) {
  if (focusNodeIds.length === 0 || !horizonEnd) return "unknown" as const;
  const reachability = new Map(records(value.earliestReachableDates).flatMap((entry) => typeof entry.nodeId === "string"
    ? [[entry.nodeId, typeof entry.firstSelectedDate === "string" ? entry.firstSelectedDate : null] as const]
    : []));
  if (focusNodeIds.some((nodeId) => !reachability.has(nodeId))) return "unknown" as const;
  const reached = focusNodeIds.filter((nodeId) => {
    const date = reachability.get(nodeId);
    return typeof date === "string" && date <= horizonEnd;
  }).length;
  return reached === focusNodeIds.length ? "reachable" as const
    : reached > 0 ? "partially_reachable" as const
      : "unreachable" as const;
}

function branchViews(comparison: unknown, focusNodeIds: readonly string[], horizonEnd: string | null): CampaignStrategistCandidateView["branches"] {
  const root = record(comparison);
  if (!root) return [];
  const names = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node.label.en]));
  return (["optimistic", "observed_supported", "conservative"] as const).flatMap((branch) => {
    const value = record(root[branch]);
    if (!value) return [];
    const days = records(value.days);
    return [{
      branch,
      violations: uniqueReasons(value.violations),
      unknowns: uniqueReasons(value.unknowns),
      projectedDates: days.map((day) => day.campaignDate).filter((date): date is string => typeof date === "string").slice(0, 14),
      earliestReachable: records(value.earliestReachableDates)
        .filter((entry) => typeof entry.nodeId === "string" && (focusNodeIds.length === 0 || focusNodeIds.includes(entry.nodeId)))
        .slice(0, focusNodeIds.length > 0 ? focusNodeIds.length : 5)
        .flatMap((entry) => typeof entry.nodeId === "string"
        ? [{
            nodeName: names.get(entry.nodeId) ?? "Learning node",
            earliestEligibleDate: typeof entry.earliestEligibleDate === "string" ? entry.earliestEligibleDate : null,
            firstSelectedDate: typeof entry.firstSelectedDate === "string" ? entry.firstSelectedDate : null,
          }]
        : []),
      dayProjections: days.flatMap((day) => typeof day.campaignDate === "string"
        ? [{
            campaignDate: day.campaignDate,
            budget: typeof day.budget === "number" ? day.budget : null,
            phase: typeof day.phase === "string" ? day.phase : null,
            selectedNodeNames: strings(day.selectedNodeIds).map((nodeId) => names.get(nodeId) ?? "Learning node"),
            risks: uniqueReasons(day.violationCodes),
            unknowns: uniqueReasons(day.unknownCodes),
          }]
        : []),
      horizonReachability: branchReachability(value, focusNodeIds, horizonEnd),
    }];
  });
}

function operationChangeText(operation: JsonRecord, plans: Map<string, JsonRecord>, names: Map<string, string>) {
  const nodeId = typeof operation.nodeId === "string" ? operation.nodeId : null;
  const plan = nodeId ? plans.get(nodeId) : null;
  const nodeName = nodeId ? names.get(nodeId) ?? nodeId : "Route";
  if (operation.type === "set_node_included") return !plan || plan.included !== operation.included
    ? `${nodeName}: ${operation.included ? "added to route" : "removed from future route"}`
    : null;
  if (operation.type === "set_node_priority") return !plan || plan.priority !== operation.priority
    ? `${nodeName}: priority set to ${String(operation.priority)}`
    : null;
  if (operation.type === "set_target_week") return !plan || plan.targetWeek !== operation.targetWeek ? `${nodeName}: target week changed` : null;
  if (operation.type === "set_node_rationale") return !plan || plan.rationale !== operation.rationale ? `${nodeName}: route rationale updated` : null;
  if (operation.type === "set_mixed_window_days") return "Mixed-practice window changed";
  if (operation.type === "move_node") {
    const anchorId = typeof operation.beforeNodeId === "string" ? operation.beforeNodeId
      : typeof operation.afterNodeId === "string" ? operation.afterNodeId : null;
    const nodeOrder = typeof plan?.order === "number" ? plan.order : null;
    const anchorOrder = anchorId && typeof plans.get(anchorId)?.order === "number" ? plans.get(anchorId)!.order as number : null;
    const unchanged = nodeOrder !== null && anchorOrder !== null
      && (typeof operation.beforeNodeId === "string" ? nodeOrder === anchorOrder - 1 : nodeOrder === anchorOrder + 1);
    return unchanged ? null : `${nodeName}: learning order changed`;
  }
  return `${nodeName}: route setting changed`;
}

function candidateViews(state: JsonRecord, activeNodePlans: readonly JsonRecord[]) {
  const names = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node.label.en]));
  const plans = new Map(activeNodePlans.flatMap((plan) => typeof plan.nodeId === "string" ? [[plan.nodeId, plan] as const] : []));
  const observations = records(state.observations);
  const focusNodeIds = explicitFocusNodeIds(state);
  const constraints = record(state.resolvedConstraints);
  const horizonEnd = typeof constraints?.horizonEnd === "string" ? constraints.horizonEnd : null;
  return records(state.candidates).flatMap((stored): CampaignStrategistCandidateView[] => {
    const candidate = record(stored.candidate);
    if (!candidate || typeof candidate.candidateId !== "string" || typeof candidate.rationaleSummary !== "string") return [];
    const observation = observations.find((entry) => entry.candidateId === candidate.candidateId && entry.type === "simulation");
    const nodeChanges = records(candidate.nodeOperations).flatMap((operation) => operationChangeText(operation, plans, names) ?? []);
    const goalDepthChanges = records(candidate.goalDepth).flatMap((entry) => typeof entry.nodeId === "string" && (entry.goalDepth === "mastery" || entry.goalDepth === "exposure")
      && (plans.get(entry.nodeId)?.goalDepth ?? "mastery") !== entry.goalDepth
      ? [{ nodeName: names.get(entry.nodeId) ?? entry.nodeId, goalDepth: entry.goalDepth as "mastery" | "exposure" }]
      : []);
    const targetByDateChanges = records(candidate.targetByDate).flatMap((entry) => typeof entry.nodeId === "string" && (typeof entry.targetByDate === "string" || entry.targetByDate === null)
      && (plans.get(entry.nodeId)?.targetByDate ?? null) !== entry.targetByDate
      ? [{ nodeName: names.get(entry.nodeId) ?? entry.nodeId, targetByDate: entry.targetByDate as string | null }]
      : []);
    const hasRouteChange = nodeChanges.length > 0 || goalDepthChanges.length > 0 || targetByDateChanges.length > 0;
    return [{
      candidateId: candidate.candidateId,
      summary: hasRouteChange
        ? candidate.rationaleSummary
        : "Route nodes stay unchanged; this only simulates future task-cap and learning-goal constraints.",
      accepted: observation ? observation.accepted === true : null,
      patchLegal: true,
      nodeChanges,
      goalDepthChanges,
      targetByDateChanges,
      dateBudgetSuggestions: records(candidate.dailyBudgetSuggestions).flatMap((entry) => typeof entry.campaignDate === "string" && typeof entry.maxQuestions === "number" && typeof entry.rationale === "string"
        ? [{ campaignDate: entry.campaignDate, maxQuestions: entry.maxQuestions, rationale: entry.rationale }]
        : []),
      branches: branchViews(observation?.comparison, focusNodeIds, horizonEnd),
    }];
  });
}

function clarificationView(state: JsonRecord) {
  const clarification = record(state.clarification);
  if (!clarification || typeof clarification.question !== "string" || typeof clarification.tradeoff !== "string") return null;
  const knownFacts = strings(clarification.knownFacts);
  const combined = [clarification.question, clarification.tradeoff, ...knownFacts].join(" ");
  const dates = combined.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return {
    question: clarification.question,
    knownFacts,
    tradeoff: clarification.tradeoff,
    calendarAuthorizationRequested: /calendar|日历/i.test(combined),
    queryRange: dates.length >= 2 ? { start: dates[0]!, end: dates[1]! } : null,
  };
}

function resultKind(status: string, runMode: string, errorClass: string | null, proposalStatus: string | null) {
  if (runMode === "simulation" && status === "no_change" && errorClass === "simulation_mode_proposal_forbidden") return "simulation_complete" as const;
  if ((status === "waiting_approval" || status === "proposed") && proposalStatus && proposalStatus !== "pending") return "proposal_resolved" as const;
  if (status === "waiting_approval" || status === "proposed") return "proposal_pending" as const;
  if (status === "needs_clarification") return "clarification" as const;
  if (status === "queued" || status === "running") return "in_progress" as const;
  if (status === "failed" || status === "invalid" || status === "stale" || status === "budget_exhausted") return "failed" as const;
  return "no_change" as const;
}

function progress(state: JsonRecord, status: string, runMode: "proposal" | "simulation") {
  const hasContext = typeof state.contextDigest === "string" && !/^0+$/.test(state.contextDigest);
  const hasBrief = Boolean(record(state.strategyBrief));
  const observations = records(state.observations);
  const hasSimulation = observations.some((entry) => entry.type === "simulation");
  const revised = records(state.candidates).length > 1 || records(state.rejectedCandidates).length > 0;
  const waiting = status === "needs_clarification";
  const proposed = status === "waiting_approval" || status === "proposed";
  const active = status === "queued" || status === "running";
  const terminal = !active && !waiting;
  const core = [
    { key: "context", label: "Read route and recent evidence", done: hasContext },
    { key: "brief", label: "Build planning objective", done: hasBrief },
    { key: "simulation", label: "Simulate candidates", done: hasSimulation },
  ];
  const firstPending = core.findIndex((step) => !step.done);
  const coreSteps = core.map((step, index) => ({
    key: step.key,
    label: step.label,
    state: step.done ? "complete" as const : active && index === firstPending ? "current" as const : "pending" as const,
  }));
  return [
    ...coreSteps,
    revised
      ? { key: "revision", label: "Revise candidates from evidence", state: "complete" as const }
      : terminal
        ? { key: "revision", label: "Revision not needed", state: "not_needed" as const }
        : { key: "revision", label: "Revise candidates from evidence", state: "pending" as const },
    waiting
      ? { key: "clarification", label: "Await clarification", state: "current" as const }
      : terminal
        ? { key: "clarification", label: "Clarification not needed", state: "not_needed" as const }
        : { key: "clarification", label: "Await clarification", state: "pending" as const },
    runMode === "simulation" && terminal
      ? { key: "proposal", label: "Proposal not applicable in What-if", state: "not_applicable" as const }
      : proposed
        ? { key: "proposal", label: "Proposal created for review", state: "complete" as const }
        : { key: "proposal", label: "Create proposal for review", state: "pending" as const },
  ];
}

export async function loadCampaignStrategistProductView(input: {
  db: PrismaClient;
  userId: string;
  campaignId: string;
  runId?: string;
  now: Date;
}): Promise<CampaignStrategistProductView> {
  const [campaign, run, pendingPatch] = await Promise.all([
    input.db.campaign.findFirst({ where: { id: input.campaignId, userId: input.userId, status: "active" }, select: { id: true } }),
    input.db.campaignStrategistRun.findFirst({
      where: { ...(input.runId ? { id: input.runId } : {}), campaignId: input.campaignId, campaign: { userId: input.userId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { proposalPatch: { select: { status: true } } },
    }),
    input.db.campaignSkeletonPatch.count({ where: { campaignId: input.campaignId, status: "pending" } }),
  ]);
  if (!campaign) return { status: "unavailable", routeRisk: { level: "attention", label: "Route status unavailable", detail: "The active Campaign could not be read." }, calendarConfigured: calendarConfigured(), latestRun: null };
  if (!run) return { status: "ready", routeRisk: { level: "clear", label: "No route risk found", detail: "You can start a future-route check at any time." }, calendarConfigured: calendarConfigured(), latestRun: null };
  const state = parseState(run.runtimeStateJson) ?? {};
  const activeSkeleton = await input.db.campaignSkeleton.findUnique({
    where: { campaignId_version: { campaignId: input.campaignId, version: run.activeSkeletonVersion } },
    include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
  });
  const runMode: "proposal" | "simulation" = state.runMode === "simulation" ? "simulation" : "proposal";
  const errorClass = run.errorClass ?? (typeof state.errorClass === "string" ? state.errorClass : null);
  const externalDataValidUntil = typeof state.externalDataValidUntil === "string" ? state.externalDataValidUntil : null;
  const staleExternal = Boolean(externalDataValidUntil && Date.parse(externalDataValidUntil) <= input.now.valueOf());
  const candidates = candidateViews(state, activeSkeleton?.nodePlans.map((plan) => ({
    nodeId: plan.nodeId,
    included: plan.included,
    order: plan.sortOrder,
    priority: plan.priority,
    targetWeek: plan.targetWeek,
    goalDepth: plan.goalDepth ?? "mastery",
    targetByDate: plan.targetByDate ?? null,
    rationale: plan.rationale,
  })) ?? []);
  const latestRun = {
    runId: run.id,
    runMode,
    status: run.status,
    statusLabel: run.proposalPatch?.status === "accepted"
      ? "Proposal accepted"
      : run.proposalPatch?.status === "partially_accepted"
        ? "Proposal partially accepted"
        : run.proposalPatch?.status === "rejected"
          ? "Proposal rejected"
          : statusLabels[run.status] ?? "Status updated",
    resultKind: resultKind(run.status, runMode, errorClass, run.proposalPatch?.status ?? null),
    requestSummary: record(state.request) && typeof record(state.request)!.text === "string" ? String(record(state.request)!.text).slice(0, 2_000) : null,
    publicSummary: run.rationaleSummary,
    progress: progress(state, run.status, runMode),
    clarification: clarificationView(state),
    candidates,
    rejectedCandidates: records(state.rejectedCandidates).flatMap((entry) => typeof entry.candidateId === "string"
      ? [{ candidateId: entry.candidateId, reasons: strings(entry.codes).map(safeReason) }]
      : []),
    selectedCandidateId: typeof state.selectedCandidateId === "string" ? state.selectedCandidateId : null,
    externalDataAsOf: typeof state.externalDataAsOf === "string" ? state.externalDataAsOf : null,
    externalDataValidUntil,
    externalDataStale: staleExternal,
    errorCode: errorClass,
    errorMessage: errorClass ? safeReason(errorClass) : null,
    todayUnaffected: true as const,
  };
  // A failed planning attempt does not make the active route unsafe, but it must
  // remain visible as an incomplete check rather than being reported as success.
  const failed = latestRun.resultKind === "failed";
  const attention = pendingPatch > 0 || staleExternal || run.status === "needs_clarification" || failed;
  const checking = run.status === "queued" || run.status === "running";
  return {
    status: "ready",
    routeRisk: checking
      ? { level: "checking", label: "Checking future route", detail: "Today can continue as usual." }
      : attention
        ? { level: "attention", label: failed ? "Latest planning attempt incomplete" : "Future route needs attention", detail: pendingPatch > 0 ? "A route proposal is awaiting review." : failed ? "The active roadmap was not changed." : latestRun.statusLabel }
        : { level: "clear", label: "No blocking risk found", detail: "The latest Strategist check is complete." },
    calendarConfigured: calendarConfigured(),
    latestRun,
  };
}
