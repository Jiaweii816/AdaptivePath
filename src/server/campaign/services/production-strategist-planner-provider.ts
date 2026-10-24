import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { z } from "zod";
import { createStrategistClient } from "@/server/llm/client";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";
import { getStrategistModel } from "@/server/llm/models";
import {
  STRATEGIST_RUNTIME_SCHEMA_VERSION,
  canonicalStrategistJson,
  strategistPlannerTurnSchema,
  strategistResolvedConstraintsSchema,
  strategistStrategyBriefSchema,
} from "../domain";
import type { StrategistCandidate } from "../domain";
import type {
  StrategistConstraintExtractionInput,
  StrategistConstraintExtractor,
  StrategistPlannerInput,
  StrategistPlannerProvider,
  StrategistPlannerProviderResponse,
  StrategistProviderAudit,
} from "./scripted-strategist-planner-provider";
import { classifyStrategistTodayScope } from "./strategist-today-scope";

const extractedConstraintsSchema = strategistResolvedConstraintsSchema.omit({ deterministicFacts: true });

export type ProductionStrategistTransportResult = Readonly<{
  content: string;
  responseModel: string | null;
  finishReason?: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}>;

export type StrategistProviderStage = "constraint_extraction" | "planner_action" | "schema_repair";

export type StrategistProviderDiagnostic = Readonly<{
  providerStage: StrategistProviderStage;
  safeErrorCode: string;
  httpStatus: number | null;
  modelName: string;
  endpointHost: string | null;
  latencyMs: number;
  timeoutType: string | null;
  schemaIssuePaths: readonly string[];
  schemaIssues: readonly Readonly<{
    path: string;
    code: string;
    issueKind: "missing_field" | "invalid_enum" | "invalid_type" | "custom_constraint";
    expected: string | null;
    receivedType: string | null;
  }>[];
  outputShape: readonly string[];
  finishReason: string | null;
  responseChars: number;
  jsonFailureKind: "unexpected_end" | "unclosed_code_fence" | "invalid_json" | null;
  responseEmpty: boolean;
  repairAttempted: boolean;
}>;

export type ProductionStrategistTransport = Readonly<{
  complete(input: Readonly<{
    model: string;
    messages: readonly Readonly<{ role: "system" | "user"; content: string }>[];
    maxTokens: number;
  }>): Promise<ProductionStrategistTransportResult>;
}>;

export class ProductionStrategistProviderError extends Error {
  constructor(
    message: string,
    readonly code: "provider_failed" | "invalid_structured_output",
    readonly audit: StrategistProviderAudit,
    readonly diagnostic: StrategistProviderDiagnostic,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "ProductionStrategistProviderError";
  }
}

class StrategistTransportError extends Error {
  constructor(
    message: string,
    readonly safeErrorCode: string,
    readonly details: Readonly<{
      httpStatus?: number | null;
      latencyMs?: number;
      timeoutType?: string | null;
      responseEmpty?: boolean;
    }> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "StrategistTransportError";
  }
}

function endpointHost(client: OpenAI) {
  try {
    return new URL(client.baseURL).host;
  } catch {
    return null;
  }
}

function transportFailure(error: unknown, latencyMs: number) {
  if (error instanceof StrategistTransportError) {
    return {
      safeErrorCode: error.safeErrorCode,
      httpStatus: error.details.httpStatus ?? null,
      latencyMs: error.details.latencyMs ?? latencyMs,
      timeoutType: error.details.timeoutType ?? null,
      responseEmpty: error.details.responseEmpty ?? false,
    };
  }
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof record.status === "number" ? record.status : null;
  const code = typeof record.code === "string" ? record.code : null;
  const name = typeof record.name === "string" ? record.name : null;
  const message = typeof record.message === "string" ? record.message : "";
  const timeout = /timeout/i.test(`${name ?? ""} ${code ?? ""} ${message}`);
  const connection = /connection|network|fetch failed/i.test(`${name ?? ""} ${code ?? ""} ${message}`);
  return {
    safeErrorCode: status ? `http_${status}` : timeout ? "provider_timeout" : connection ? "provider_connection_failed" : code ? `provider_${code}` : "provider_request_failed",
    httpStatus: status,
    latencyMs,
    timeoutType: timeout ? name ?? code ?? "timeout" : null,
    responseEmpty: false,
  };
}

function schemaIssuePaths(error: unknown) {
  return error instanceof z.ZodError
    ? [...new Set(error.issues.map((issue) => issue.path.join(".") || "<root>"))].slice(0, 12)
    : [];
}

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function valueAtPath(value: unknown, path: readonly PropertyKey[]) {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false, value: undefined };
      current = current[segment];
      continue;
    }
    const record = asRecord(current);
    if (!record || !Object.hasOwn(record, String(segment))) return { exists: false, value: undefined };
    current = record[String(segment)];
  }
  return { exists: true, value: current };
}

