import type { CoachChatIntent, CoachCodeDisclosure } from "../coach-agent.types";

export type OperationFamily =
  | "answer"
  | "lookup_api"
  | "diagnose"
  | "execute"
  | "optimize"
  | "recall"
  | "profile_meta"
  | "recommend"
  | "persist";

export type OperationTarget =
  | "current_user_code"
  | "assistant_candidate"
  | "current_approach"
  | "active_problem"
  | "concept"
  | "api_object"
  | "past_problem"
  | "past_mistake"
  | "learner_profile"
  | "practice_problem"
  | "preference"
  | "knowledge_handbook"
  | "mistake_book"
  | "contextual_referent"
  | "unspecified";

export type SignalEvidence = {
  kind: string;
  span: string;
  strength: "hard" | "soft";
  polarity: "positive" | "negative";
};

export type Operation = {
  id: string;
  family: OperationFamily;
  target: OperationTarget;
  topic?: "concept" | "api" | "general";
  sourceClauseId: string;
  orderHint?: number;
  dependsOn: string[];
  evidence: SignalEvidence[];
  resolution: "explicit" | "contextual" | "ambiguous";
};

export type TurnModifiers = {
  codeDisclosure: {
    level: CoachCodeDisclosure;
    source:
      | "default"
      | "stored_preference"
      | "explicit_allow"
      | "explicit_deny"
      | "explicit_correction";
  };
  affect: "none" | "anxious_stuck";
  deliveryMode: "direct" | "hint";
  requestedArtifact: "explanation" | "pseudocode" | "full_implementation";
  requestedCount?: number;
};

export type TurnClause = {
  id: string;
  text: string;
  connectorBefore?: "and" | "then" | "but" | "meanwhile";
};

export type TurnUnderstanding = {
  route: "fast_path" | "llm";
  clauses: TurnClause[];
  operations: Operation[];
  modifiers: TurnModifiers;
  discourseMarkers: SignalEvidence[];
  negationSignals: SignalEvidence[];
  learnerStateSignals: SignalEvidence[];
  unsupportedScope: { languageMention?: string };
  ambiguity: {
    blocksSideEffect: boolean;
    unresolvedOperationIds: string[];
  };
  legacyPrimaryIntent?: CoachChatIntent;
};
