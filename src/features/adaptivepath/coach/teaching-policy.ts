/**
 * Teaching policy (spec §7.2 + §4.2): intent × level × phase × memory signals →
 * which tools must run, which the model may call, and how the reply should sound.
 */
import { selectCoachTool, type BiologyCoachTool } from "../memory/coach-policy";
import type { CoachPhase, ClassifiedTurn, IntentKind } from "./intents";
import type { MemorySignals } from "./memory-signals";

export type ToolName =
  | "search_textbook" | "get_question_evidence" | "get_concept_card"
  | "get_learner_status" | "diagnose_reasoning" | "get_attempt_review";
export type StyleKey =
  | "depth_worked_example" | "depth_hint_ladder" | "depth_reference" | "depth_socratic"
  | "explain_concept" | "hint" | "probe_diagnosis" | "elicit_first_step" | "refuse_answer" | "cite_textbook"
  | "learner_status_qualitative" | "why_this_question" | "off_topic_redirect" | "review_attempt"
  | "prerequisite_detour" | "anchor_bridge" | "fade_help" | "empathize_first";
export type DraftState = "empty" | "option_only" | "reasoning";
export type PlannedCall = Readonly<{ name: ToolName; args: Readonly<Record<string, unknown>> }>;
export type TeachingPlan = Readonly<{
  requiredCalls: readonly PlannedCall[];
  optionalTools: readonly ToolName[];
  styleKeys: readonly StyleKey[];
  hintStep: 1 | 2 | 3 | null;
  requireCitation: boolean;
  anchorConceptId: string | null;
  prerequisiteConceptId: string | null;
  policyId: string;
}>;
export type PlanInput = Readonly<{
  turn: ClassifiedTurn;
  phase: CoachPhase;
  signals: MemorySignals;
  draftState: DraftState;
  priorHintTurns: number;
  firstTurnOnQuestion: boolean;
}>;

export const POLICY_VERSION = "bio-coach-v1";
const LAST_HINT_STEP = 3;
const HINT_LADDER_LEVEL = 1;
const DEPTH_BY_TOOL: Readonly<Record<BiologyCoachTool, StyleKey>> = {
  worked_example: "depth_worked_example",
  guided_hint: "depth_hint_ladder",
  reference_pointer: "depth_reference",
  socratic_probe: "depth_socratic",
};
const DETOUR_INTENTS: ReadonlySet<IntentKind> = new Set(["explain_concept", "question_hint", "check_reasoning", "request_answer"]);
const ANCHOR_INTENTS: ReadonlySet<IntentKind> = new Set(["explain_concept", "question_hint"]);
const HINT_INTENTS: ReadonlySet<IntentKind> = new Set(["question_hint", "request_answer"]);
const CITATION_INTENTS: ReadonlySet<IntentKind> = new Set(["explain_concept", "locate_textbook"]);

type Part = Readonly<{ required: PlannedCall[]; optional: ToolName[]; style: StyleKey[] }>;
type Intent = ClassifiedTurn["intents"][number];
type RuleInput = Readonly<{ intent: Intent; query: string; hasDraft: boolean }>;

const call = (name: ToolName, args: Record<string, unknown> = {}): PlannedCall => ({ name, args });
const diagnoseIf = (hasDraft: boolean): PlannedCall[] => (hasDraft ? [call("diagnose_reasoning")] : []);
const search = ({ intent, query }: RuleInput) => call("search_textbook", intent.conceptId ? { query, conceptIds: [intent.conceptId] } : { query });