function schemaIssues(error: unknown, raw: string) {
  if (!(error instanceof z.ZodError)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonCodeFence(raw));
  } catch {
    parsed = undefined;
  }
  return error.issues.slice(0, 12).map((issue) => {
    const record = issue as unknown as Record<string, unknown>;
    const located = valueAtPath(parsed, issue.path);
    const expected = typeof record.expected === "string"
      ? record.expected
      : Array.isArray(record.values)
        ? record.values.filter((value): value is string => typeof value === "string").join("|") || null
        : null;
    return {
      path: issue.path.join(".") || "<root>",
      code: issue.code,
      issueKind: !located.exists
        ? "missing_field" as const
        : issue.code === "invalid_value" && Array.isArray(record.values)
          ? "invalid_enum" as const
          : issue.code === "invalid_type"
            ? "invalid_type" as const
            : "custom_constraint" as const,
      expected,
      receivedType: located.exists ? valueType(located.value) : null,
    };
  });
}

function outputShape(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(stripJsonCodeFence(raw));
  } catch {
    return ["<invalid-json>"];
  }
  const shape: string[] = [];
  const visit = (entry: unknown, path: string, depth: number) => {
    shape.push(`${path}:${valueType(entry)}`);
    if (depth >= 5) return;
    if (Array.isArray(entry)) {
      if (entry.length > 0) visit(entry[0], `${path}[]`, depth + 1);
      return;
    }
    const record = asRecord(entry);
    if (record) Object.keys(record).sort().slice(0, 30).forEach((key) => visit(record[key], path === "<root>" ? key : `${path}.${key}`, depth + 1));
  };
  visit(value, "<root>", 0);
  return shape.slice(0, 80);
}

function openAiTransport(client: OpenAI): ProductionStrategistTransport {
  return {
    async complete(input) {
      const startedAt = Date.now();
      const completion = await client.chat.completions.create({
        model: input.model,
        messages: [...input.messages],
        ...deepSeekV4ThinkingParams(input.model, "disabled"),
        temperature: 0.1,
        max_tokens: input.maxTokens,
        response_format: { type: "json_object" },
      }) as ChatCompletion;
      const content = completion.choices[0]?.message.content;
      if (!content) {
        const finishReason = completion.choices[0]?.finish_reason;
        throw new StrategistTransportError(
          "Production Strategist provider returned an empty response.",
          finishReason === "length" ? "empty_response_token_limit" : "empty_response",
          { latencyMs: Date.now() - startedAt, responseEmpty: true },
        );
      }
      return {
        content,
        responseModel: completion.model ?? null,
        finishReason: completion.choices[0]?.finish_reason ?? null,
        latencyMs: Date.now() - startedAt,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
    },
  };
}

function audit(results: readonly ProductionStrategistTransportResult[]): StrategistProviderAudit {
  return {
    modelCallCount: results.length,
    schemaRepairCount: Math.max(0, results.length - 1),
    latencyMs: results.reduce((total, result) => total + result.latencyMs, 0),
    inputTokens: results.reduce((total, result) => total + result.inputTokens, 0),
    outputTokens: results.reduce((total, result) => total + result.outputTokens, 0),
  };
}

function stripJsonCodeFence(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? trimmed;
}

function jsonFailureKind(raw: string, error: unknown): StrategistProviderDiagnostic["jsonFailureKind"] {
  if (!(error instanceof SyntaxError)) return null;
  const trimmed = raw.trim();
  if (/^```(?:json)?/i.test(trimmed) && !/```\s*$/.test(trimmed)) return "unclosed_code_fence";
  if (/unexpected end|unterminated/i.test(error.message)) return "unexpected_end";
  return "invalid_json";
}

function normalizeGoalDepth(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  return normalized === "mastery" || normalized === "exposure" ? normalized : value;
}

function normalizeBoundedTextList(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const normalized: unknown[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      normalized.push(entry);
    } else {
      const key = entry.trim();
      if (!seen.has(key)) {
        seen.add(key);
        normalized.push(entry);
      }
    }
    if (normalized.length >= maxItems) break;
  }
  return normalized;
}

function normalizeCandidateShape(value: unknown) {
  const candidate = asRecord(value);
  if (!candidate) return value;
  const nodeOperations = Array.isArray(candidate.nodeOperations) ? candidate.nodeOperations : null;
  let goalDepth = Array.isArray(candidate.goalDepth) ? [...candidate.goalDepth] : null;
  let targetByDate = Array.isArray(candidate.targetByDate) ? [...candidate.targetByDate] : null;
  if (!nodeOperations) return value;
  const retainedOperations: unknown[] = [];
  for (const operationValue of nodeOperations) {
    const operation = asRecord(operationValue);
    if (operation?.type === "set_goal_depth" && typeof operation.nodeId === "string") {
      const normalizedDepth = normalizeGoalDepth(operation.goalDepth);
      goalDepth ??= [];
      const existing = goalDepth.find((entry) => asRecord(entry)?.nodeId === operation.nodeId);
      if (!existing) {
        goalDepth.push({ nodeId: operation.nodeId, goalDepth: normalizedDepth });
        continue;
      }
      if (asRecord(existing)?.goalDepth === normalizedDepth) continue;
    }
    if (operation?.type === "set_target_by_date" && typeof operation.nodeId === "string") {
      targetByDate ??= [];
      const existing = targetByDate.find((entry) => asRecord(entry)?.nodeId === operation.nodeId);
      if (!existing) {
        targetByDate.push({ nodeId: operation.nodeId, targetByDate: operation.targetByDate });
        continue;
      }
      if (asRecord(existing)?.targetByDate === operation.targetByDate) continue;
    }
    retainedOperations.push(operationValue);
  }
  return {
    ...candidate,
    nodeOperations: retainedOperations,
    ...(goalDepth ? {
      goalDepth: goalDepth.map((entry) => {
        const record = asRecord(entry);
        return record ? { ...record, goalDepth: normalizeGoalDepth(record.goalDepth) } : entry;
      }),
    } : {}),
    ...(targetByDate ? { targetByDate } : {}),
  };
}

