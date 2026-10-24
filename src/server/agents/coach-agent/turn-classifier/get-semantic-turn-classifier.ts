import { loadLocalEnv } from "@/lib/env";
import { createChatClient } from "@/server/llm/client";
import { getChatModel } from "@/server/llm/models";

import { createOpenAiSemanticTurnClassifier } from "./openai-semantic-turn-classifier";
import type { SemanticTurnClassifier } from "./semantic-turn-classifier.types";

/**
 * Live Chat gets the semantic slow path whenever its normal provider is
 * configured. Tests and mock-provider runs stay deterministic unless a
 * classifier is injected through ChatReplyDeps.
 */
export function getSemanticTurnClassifier():
  SemanticTurnClassifier | undefined {
  loadLocalEnv();
  if (process.env.NODE_ENV === "test") return undefined;
  if (process.env.COACH_PROVIDER === "mock") return undefined;
  if (process.env.TURN_CLASSIFIER_ENABLED?.trim() === "0") return undefined;
  if (!process.env.LLM_CHAT_API_KEY?.trim()) return undefined;
  return createOpenAiSemanticTurnClassifier({
    client: createChatClient(),
    model: getChatModel(),
  });
}
