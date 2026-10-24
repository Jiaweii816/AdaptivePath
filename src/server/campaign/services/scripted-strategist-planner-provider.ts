import type {
  StrategistResolvedConstraints,
  StrategistPlannerTurn,
  StrategistRuntimeContext,
  StrategistRuntimeState,
} from "../domain";

export type StrategistPlannerInput = Readonly<{
  context: StrategistRuntimeContext;
  state: StrategistRuntimeState;
  allowedActions?: readonly ("simulate_campaign_plan" | "calendar_freebusy" | "request_clarification" | "finalize")[];
}>;

export type StrategistProviderAudit = Readonly<{
  modelCallCount: number;
  schemaRepairCount: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}>;

export type StrategistPlannerProviderResponse = Readonly<{
  output: unknown;
  audit: StrategistProviderAudit;
}>;

export type StrategistConstraintExtractionInput = Readonly<{
  context: StrategistRuntimeContext;
  requestText: string | null;
  deterministicFacts: StrategistResolvedConstraints["deterministicFacts"];
}>;

export interface StrategistConstraintExtractor {
  extractConstraints(input: StrategistConstraintExtractionInput): Promise<Readonly<{
    constraints: StrategistResolvedConstraints;
    audit: StrategistProviderAudit;
  }>>;
}

export interface StrategistPlannerProvider {
  readonly name: string;
  readonly modelAlias: string;
  next(input: StrategistPlannerInput): Promise<unknown>;
}

export type ScriptedStrategistStep =
  | unknown
  | ((input: StrategistPlannerInput) => unknown | Promise<unknown>);

/** A deterministic, offline fixture provider. It intentionally returns unknown
 * so tests can prove malformed actions fail at the Runtime schema boundary. */
export class ScriptedStrategistPlannerProvider implements StrategistPlannerProvider {
  readonly name = "scripted-strategist";
  readonly modelAlias = "scripted-strategist-v1";
  private index = 0;

  constructor(
    private readonly steps: readonly ScriptedStrategistStep[],
    private readonly hooks: Readonly<{ onDecision?: (input: StrategistPlannerInput, index: number) => void }> = {},
  ) {}

  get decisionCount() {
    return this.index;
  }

  async next(input: StrategistPlannerInput): Promise<unknown> {
    const index = this.index;
    const step = this.steps[index];
    if (step === undefined) throw new Error("Scripted Strategist trajectory is exhausted.");
    this.index += 1;
    this.hooks.onDecision?.(structuredClone(input), index);
    return typeof step === "function" ? step(input) : step;
  }
}

export type { StrategistPlannerTurn };