function normalizeStructuredOutput(value: unknown): unknown {
  const root = asRecord(value);
  if (!root) return value;
  const action = asRecord(root.action);
  const strategyBrief = asRecord(root.strategyBrief);
  return {
    ...root,
    ...(Array.isArray(root.hardConstraints) || Array.isArray(root.assumptions) ? {
      hardConstraints: normalizeBoundedTextList(root.hardConstraints, 20),
      assumptions: normalizeBoundedTextList(root.assumptions, 20),
    } : {}),
    ...(strategyBrief ? {
      strategyBrief: {
        ...strategyBrief,
        hardConstraints: normalizeBoundedTextList(strategyBrief.hardConstraints, 20),
        candidateDimensions: normalizeBoundedTextList(strategyBrief.candidateDimensions, 20),
        softGoals: Array.isArray(strategyBrief.softGoals)
          ? strategyBrief.softGoals.map((goal) => {
            const record = asRecord(goal);
            return record ? { ...record, requestedGoalDepth: normalizeGoalDepth(record.requestedGoalDepth) } : goal;
          })
          : strategyBrief.softGoals,
      },
    } : {}),
    ...(action && Array.isArray(action.candidates) ? {
      action: { ...action, candidates: action.candidates.map(normalizeCandidateShape) },
    } : {}),
  };
}

function parseJson(raw: string): unknown {
  return normalizeStructuredOutput(JSON.parse(stripJsonCodeFence(raw)));
}

