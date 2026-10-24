import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import { loadLocalEnv } from "@/lib/env";
import { createMemoryClient } from "@/server/llm/client";
import { withMemoryNonStreamingCompatibility } from "@/server/llm/memory-provider-compat";
import { getChatAssemblerModel } from "@/server/llm/models";
import { z } from "zod";

import type { BootstrappedChatTurn } from "../chat-turn-bootstrap";
import {
  hasSameRevisionAssistantCandidate,
  type ConversationProjection,
} from "../history-projection";
import {
  assembleWithModel,
  type ModelAssemblerClient,
} from "../turn-understanding-v2/assembler/model-assembler";
import type { ModelAssemblerOutput } from "../turn-understanding-v2/assembler/model-assembler.types";
import { modelAssemblerOutputSchema } from "../turn-understanding-v2/assembler/model-assembler.types";
import { collectTurnEvidence } from "../turn-understanding-v2/evidence/collect-turn-evidence";
import type { TurnUnderstandingV2 } from "../turn-understanding-v2/turn-understanding-v2.types";
import { validateModelAssemblyProposal } from "./validate-semantic-turn-proposal";
import type { SemanticClassifierBackendFacts } from "./validate-semantic-turn-proposal";
import { buildSemanticBackendFacts } from "./semantic-backend-facts";

export { buildSemanticBackendFacts } from "./semantic-backend-facts";

const SEMANTIC_PROJECTION_CHAR_LIMIT = 4_000;

export async function resolveChatTurnUnderstandingV2(
  turn: BootstrappedChatTurn,
  args: {
    deterministic: TurnUnderstandingV2;
    requestedActions: readonly RequestedAction[];
    historyProjection: ConversationProjection;
  },
): Promise<ModelAssemblyResolution> {
  if (args.deterministic.route.kind !== "model_assembled") {
    return deterministicResolution(args.deterministic);
  }
  const client = modelAssemblerForTurn(turn);
  if (!client) return assemblerFallback(args.deterministic, false);
  const result = await assembleWithModel(assemblerInput(turn, args), {
    client,
    traceContext: turn.traceContext,
  });
  if (!result.ok) return assemblerFallback(args.deterministic, true, result.outcome);
  return validateAssembly(args.deterministic, result.output, backendFactsFor(turn, args));
}

export type ModelAssemblyResolution = Readonly<{
  understanding: TurnUnderstandingV2;
  provenance: "deterministic_nonsemantic" | "llm_validated" | "semantic_fallback";
  classifierActuallyCalled: boolean;
  effectsBlocked: boolean;
  pendingPersists: readonly DurableWriteToolName[];
  fallbackReason?: string;
}>;

function deterministicResolution(
  understanding: TurnUnderstandingV2,
): ModelAssemblyResolution {
  return {
    understanding,
    provenance: "deterministic_nonsemantic",
    classifierActuallyCalled: false,
    effectsBlocked: false,
    pendingPersists: [],
  };
}

function assemblerInput(
  turn: BootstrappedChatTurn,
  args: Parameters<typeof resolveChatTurnUnderstandingV2>[1],
) {
  return {
    message: turn.input.message,
    clauses: args.deterministic.clauses,
    evidence: collectTurnEvidence(args.deterministic.clauses),
    workspace: {
      hasCurrentCode: hasCurrentCode(turn.input.code),
      hasAssistantCandidate: hasAssistantCandidate(args.historyProjection),
    },
    projection: serializeSemanticProjection(args.historyProjection),
  };
}

function backendFactsFor(
  turn: BootstrappedChatTurn,
  args: Parameters<typeof resolveChatTurnUnderstandingV2>[1],
) {
  return buildSemanticBackendFacts({
    message: turn.input.message,
    deterministic: args.deterministic,
    requestedActions: args.requestedActions,
    language: turn.input.language,
    hasCurrentCode: hasCurrentCode(turn.input.code),
    hasAssistantCandidate: hasAssistantCandidate(args.historyProjection),
  });
}

function validateAssembly(
  deterministic: TurnUnderstandingV2,
  output: ModelAssemblerOutput,
  facts: SemanticClassifierBackendFacts,
): ModelAssemblyResolution {
  const validated = validateModelAssemblyProposal(output, facts, deterministic);
  return validated.ok
    ? {
        understanding: validated.understanding,
        provenance: "llm_validated",
        classifierActuallyCalled: true,
        effectsBlocked: false,
        pendingPersists: validated.pendingPersists,
      }
    : {
        ...assemblerFallback(deterministic, true, `validator_${validated.reason}`),
        pendingPersists: validated.pendingPersists,
      };
}

function assemblerFallback(
  understanding: TurnUnderstandingV2,
  called: boolean,
  outcome: string = assemblerDisabledReason(),
): ModelAssemblyResolution {
  return {
    understanding,
    provenance: "semantic_fallback",
    classifierActuallyCalled: called,
    effectsBlocked: understanding.route.escalationReasons.some(
      (reason) => reason === "effect_ambiguity",
    ),
    pendingPersists: [],
    fallbackReason: `assembler_${outcome}`,
  };
}

function modelAssemblerForTurn(turn: BootstrappedChatTurn): ModelAssemblerClient | undefined {
  if (!isModelAssemblerEnabled() || turn.deps.modelAssembler === null) return undefined;
  if (turn.deps.modelAssembler) return turn.deps.modelAssembler;
  if (process.env.NODE_ENV === "test" || process.env.COACH_PROVIDER === "mock") return undefined;
  if (!process.env.LLM_MEMORY_API_KEY?.trim()) return undefined;
  const client = createMemoryClient();
  const model = getChatAssemblerModel();
  return { complete: (prompt) => completeAssemblerPrompt(client, model, prompt) };
}

function isModelAssemblerEnabled(): boolean {
  loadLocalEnv();
  return process.env.CHAT_MODEL_ASSEMBLER?.trim() !== "0";
}

function assemblerDisabledReason(): "disabled" | "unconfigured" {
  return isModelAssemblerEnabled() ? "unconfigured" : "disabled";
}

export async function completeAssemblerPrompt(
  client: ReturnType<typeof createMemoryClient>,
  model: string,
  prompt: string,
): Promise<string> {
  const completion = await client.chat.completions.create(
    withMemoryNonStreamingCompatibility({
      model,
      messages: [{ role: "system", content: prompt }],
      temperature: 0,
      response_format: modelAssemblerResponseFormat(),
    }),
  );
  return completion.choices[0]?.message.content ?? "";
}

/** Provider-side constrained decoding; the Zod validator remains the final gate. */
function modelAssemblerResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "turn_assembly",
      strict: true,
      schema: z.toJSONSchema(modelAssemblerOutputSchema),
    },
  };
}

function serializeSemanticProjection(projection: ConversationProjection) {
  const compact = projection.messages
    .map(
      ({ role, content }) =>
        `${role}: ${(content ?? "")
          .replace(/```[\s\S]*?```/gu, "[code omitted]")
          .replace(/`[^`\n]*`/gu, "[inline code omitted]")}`,
    )
    .join("\n");
  return compact.length <= SEMANTIC_PROJECTION_CHAR_LIMIT
    ? compact
    : compact.slice(-SEMANTIC_PROJECTION_CHAR_LIMIT);
}

function hasCurrentCode(code: string | undefined) {
  return (code?.trim().length ?? 0) > 0;
}

function hasAssistantCandidate(projection: ConversationProjection) {
  return hasSameRevisionAssistantCandidate(projection);
}
