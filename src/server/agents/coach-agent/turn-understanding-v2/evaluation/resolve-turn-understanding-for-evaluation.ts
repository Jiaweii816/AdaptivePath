import { buildSemanticBackendFacts } from "../../turn-classifier/semantic-backend-facts";
import { validateModelAssemblyProposal } from "../../turn-classifier/validate-semantic-turn-proposal";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

import { assembleWithModel } from "../assembler/model-assembler";
import { compileTurnUnderstandingV2 } from "../compile-turn-understanding-v2";
import { collectTurnEvidence } from "../evidence/collect-turn-evidence";
import type { TurnUnderstandingV2 } from "../turn-understanding-v2.types";

export type EvaluationTurn = Readonly<{
  message: string;
  workspace: { hasCurrentCode: boolean; hasAssistantCandidate: boolean };
  recordedAssembly?: unknown;
}>;

/** Runs the same deterministic → assembler → validator boundary with a local recording. */
export async function resolveTurnUnderstandingForEvaluation(
  turn: EvaluationTurn,
): Promise<TurnUnderstandingV2> {
  const deterministic = compileTurnUnderstandingV2(turn.message, {
    workspace: turn.workspace,
  });
  if (deterministic.route.kind !== "model_assembled" || !turn.recordedAssembly) {
    return deterministic;
  }
  const assembled = await assembleWithModel(assemblerInput(turn, deterministic), {
    client: { complete: async () => JSON.stringify(turn.recordedAssembly) },
  });
  if (!assembled.ok) return deterministic;
  const validated = validateModelAssemblyProposal(
    assembled.output,
    backendFacts(turn, deterministic),
    deterministic,
  );
  return validated.ok ? validated.understanding : deterministic;
}

function assemblerInput(turn: EvaluationTurn, deterministic: TurnUnderstandingV2) {
  return {
    message: turn.message,
    clauses: deterministic.clauses,
    evidence: collectTurnEvidence(deterministic.clauses),
    workspace: turn.workspace,
    projection: "",
  };
}

function backendFacts(turn: EvaluationTurn, deterministic: TurnUnderstandingV2) {
  return buildSemanticBackendFacts({
    message: turn.message,
    deterministic,
    requestedActions: resolveRequestedActions(turn.message),
    language: "Python",
    ...turn.workspace,
  });
}
