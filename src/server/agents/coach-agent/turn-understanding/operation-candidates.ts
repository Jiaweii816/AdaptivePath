import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";

import { buildChatTurnPlan } from "../chat-intent-policy";
import type { ChatTurnPlan, CoachChatIntent } from "../coach-agent.types";
import type {
  Operation,
  OperationTarget,
  SignalEvidence,
  TurnClause,
} from "./turn-understanding.types";

export type OperationCandidate = Omit<Operation, "id" | "dependsOn"> & {
  sequence: number;
};
type OperationSpec = Pick<
  Operation,
  "family" | "target" | "topic" | "resolution"
>;

function spec(
  family: Operation["family"],
  target: OperationTarget,
  resolution: Operation["resolution"] = "explicit",
  topic?: Operation["topic"],
): OperationSpec {
  return { family, target, resolution, ...(topic ? { topic } : {}) };
}

const DURABLE_TARGETS = {
  note_memory: "preference",
  save_knowledge_note: "knowledge_handbook",
  save_mistake_book_entry: "mistake_book",
} as const satisfies Record<RequestedAction["toolName"], OperationTarget>;
const EXECUTION_DENIAL =
  /(?:不要|别|禁止).{0,32}(?:运行|跑|执行|验证)|(?:don['’]t|do not|never).{0,40}(?:run|execute|verify|test)/iu;
const CAPABILITY_SPECS: Partial<
  Record<ChatTurnPlan["toolCapabilities"][number], OperationSpec>
> = {
  run_current_code: spec("execute", "current_user_code"),
  verify_proposed_repair: spec("execute", "assistant_candidate"),
  past_problem_recall: spec("recall", "past_problem"),
  past_mistake_recall: spec("recall", "past_mistake"),
  find_practice_problem: spec("recommend", "practice_problem"),
};
const WHOLE_MESSAGE_READ_CAPABILITIES: ReadonlySet<
  ChatTurnPlan["toolCapabilities"][number]
> = new Set([
  "lookup_api_reference",
  "past_problem_recall",
  "past_mistake_recall",
  "find_practice_problem",
]);
const RESPONSE_SPECS: Partial<Record<CoachChatIntent, OperationSpec>> = {
  concept_question: spec("answer", "concept", "explicit", "concept"),
  general_followup: spec(
    "answer",
    "contextual_referent",
    "ambiguous",
    "general",
  ),
  hint_request: spec("answer", "active_problem", "contextual"),
  anxiety_or_stuck: spec("answer", "active_problem", "contextual"),
  full_code_request: spec("answer", "active_problem", "contextual"),
  profile_meta_question: spec("profile_meta", "learner_profile"),
};

function evidence(kind: string, span: string): SignalEvidence {
  return { kind, span, strength: "hard", polarity: "positive" };
}

function appendCandidate(input: {
  candidates: OperationCandidate[];
  operation: OperationSpec;
  clause: TurnClause;
  sequence: number;
  kind: string;
}): void {
  input.candidates.push({
    ...input.operation,
    sourceClauseId: input.clause.id,
    orderHint: input.sequence,
    evidence: [evidence(input.kind, input.clause.text)],
    sequence: input.sequence,
  });
}

function capabilitySpec(
  plan: ChatTurnPlan,
  capability: ChatTurnPlan["toolCapabilities"][number],
): OperationSpec | undefined {
  if (capability !== "lookup_api_reference") {
    return CAPABILITY_SPECS[capability];
  }
  const target =
    plan.signals.handbookLookup && !plan.signals.apiReference
      ? "knowledge_handbook"
      : "api_object";
  return spec("lookup_api", target, "explicit", "api");
}

export function addPlanCandidates(
  candidates: OperationCandidate[],
  plan: ChatTurnPlan,
  clause: TurnClause,
  sequenceBase: number,
  includeGeneral: boolean,
): void {
  let sequence = sequenceBase;
  const add = (operation: OperationSpec, kind: string) =>
    appendCandidate({
      candidates,
      operation,
      clause,
      sequence: sequence++,
      kind,
    });
  const executionDenied = EXECUTION_DENIAL.test(clause.text);
  for (const capability of plan.toolCapabilities) {
    if (executionDenied && capability.startsWith("run_")) continue;
    const operation = capabilitySpec(plan, capability);
    if (operation) add(operation, `legacy_capability:${capability}`);
  }
  if (plan.signals.debug) {
    add(spec("diagnose", "current_user_code"), "legacy_signal:debug");
  }
  if (plan.signals.optimization) {
    add(spec("optimize", "current_user_code"), "legacy_signal:optimization");
  }
  const response = RESPONSE_SPECS[plan.primaryIntent];
  if (
    response &&
    (includeGeneral || plan.primaryIntent !== "general_followup")
  ) {
    add(response, `legacy_intent:${plan.primaryIntent}`);
  }
}

export function addWholeMessageReadCandidates(
  candidates: OperationCandidate[],
  plan: ChatTurnPlan,
  sourceClause: TurnClause,
  sequenceBase: number,
): void {
  let sequence = sequenceBase;
  for (const capability of plan.toolCapabilities) {
    if (!WHOLE_MESSAGE_READ_CAPABILITIES.has(capability)) continue;
    const operation = capabilitySpec(plan, capability);
    if (!operation) continue;
    appendCandidate({
      candidates,
      operation,
      clause: sourceClause,
      sequence: sequence++,
      kind: `whole_message_read:${capability}`,
    });
  }
}

export function addSafeResponseFallback(
  candidates: OperationCandidate[],
  legacy: ChatTurnPlan,
  clause: TurnClause,
): void {
  const response =
    RESPONSE_SPECS[legacy.primaryIntent] ??
    spec("answer", "contextual_referent", "ambiguous", "general");
  appendCandidate({
    candidates,
    operation: response,
    clause,
    sequence: 0,
    kind: `safe_fallback:${legacy.primaryIntent}`,
  });
}

function clauseForAction(
  clauses: readonly TurnClause[],
  action: RequestedAction,
): TurnClause {
  const source = action.evidence[0]?.clause.trim().toLocaleLowerCase();
  return (
    clauses.find((clause) => {
      const text = clause.text.toLocaleLowerCase();
      return source ? text.includes(source) || source.includes(text) : false;
    }) ??
    clauses[0] ?? { id: "c0", text: "" }
  );
}

export function addDurableCandidates(
  candidates: OperationCandidate[],
  clauses: readonly TurnClause[],
  actions: readonly RequestedAction[],
): void {
  for (const action of actions) {
    if (action.decision === "denied") continue;
    const clause = clauseForAction(clauses, action);
    const spans = action.evidence.flatMap((item) =>
      [item.matchedAction, item.matchedTarget].filter((span): span is string =>
        Boolean(span),
      ),
    );
    candidates.push({
      family: "persist",
      target: DURABLE_TARGETS[action.toolName],
      sourceClauseId: clause.id,
      orderHint: action.order,
      evidence: (spans.length > 0 ? spans : [clause.text]).map((span) =>
        evidence(`requested_action:${action.toolName}`, span),
      ),
      resolution: action.decision === "granted" ? "explicit" : "ambiguous",
      sequence: action.order,
    });
  }
}

function deduplicateCandidates(
  candidates: readonly OperationCandidate[],
): OperationCandidate[] {
  const hasBusiness = candidates.some(
    ({ family, target }) => family !== "answer" || target !== "active_problem",
  );
  const deduplicated = new Map<string, OperationCandidate>();
  for (const candidate of candidates) {
    if (
      hasBusiness &&
      candidate.family === "answer" &&
      candidate.target === "active_problem"
    )
      continue;
    const key = `${candidate.family}:${candidate.target}`;
    const existing = deduplicated.get(key);
    if (!existing) deduplicated.set(key, candidate);
    else {
      existing.evidence.push(...candidate.evidence);
      if (
        existing.resolution === "ambiguous" &&
        candidate.resolution !== "ambiguous"
      ) {
        existing.resolution = candidate.resolution;
      }
    }
  }
  return [...deduplicated.values()];
}

export function finalizeCandidates(
  candidates: readonly OperationCandidate[],
  clauses: readonly TurnClause[],
): Operation[] {
  const clauseOrder = new Map(
    clauses.map((clause, index) => [clause.id, index]),
  );
  const ordered = deduplicateCandidates(candidates).sort((left, right) => {
    const clauseDifference =
      (clauseOrder.get(left.sourceClauseId) ?? 0) -
      (clauseOrder.get(right.sourceClauseId) ?? 0);
    return clauseDifference || left.sequence - right.sequence;
  });
  return ordered.map(({ sequence, ...candidate }, index) => {
    void sequence;
    const source = clauses[clauseOrder.get(candidate.sourceClauseId) ?? 0];
    return {
      ...candidate,
      id: `op${index}`,
      dependsOn:
        source?.connectorBefore === "then" && index > 0
          ? [`op${index - 1}`]
          : [],
    };
  });
}

export function collectClauseCandidates(
  candidates: OperationCandidate[],
  clauses: readonly TurnClause[],
): void {
  clauses.forEach((clause, index) => {
    addPlanCandidates(
      candidates,
      buildChatTurnPlan(clause.text),
      clause,
      index * 100,
      false,
    );
  });
}
