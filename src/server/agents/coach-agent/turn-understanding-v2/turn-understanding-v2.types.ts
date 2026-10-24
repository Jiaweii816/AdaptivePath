import type { CoachCodeDisclosure } from "../coach-agent.types";
import type { SignalEvidence as LegacySignalEvidence } from "../turn-understanding/turn-understanding.types";

import type { TurnCoverage } from "./coverage/turn-coverage";
import type { CategoryDenial } from "./evidence/intent-evidence.types";

export type Deliverable =
  | "solve"
  | "fix"
  | "understand"
  | "improve"
  | "recall"
  | "recommend"
  | "chat";

export type ResponseTarget = "current" | "concept" | "api";

export type BasisSource =
  | "current_evidence"
  | "past_problems"
  | "past_mistakes"
  | "learner_profile"
  | "concept_kb"
  | "api_kb"
  | "practice_catalog";

export type DeliveryDepth = "hint" | "normal" | "full";
export type DeliveryForm = "prose" | "pseudocode" | "patch" | "trace";

/** Exact source evidence; offsets use JavaScript UTF-16 indexes and `end` is exclusive. */
export type SignalEvidence = LegacySignalEvidence & {
  readonly start: number;
  readonly end: number;
  readonly sourceClauseId?: string;
};

export type TurnClauseConnector = "and" | "then" | "but" | "meanwhile";

/** A span-preserving parsing aid. Clause count never decides routing by itself. */
export type TurnClauseV2 = {
  readonly id: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly connectorBefore?: TurnClauseConnector;
};

export type ResponseDelivery = {
  readonly depth: DeliveryDepth;
  readonly form: DeliveryForm;
  readonly count?: number;
};

type RequestEvidence = {
  readonly id: string;
  readonly sourceClauseIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly evidence: readonly SignalEvidence[];
};

export type RespondTurnRequest = RequestEvidence & {
  readonly kind: "respond";
  readonly deliverable: Deliverable;
  readonly target: ResponseTarget;
  /** `current_evidence` is mandatory; other sources are explicit additive context. */
  readonly basis: readonly BasisSource[];
  readonly delivery: ResponseDelivery;
};

export type ExecuteTurnRequest = RequestEvidence & {
  readonly kind: "execute";
  readonly target: "current" | "candidate";
  /** `explicit_grant` comes from deterministic evidence and enters the required
   *  action ledger. `model_proposed` only exposes the tool: it is Tier 1, so a
   *  wrong call costs sandbox compute but changes no durable state. */
  readonly authorization: "explicit_grant" | "model_proposed";
};

export type PersistTurnRequest = RequestEvidence & {
  readonly kind: "persist";
  readonly collection: "preference" | "knowledge_handbook" | "mistake_book";
  /** Verbatim learner-authored clause. The compiler never rewrites this content. */
  readonly content: string;
  readonly authorization: "ledger_granted";
};

export type TurnRequest =
  | RespondTurnRequest
  | ExecuteTurnRequest
  | PersistTurnRequest;

export type DisclosureCeiling = {
  readonly ceiling: CoachCodeDisclosure;
  readonly source:
    | "default"
    | "stored_preference"
    | "explicit_allow"
    | "explicit_deny"
    | "explicit_correction";
};

export type EffectDenial = {
  readonly effect: "execute" | "persist";
  readonly sourceClauseIds: readonly string[];
  readonly evidence: readonly SignalEvidence[];
};

export type PythonOnlyScope = {
  readonly supportedLanguage: "python";
  readonly unsupportedLanguage?: SignalEvidence;
};

export type TurnDiscourse = {
  readonly repeatSignals: readonly SignalEvidence[];
  readonly continuationSignals: readonly SignalEvidence[];
  readonly referentSignals: readonly SignalEvidence[];
};

export type ClarificationReason =
  | "backend_target_missing"
  | "effect_target_unresolved"
  | "effect_authorization_unresolved"
  | "effect_scope_conflict"
  | "side_effect_candidate_conflict";

export type EscalationReason = "low_coverage" | "effect_ambiguity";

export type TurnRoute =
  | {
      readonly kind: "fast_path";
      readonly escalationReasons: readonly [];
    }
  | {
      readonly kind: "model_assembled";
      readonly escalationReasons: readonly EscalationReason[];
    }
  | {
      readonly kind: "clarify";
      readonly escalationReasons: readonly [];
      readonly clarificationReason: ClarificationReason;
    };

export type TurnUnderstandingV2 = {
  readonly schemaVersion: "v2";
  readonly clauses: readonly TurnClauseV2[];
  /** Observe-only until the model-assembler phase consumes unknown turns. */
  readonly coverage: TurnCoverage;
  readonly requests: readonly TurnRequest[];
  readonly disclosure: DisclosureCeiling;
  /** Generalized denial evidence; effectDenials remains for legacy consumers. */
  readonly categoryDenials: readonly CategoryDenial[];
  readonly effectDenials: readonly EffectDenial[];
  readonly languageScope: PythonOnlyScope;
  readonly affect: "none" | "anxious_stuck";
  readonly discourse: TurnDiscourse;
  readonly route: TurnRoute;
};
