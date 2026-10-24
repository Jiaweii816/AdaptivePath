import { loadLocalEnv } from "@/lib/env";
import { createChatClient } from "@/server/llm/client";
import { getChatModel } from "@/server/llm/models";

import { createOpenAiTurnClassifier } from "./openai-turn-classifier";
import type { TurnClassifier } from "./turn-classifier.types";

export function getTurnClassifier(): TurnClassifier | undefined {
  loadLocalEnv();
  if (process.env.NODE_ENV === "test") return undefined;
  if (process.env.COACH_PROVIDER === "mock") return undefined;
  if (process.env.TURN_CLASSIFIER_ENABLED !== "1") return undefined;
  if (!process.env.LLM_CHAT_API_KEY?.trim()) return undefined;
  return createOpenAiTurnClassifier({
    client: createChatClient(),
    model: getChatModel(),
  });
}
