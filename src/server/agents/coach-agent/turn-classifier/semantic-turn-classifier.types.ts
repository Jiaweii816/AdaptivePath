import type { TraceContext } from "@/server/llm/trace-context";
import type { CodeRunnerLanguage } from "@/types/code-runner";

import type { TurnUnderstandingV2 } from "../turn-understanding-v2/turn-understanding-v2.types";
import type { SemanticClassifierOutput } from "./semantic-classifier-output.schema";

export type SemanticSlowPathRoute = Readonly<{
  kind: "semantic_slow_path";
  reason: string;
  /** Effects suspected by the gate but intentionally not authorized/resolved. */
  uncertainEffects?: readonly ("execute" | "persist")[];
}>;

export type SemanticRouteInput = Omit<TurnUnderstandingV2, "route"> & {
  readonly route: TurnUnderstandingV2["route"] | SemanticSlowPathRoute;
};

export type SemanticClassifierWorkspace = Readonly<{
  language?: CodeRunnerLanguage;
  hasCurrentCode: boolean;
  hasAssistantCandidate: boolean;
  selectedTestCount: number;
}>;

export type SemanticClassifierContext = Readonly<{
  message: string;
  projection: string;
  workspace: SemanticClassifierWorkspace;
  deterministic: SemanticRouteInput;
  traceContext?: TraceContext;
}>;

export type SemanticTurnClassifier = Readonly<{
  classify(context: SemanticClassifierContext): Promise<SemanticClassifierOutput>;
}>;