const INTENT_RULES: Readonly<Record<IntentKind, (input: RuleInput) => Part>> = {
  explain_concept: (i) => ({ required: [search(i)], optional: ["search_textbook", "get_concept_card"], style: ["explain_concept", "cite_textbook"] }),
  question_hint: (i) => ({
    required: [call("get_question_evidence"), ...diagnoseIf(i.hasDraft)], optional: ["get_concept_card"],
    style: i.hasDraft ? ["hint", "probe_diagnosis"] : ["hint"],
  }),
  check_reasoning: (i) => i.hasDraft
    ? { required: [call("diagnose_reasoning")], optional: ["get_question_evidence"], style: ["probe_diagnosis"] }
    : { required: [], optional: ["get_question_evidence"], style: ["elicit_first_step"] },
  locate_textbook: (i) => ({ required: [call("get_question_evidence"), search(i)], optional: [], style: ["cite_textbook"] }),
  request_answer: (i) => ({
    required: diagnoseIf(i.hasDraft), optional: ["get_question_evidence"],
    style: i.hasDraft ? ["refuse_answer", "probe_diagnosis"] : ["refuse_answer"],
  }),
  learner_status: () => ({ required: [call("get_learner_status")], optional: ["get_concept_card"], style: ["learner_status_qualitative"] }),
  why_this_question: () => ({ required: [], optional: [], style: ["why_this_question"] }),
  off_topic: () => ({ required: [], optional: [], style: ["off_topic_redirect"] }),
  review_attempt: () => ({ required: [], optional: [], style: ["review_attempt"] }),
};

function unique<T>(items: readonly T[], key: (item: T) => string = String): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function hasAny(turn: ClassifiedTurn, kinds: ReadonlySet<IntentKind>): boolean {
  return turn.intents.some((i) => kinds.has(i.kind));
}

function hintStepFor(input: PlanInput): 1 | 2 | 3 | null {
  if (input.signals.level !== HINT_LADDER_LEVEL || !hasAny(input.turn, HINT_INTENTS)) return null;
  if (input.turn.intents.some((i) => i.kind === "request_answer")) return LAST_HINT_STEP;
  const anxiousBoost = input.turn.affect === "anxious_stuck" ? 1 : 0;
  return Math.min(input.priorHintTurns + 1 + anxiousBoost, LAST_HINT_STEP) as 1 | 2 | 3;
}

/** §4.2 background rules: they change what the coach does, never what it says about the learner. */
function memoryOverlay(input: PlanInput): Part & { prerequisite: string | null; anchor: string | null } {
  const { signals, turn } = input;
  const prerequisite = signals.prerequisiteGap && hasAny(turn, DETOUR_INTENTS) ? signals.prerequisiteGap : null;
  const anchor = signals.anchor && hasAny(turn, ANCHOR_INTENTS) ? signals.anchor : null;
  const fade = input.phase === "current_question" && signals.reliesOnTutor && input.firstTurnOnQuestion && input.draftState === "empty";
  const style: StyleKey[] = [
    ...(turn.affect === "anxious_stuck" ? ["empathize_first" as const] : []),
    ...(prerequisite ? ["prerequisite_detour" as const] : []),
    ...(anchor ? ["anchor_bridge" as const] : []),
    ...(fade ? ["fade_help" as const] : []),
  ];
  return { required: prerequisite ? [call("get_concept_card", { conceptId: prerequisite })] : [], optional: [], style, prerequisite, anchor };
}

export function planTeachingTurn(input: PlanInput): TeachingPlan {
  const hasDraft = input.draftState !== "empty";
  const parts = input.turn.intents.map((intent) => INTENT_RULES[intent.kind]({ intent, query: input.turn.textbookQuery, hasDraft }));
  const overlay = memoryOverlay(input);
  const review = input.phase === "submitted_attempt" ? [call("get_attempt_review")] : [];
  const depth = DEPTH_BY_TOOL[selectCoachTool([input.signals.level])];
  return {
    requiredCalls: unique([...review, ...parts.flatMap((p) => p.required), ...overlay.required], (c) => `${c.name}:${JSON.stringify(c.args)}`),
    optionalTools: unique(parts.flatMap((p) => p.optional)),
    styleKeys: unique([depth, ...overlay.style, ...parts.flatMap((p) => p.style)]),
    hintStep: hintStepFor(input),
    requireCitation: hasAny(input.turn, CITATION_INTENTS),
    anchorConceptId: overlay.anchor,
    prerequisiteConceptId: overlay.prerequisite,
    policyId: `${POLICY_VERSION}:${input.turn.intents.map((i) => i.kind).join("+")}`,
  };
}