function addCampaignDays(campaignDate: string, days: number) {
  const date = new Date(`${campaignDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function explicitFutureDayCount(requestText: string | null) {
  if (!requestText) return null;
  const numeric = requestText.match(/(?:未来|future)\s*(\d{1,2})\s*(?:天|days?)/i)?.[1];
  if (numeric) return Math.min(30, Math.max(1, Number(numeric)));
  const chinese = requestText.match(/未来\s*([一二三四五六七八九十])\s*天/)?.[1];
  if (!chinese) return null;
  const values: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return values[chinese] ?? null;
}

function normalizeExtractedPlanningWindow(
  value: z.infer<typeof extractedConstraintsSchema>,
  input: StrategistConstraintExtractionInput,
) {
  const futureDays = explicitFutureDayCount(input.requestText);
  if (!futureDays || value.scope !== "future_route") return value;
  const today = input.deterministicFacts.planningHorizon.start;
  const expectedDates = Array.from({ length: futureDays }, (_, index) => addCampaignDays(today, index + 1));
  const sortedCaps = [...value.dailyCaps].sort((left, right) => left.campaignDate.localeCompare(right.campaignDate));
  const dailyCaps = sortedCaps.length === futureDays
    ? expectedDates.map((campaignDate, index) => ({ ...sortedCaps[index], campaignDate }))
    : sortedCaps.filter((cap) => expectedDates.includes(cap.campaignDate));
  return {
    ...value,
    horizonEnd: expectedDates.at(-1)!,
    dailyCaps,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function currentRoutePlans(context: StrategistPlannerInput["context"]) {
  const route = asRecord(context.route);
  return new Map((Array.isArray(route?.nodes) ? route.nodes : []).flatMap((value) => {
    const plan = asRecord(value);
    return typeof plan?.nodeId === "string" ? [[plan.nodeId, plan] as const] : [];
  }));
}

function operationChangesRoute(operation: StrategistCandidate["nodeOperations"][number], plans: Map<string, Record<string, unknown>>) {
  if (operation.type === "set_mixed_window_days") return true;
  const plan = plans.get(operation.nodeId);
  if (!plan) return true;
  if (operation.type === "set_node_included") return plan.included !== operation.included;
  if (operation.type === "set_node_priority") return plan.priority !== operation.priority;
  if (operation.type === "set_target_week") return plan.targetWeek !== operation.targetWeek;
  if (operation.type === "set_node_rationale") return plan.rationale !== operation.rationale;
  if (operation.type === "move_node") {
    const nodeOrder = typeof plan.order === "number" ? plan.order : null;
    const anchorId = operation.beforeNodeId ?? operation.afterNodeId;
    const anchorOrder = anchorId && typeof plans.get(anchorId)?.order === "number" ? plans.get(anchorId)!.order as number : null;
    if (nodeOrder === null || anchorOrder === null) return true;
    return operation.beforeNodeId ? nodeOrder !== anchorOrder - 1 : nodeOrder !== anchorOrder + 1;
  }
  return true;
}

function normalizeCandidate(candidate: StrategistCandidate, input: StrategistPlannerInput): StrategistCandidate {
  const plans = currentRoutePlans(input.context);
  const explicitGoalNodes = new Set((input.state.resolvedConstraints?.userGoals ?? [])
    .filter((goal) => !goal.id.startsWith("campaign-goal-"))
    .map((goal) => goal.nodeId));
  const allowedNodeIds = new Set([
    ...explicitGoalNodes,
    ...requiredPrerequisiteNodeIds(input),
    ...simulatorProvenSystemNodeIds(input),
  ]);
  const horizonStart = input.state.resolvedConstraints?.deterministicFacts.planningHorizon.start ?? null;
  const horizonEnd = input.state.resolvedConstraints?.horizonEnd ?? input.state.resolvedConstraints?.deterministicFacts.planningHorizon.end ?? null;
  const dailyCaps = new Map((input.state.resolvedConstraints?.dailyCaps ?? []).map((cap) => [cap.campaignDate, cap.maxQuestions]));
  const scopedNodeOperations = candidate.nodeOperations.filter((operation) => (operation.type === "set_mixed_window_days"
    ? !input.state.request?.text
    : allowedNodeIds.has(operation.nodeId)
      && (!explicitGoalNodes.has(operation.nodeId) || explicitOperationAllowed(input, operation.nodeId, operation.type)))
    && operationChangesRoute(operation, plans));
  return {
    ...candidate,
    nodeOperations: ensureExplicitHighestPriorityOperations(scopedNodeOperations, input, plans),
    goalDepth: candidate.goalDepth.filter((entry) => allowedNodeIds.has(entry.nodeId)
      && (!explicitGoalNodes.has(entry.nodeId) || explicitOperationAllowed(input, entry.nodeId, "set_goal_depth"))
      && (plans.get(entry.nodeId)?.goalDepth ?? "mastery") !== entry.goalDepth),
    targetByDate: candidate.targetByDate.filter((entry) => allowedNodeIds.has(entry.nodeId)
      && (!explicitGoalNodes.has(entry.nodeId) || explicitOperationAllowed(input, entry.nodeId, "set_target_by_date"))
      && (entry.targetByDate === null || ((!horizonStart || entry.targetByDate > horizonStart) && (!horizonEnd || entry.targetByDate <= horizonEnd)))
      && (plans.get(entry.nodeId)?.targetByDate ?? null) !== entry.targetByDate),
    dailyBudgetSuggestions: candidate.dailyBudgetSuggestions.filter((entry) => (!horizonStart || entry.campaignDate > horizonStart)
      && (!horizonEnd || entry.campaignDate <= horizonEnd)
      && (!dailyCaps.has(entry.campaignDate) || entry.maxQuestions <= dailyCaps.get(entry.campaignDate)!)),
  };
}

function ensureExplicitHighestPriorityOperations(
  operations: StrategistCandidate["nodeOperations"],
  input: StrategistPlannerInput,
  plans: Map<string, Record<string, unknown>>,
) {
  const requestText = input.state.request?.text;
  if (!requestText) return operations;
  const explicitGoals = (input.state.resolvedConstraints?.userGoals ?? [])
    .filter((goal) => !goal.id.startsWith("campaign-goal-"));
  const highestPrioritySegments = requestText.split(/[。！？!?\n]+/)
    .filter((segment) => /最高优先级|最高.*优先|highest\s+priority|top\s+priority/i.test(segment));
  const targets = explicitGoals.filter((goal) => highestPrioritySegments.some((segment) => segment.includes(goal.nodeId)));
  if (targets.length !== 1) return operations;
  const nodeId = targets[0].nodeId;
  const currentPlan = plans.get(nodeId);
  const routePlans = [...plans.entries()]
    .filter(([candidateNodeId, plan]) => candidateNodeId !== nodeId && plan.included !== false && typeof plan.order === "number")
    .sort((left, right) => (left[1].order as number) - (right[1].order as number));
  const repairSummary = asRecord(input.context.repairSummary);
  const repairAnchorId = (Array.isArray(repairSummary?.top) ? repairSummary.top : [])
    .map(asRecord)
    .find((repair) => typeof repair?.nodeId === "string" && repair.nodeId !== nodeId && plans.has(repair.nodeId))
    ?.nodeId;
  const anchor = typeof repairAnchorId === "string"
    ? [repairAnchorId, plans.get(repairAnchorId)!] as const
    : routePlans[0];
  const normalized = operations.filter((operation) => operation.type === "set_mixed_window_days"
    || operation.nodeId !== nodeId
    || operation.type !== "set_node_priority" && operation.type !== "move_node");
  if (currentPlan?.priority !== 100) normalized.push({ type: "set_node_priority", nodeId, priority: 100 });
  if (anchor && (typeof currentPlan?.order !== "number" || currentPlan.order !== (anchor[1].order as number) - 1)) {
    normalized.push({ type: "move_node", nodeId, beforeNodeId: anchor[0] });
  }
  return normalized;
}

function explicitOperationAllowed(input: StrategistPlannerInput, nodeId: string, operationType: string) {
  const requestText = input.state.request?.text;
  if (!requestText) return true;
  const explicitNodeIds = (input.state.resolvedConstraints?.userGoals ?? [])
    .filter((goal) => !goal.id.startsWith("campaign-goal-"))
    .map((goal) => goal.nodeId);
  const segments = requestText.split(/[。！？!?\n]+/).map((segment) => segment.trim()).filter(Boolean);
  if (!segments.some((segment) => segment.includes(nodeId))) return true;
  const pattern = operationType === "set_node_priority" || operationType === "move_node"
    ? /优先|priority|prioriti[sz]e|rank|排序/i
    : operationType === "set_goal_depth"
      ? /mastery|exposure|goal\s*depth|掌握|熟练|了解|降为|提升为/i
      : operationType === "set_node_included"
        ? /加入|移除|包含|排除|include|exclude|remove/i
        : operationType === "set_target_by_date"
          ? /deadline|target\s*(?:date|by)|期限|截至|日期/i
          : null;
  if (!pattern) return false;
  const relevant = segments.filter((segment) => pattern.test(segment));
  if (relevant.length === 0) return false;
  const nodeSpecific = relevant.filter((segment) => explicitNodeIds.some((explicitNodeId) => segment.includes(explicitNodeId)));
  return nodeSpecific.length === 0 || nodeSpecific.some((segment) => segment.includes(nodeId));
}

function requiredPrerequisiteNodeIds(input: StrategistPlannerInput) {
  const currentGoalNodes = new Set((input.state.resolvedConstraints?.userGoals ?? [])
    .filter((goal) => !goal.id.startsWith("campaign-goal-"))
    .map((goal) => goal.nodeId));
  const allowed = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of input.state.resolvedConstraints?.deterministicFacts.requiredEdges ?? []) {
      if ((currentGoalNodes.has(edge.to) || allowed.has(edge.to)) && !currentGoalNodes.has(edge.from) && !allowed.has(edge.from)) {
        allowed.add(edge.from);
        changed = true;
      }
    }
  }
  return allowed;
}

function simulatorProvenSystemNodeIds(input: StrategistPlannerInput) {
  const proven = new Set<string>();
  for (const observation of input.state.observations) {
    if (observation.type !== "simulation") continue;
    const comparison = asRecord(observation.comparison);
    const required = comparison?.requiredSystemNodeIds;
    if (!Array.isArray(required)) continue;
    for (const nodeId of required) {
      if (typeof nodeId === "string") proven.add(nodeId);
    }
  }
  return proven;
}

function normalizeStrategyBrief(
  brief: z.infer<typeof strategistPlannerTurnSchema>["strategyBrief"],
  input: StrategistPlannerInput,
) {
  if (!brief || !input.state.resolvedConstraints) return brief;
  const requiredUserGoals = input.state.resolvedConstraints.userGoals.map((goal) => ({
    id: goal.id,
    nodeId: goal.nodeId,
    source: "user" as const,
    requestedGoalDepth: goal.requestedGoalDepth,
  }));
  const requiredUserNodes = new Set(requiredUserGoals.map((goal) => goal.nodeId));
  const allowedSystemNodes = new Set([...requiredPrerequisiteNodeIds(input), ...simulatorProvenSystemNodeIds(input)]);
  const systemGoals = brief.softGoals.filter((goal) => goal.source === "system"
    && !requiredUserNodes.has(goal.nodeId)
    && allowedSystemNodes.has(goal.nodeId));
  const retainedGoalIds = new Set([...requiredUserGoals, ...systemGoals].map((goal) => goal.id));
  return strategistStrategyBriefSchema.parse({
    ...brief,
    softGoals: [...requiredUserGoals, ...systemGoals],
    degradationLadder: brief.degradationLadder.filter((step) => retainedGoalIds.has(step.goalId)),
  });
}

function normalizePlannerTurn(turn: z.infer<typeof strategistPlannerTurnSchema>, input: StrategistPlannerInput) {
  return strategistPlannerTurnSchema.parse({
    ...turn,
    strategyBrief: normalizeStrategyBrief(turn.strategyBrief, input),
    ...(turn.action.type === "simulate_campaign_plan" ? {
      action: {
        ...turn.action,
        candidates: turn.action.candidates.map((candidate) => normalizeCandidate(candidate, input)),
      },
    } : {}),
  });
}

function plannerTurnSchemaFor(input: StrategistPlannerInput) {
  const plans = currentRoutePlans(input.context);
  const explicitGoals = (input.state.resolvedConstraints?.userGoals ?? [])
    .filter((goal) => !goal.id.startsWith("campaign-goal-"));
  return strategistPlannerTurnSchema.superRefine((turn, context) => {
    if (turn.action.type !== "simulate_campaign_plan") return;
    turn.action.candidates.forEach((candidate, candidateIndex) => {
      for (const goal of explicitGoals) {
        if (goal.priority === 100 && plans.get(goal.nodeId)?.priority !== goal.priority
          && !candidate.nodeOperations.some((operation) => operation.type === "set_node_priority"
            && operation.nodeId === goal.nodeId && operation.priority === goal.priority)) {
          context.addIssue({
            code: "custom",
            path: ["action", "candidates", candidateIndex, "nodeOperations"],
            message: `Candidate must implement the explicit ${goal.nodeId} priority target with set_node_priority=${goal.priority}.`,
          });
        }
        const currentDepth = plans.get(goal.nodeId)?.goalDepth ?? "mastery";
        if (currentDepth !== goal.requestedGoalDepth
          && !candidate.goalDepth.some((entry) => entry.nodeId === goal.nodeId && entry.goalDepth === goal.requestedGoalDepth)) {
          context.addIssue({
            code: "custom",
            path: ["action", "candidates", candidateIndex, "goalDepth"],
            message: `Candidate must implement the explicit ${goal.nodeId} goalDepth target in the dedicated goalDepth array.`,
          });
        }
      }
    });
  });
}

async function completeValidated<T>(input: {
  transport: ProductionStrategistTransport;
  model: string;
  messages: readonly Readonly<{ role: "system" | "user"; content: string }>[];
  schema: z.ZodType<T>;
  maxTokens: number;
  allowRepair: boolean;
  providerStage: Exclude<StrategistProviderStage, "schema_repair">;
  endpointHost: string | null;
}): Promise<{ value: T; audit: StrategistProviderAudit }> {
  const schemaMessage = {
    role: "user" as const,
    content: `OUTPUT JSON SCHEMA\n${JSON.stringify(z.toJSONSchema(input.schema))}\nFORMAT CONSTRAINTS\nFor a planner candidate, nodeOperations MUST NOT contain set_goal_depth or set_target_by_date. Represent those exact changes in the candidate goalDepth and targetByDate arrays. goalDepth values are exactly mastery or exposure.`,
  };
  const messages = [...input.messages, schemaMessage];
  const results: ProductionStrategistTransportResult[] = [];
  let first: ProductionStrategistTransportResult;
  const firstStartedAt = Date.now();
  try {
    first = await input.transport.complete({ model: input.model, messages, maxTokens: input.maxTokens });
  } catch (error) {
    const failure = transportFailure(error, Date.now() - firstStartedAt);
    throw new ProductionStrategistProviderError("Production Strategist model call failed.", "provider_failed", {
      modelCallCount: 1, schemaRepairCount: 0, latencyMs: failure.latencyMs, inputTokens: 0, outputTokens: 0,
    }, {
      providerStage: input.providerStage,
      ...failure,
      modelName: input.model,
      endpointHost: input.endpointHost,
      schemaIssuePaths: [],
      schemaIssues: [],
      outputShape: [],
      finishReason: null,
      responseChars: 0,
      jsonFailureKind: null,
      repairAttempted: false,
    }, { cause: error });
  }
  results.push(first);
  try {
    return { value: input.schema.parse(parseJson(first.content)), audit: audit(results) };
  } catch (firstError) {
    if (!input.allowRepair) {
      throw new ProductionStrategistProviderError("Production Strategist structured output was invalid.", "invalid_structured_output", audit(results), {
        providerStage: input.providerStage,
        safeErrorCode: firstError instanceof SyntaxError ? "invalid_json" : "schema_validation_failed",
        httpStatus: null,
        modelName: input.model,
        endpointHost: input.endpointHost,
        latencyMs: audit(results).latencyMs,
        timeoutType: null,
        schemaIssuePaths: schemaIssuePaths(firstError),
        schemaIssues: schemaIssues(firstError, first.content),
        outputShape: outputShape(first.content),
        finishReason: first.finishReason ?? null,
        responseChars: first.content.length,
        jsonFailureKind: jsonFailureKind(first.content, firstError),
        responseEmpty: false,
        repairAttempted: false,
      }, { cause: firstError });
    }
    const issueSummary = firstError instanceof z.ZodError
      ? firstError.issues
        .map((issue) => `${issue.path.join(".")}:${issue.code}:${issue.message.slice(0, 200)}`)
        .slice(0, 12)
        .join(";")
      : "invalid_json";
    const parseFailureKind = jsonFailureKind(first.content, firstError);
    const repairGuidance = parseFailureKind
      ? "The previous response was not complete JSON. Regenerate the entire object from the schema, keep public text concise, and do not use markdown fences."
      : firstError instanceof z.ZodError
      && firstError.issues.some((issue) => issue.path.slice(0, 2).join(".") === "strategyBrief.degradationLadder")
      ? "The degradationLadder is optional; set strategyBrief.degradationLadder to [] in the repaired object."
      : firstError instanceof z.ZodError
        && firstError.issues.some((issue) => issue.message.includes("explicit") && issue.message.includes("priority target"))
        ? "Add the exact reported set_node_priority operation to every candidate; preserve all other valid fields."
      : firstError instanceof z.ZodError
        && firstError.issues.some((issue) => issue.path.join(".").includes("nodeOperations"))
        ? "Move set_goal_depth entries into candidate.goalDepth and set_target_by_date entries into candidate.targetByDate; do not change their node id or value."
        : "Correct only the reported schema violations.";
    let repaired: ProductionStrategistTransportResult;
    const repairStartedAt = Date.now();
    try {
      repaired = await input.transport.complete({
        model: input.model,
        maxTokens: input.maxTokens,
        messages: [
          ...messages,
          { role: "user", content: parseFailureKind
            ? `The previous response failed JSON parsing (${parseFailureKind}). ${repairGuidance} Return one corrected JSON object only.`
            : `The previous JSON failed schema validation (${issueSummary}). ${repairGuidance} Return one corrected JSON object only. Previous JSON to repair:\n${first.content.slice(0, 4_000)}` },
        ],
      });
    } catch (error) {
      const partial = audit(results);
      const failure = transportFailure(error, Date.now() - repairStartedAt);
      throw new ProductionStrategistProviderError("Production Strategist schema-repair call failed.", "provider_failed", {
        ...partial,
        modelCallCount: 2,
        schemaRepairCount: 1,
        latencyMs: partial.latencyMs + failure.latencyMs,
      }, {
        providerStage: "schema_repair",
        ...failure,
        modelName: input.model,
        endpointHost: input.endpointHost,
        schemaIssuePaths: schemaIssuePaths(firstError),
        schemaIssues: schemaIssues(firstError, first.content),
        outputShape: outputShape(first.content),
        finishReason: first.finishReason ?? null,
        responseChars: first.content.length,
        jsonFailureKind: jsonFailureKind(first.content, firstError),
        repairAttempted: true,
      }, { cause: error });
    }
    results.push(repaired);
    try {
      return { value: input.schema.parse(parseJson(repaired.content)), audit: audit(results) };
    } catch (error) {
      throw new ProductionStrategistProviderError("Production Strategist structured output remained invalid after one repair.", "invalid_structured_output", audit(results), {
        providerStage: "schema_repair",
        safeErrorCode: error instanceof SyntaxError ? "invalid_json_after_repair" : "schema_validation_failed_after_repair",
        httpStatus: null,
        modelName: input.model,
        endpointHost: input.endpointHost,
        latencyMs: audit(results).latencyMs,
        timeoutType: null,
        schemaIssuePaths: schemaIssuePaths(error),
        schemaIssues: schemaIssues(error, repaired.content),
        outputShape: outputShape(repaired.content),
        finishReason: repaired.finishReason ?? null,
        responseChars: repaired.content.length,
        jsonFailureKind: jsonFailureKind(repaired.content, error),
        responseEmpty: false,
        repairAttempted: true,
      }, { cause: error });
    }
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You extract bounded planning constraints for PatternCoach Campaign.
Return exactly one JSON object matching the requested schema. Today scope is enforced deterministically after extraction; set scope=future_route and never infer permission to edit Today.
Preserve every explicit user learning goal and map it only to a supplied node id. Never invent calendar data. dailyCaps must be >=3. Do not emit reasoning, scratchpads, prompts, task slugs, mastery writes, or settlement writes.`;

const PLANNER_SYSTEM_PROMPT = `You are PatternCoach's production Campaign Strategist operating one bounded Plan-and-Execute turn.
Return exactly one JSON object with at most one action from allowedActions.
On the first turn include StrategyBrief; later turns must omit it. Preserve all user goals. The degradation ladder must remove system goals first (L1), then downgrade user mastery goals to exposure (L2), then request clarification. Never remove a user goal.
Degradation steps are optional. On the first turn, when there is no rejected simulation Observation, strategyBrief.degradationLadder MUST be an empty array. Every remove_system_goal step must reference a softGoals entry with source=system. Every downgrade_user_goal_to_exposure step must reference a softGoals entry with source=user and requestedGoalDepth=mastery. Never add a downgrade step for a goal already at exposure. Omit any ineligible step, and place every L1 step before every L2 step.
Candidates contain only node operations, goalDepth, targetByDate, daily budget suggestions, and a public rationale. Never choose problem slugs, daily node schedules, mastery, settlement, Patch status, resulting versions, or auto-approval.
Treat active route nodes as background constraints, not as requested goals. Current-request goals are resolvedConstraints.userGoals whose id does not start with campaign-goal-. Candidate changes may target only those explicit goals, their required prerequisites, and nodes present in repairSummary.top. Never copy unchanged active route fields into a candidate, and never emit set_node_included=true or goalDepth=mastery merely because those values already appear in the active route.
calendar_freebusy is available only when explicitly listed in allowedActions. It may only look for an optional relaxation to ask the user about; never convert free time into question capacity, overwrite daily caps, or finalize a Calendar-based budget suggestion before user confirmation.
Read structured Observations before choosing the next action. Never submit a candidate whose fingerprint-equivalent plan already has a simulation or duplicate_candidate Observation. ladderRevision is optional and may appear at most once; omit it when ladderRevisionCount is already 1 or the assumption was already overturned. If any simulation Observation is accepted, the next action must be finalize with that exact candidateId; this rule also applies in simulation runMode, where Runtime completes without creating a Patch. finalize may reference only a previously simulated accepted candidate. Do not emit private reasoning or scratchpads.`;

export class ProductionStrategistPlannerProvider implements StrategistPlannerProvider, StrategistConstraintExtractor {
  readonly name: string;
  readonly modelAlias: string;
  private readonly transport: ProductionStrategistTransport;
  private readonly endpointHost: string | null;

  constructor(options: { client?: OpenAI; transport?: ProductionStrategistTransport; model?: string } = {}) {
    this.modelAlias = options.model ?? getStrategistModel();
    this.name = `openai-compatible-strategist-runtime:${this.modelAlias}`;
    const client = options.transport ? null : options.client ?? createStrategistClient();
    this.transport = options.transport ?? openAiTransport(client!);
    this.endpointHost = client ? endpointHost(client) : null;
  }

  async extractConstraints(input: StrategistConstraintExtractionInput) {
    const todayScope = classifyStrategistTodayScope(input.requestText);
    const result = await completeValidated({
      transport: this.transport,
      model: this.modelAlias,
      schema: extractedConstraintsSchema,
      maxTokens: 1_400,
      allowRepair: true,
      providerStage: "constraint_extraction",
      endpointHost: this.endpointHost,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: `Schema version: ${STRATEGIST_RUNTIME_SCHEMA_VERSION}.\nUser request: ${input.requestText ?? "Automatic future-route review."}\nFixed context and allowed nodes:\n${canonicalStrategistJson(input.context)}\nDeterministic control facts (copy neither identity nor hidden data into rationale):\n${canonicalStrategistJson(input.deterministicFacts)}` },
      ],
    });
    const extractedValue = normalizeExtractedPlanningWindow(result.value, input);
    const allowedNodeIds = new Set(input.deterministicFacts.nodeIds);
    const invalidGoal = extractedValue.userGoals.find((goal) => !allowedNodeIds.has(goal.nodeId));
    if (invalidGoal) throw new Error(`Constraint extraction referenced an unknown Campaign node: ${invalidGoal.nodeId}`);
    if (extractedValue.horizonEnd && (extractedValue.horizonEnd < input.deterministicFacts.planningHorizon.start
      || extractedValue.horizonEnd > input.deterministicFacts.planningHorizon.end)) {
      throw new Error("Constraint extraction returned a horizon outside deterministic Campaign bounds.");
    }
    if (extractedValue.dailyCaps.some((cap) => cap.campaignDate < input.deterministicFacts.planningHorizon.start
      || cap.campaignDate > input.deterministicFacts.planningHorizon.end)) {
      throw new Error("Constraint extraction returned a daily cap outside deterministic Campaign bounds.");
    }
    return {
      constraints: strategistResolvedConstraintsSchema.parse({
        ...extractedValue,
        scope: todayScope.scope,
        userGoals: extractedValue.userGoals,
        deterministicFacts: input.deterministicFacts,
      }),
      audit: result.audit,
    };
  }

  async next(input: StrategistPlannerInput): Promise<StrategistPlannerProviderResponse> {
    const remainingAfterThisDecision = input.state.budgetSnapshot.plannerDecisions.limit
      - input.state.budgetSnapshot.plannerDecisions.used;
    const result = await completeValidated({
      transport: this.transport,
      model: this.modelAlias,
      schema: plannerTurnSchemaFor(input),
      maxTokens: 4_000,
      allowRepair: remainingAfterThisDecision >= 1,
      providerStage: "planner_action",
      endpointHost: this.endpointHost,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: canonicalStrategistJson({
          runtimeVersion: input.state.runtimeVersion,
          runMode: input.state.runMode,
          fixedContext: input.context,
          resolvedConstraints: input.state.resolvedConstraints,
          strategyBrief: input.state.strategyBrief,
          ladderState: input.state.ladderState,
          candidates: input.state.candidates,
          rejectedCandidates: input.state.rejectedCandidates,
          observations: input.state.observations,
          calendarObservation: input.state.calendarObservation,
          calendarFailures: input.state.calendarFailures,
          calendarConfirmationRequired: input.state.calendarConfirmationRequired,
          externalDataAsOf: input.state.externalDataAsOf,
          externalDataValidUntil: input.state.externalDataValidUntil,
          externalSourceDigest: input.state.externalSourceDigest,
          clarificationResponse: input.state.clarificationResponse,
          budgetSnapshot: input.state.budgetSnapshot,
          allowedActions: input.allowedActions ?? ["simulate_campaign_plan", "request_clarification", "finalize"],
        }) },
      ],
    });
    return { output: normalizePlannerTurn(result.value, input), audit: result.audit };
  }
}
