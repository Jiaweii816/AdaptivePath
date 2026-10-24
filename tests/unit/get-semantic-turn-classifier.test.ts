import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSemanticTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/get-semantic-turn-classifier";

const seams = vi.hoisted(() => ({
  client: { chat: { completions: { create: vi.fn() } } },
  classifier: { classify: vi.fn() },
  createClassifier: vi.fn(),
  createChatClient: vi.fn(),
  getChatModel: vi.fn(),
  loadLocalEnv: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ loadLocalEnv: seams.loadLocalEnv }));
vi.mock("@/server/llm/client", () => ({
  createChatClient: seams.createChatClient,
}));
vi.mock("@/server/llm/models", () => ({
  getChatModel: seams.getChatModel,
}));
vi.mock(
  "@/server/agents/coach-agent/turn-classifier/openai-semantic-turn-classifier",
  () => ({ createOpenAiSemanticTurnClassifier: seams.createClassifier }),
);

const ORIGINAL_ENV = {
  nodeEnv: process.env.NODE_ENV,
  coachProvider: process.env.COACH_PROVIDER,
  classifierEnabled: process.env.TURN_CLASSIFIER_ENABLED,
  chatApiKey: process.env.LLM_CHAT_API_KEY,
};

beforeEach(() => {
  vi.clearAllMocks();
  seams.createChatClient.mockReturnValue(seams.client);
  seams.getChatModel.mockReturnValue("configured-chat-model");
  seams.createClassifier.mockReturnValue(seams.classifier);
  setEnv("NODE_ENV", "production");
  setEnv("COACH_PROVIDER", undefined);
  setEnv("TURN_CLASSIFIER_ENABLED", undefined);
  setEnv("LLM_CHAT_API_KEY", "configured-chat-key");
});

afterEach(() => {
  setEnv("NODE_ENV", ORIGINAL_ENV.nodeEnv);
  setEnv("COACH_PROVIDER", ORIGINAL_ENV.coachProvider);
  setEnv("TURN_CLASSIFIER_ENABLED", ORIGINAL_ENV.classifierEnabled);
  setEnv("LLM_CHAT_API_KEY", ORIGINAL_ENV.chatApiKey);
});

describe("getSemanticTurnClassifier configuration", () => {
  it("is available in production when the Chat key exists and the flag is unset", () => {
    expect(getSemanticTurnClassifier()).toBe(seams.classifier);
    expect(seams.createClassifier).toHaveBeenCalledWith({
      client: seams.client,
      model: "configured-chat-model",
    });
    expect(seams.createChatClient).toHaveBeenCalledTimes(1);
    expect(seams.getChatModel).toHaveBeenCalledTimes(1);
  });

  it("honors explicit TURN_CLASSIFIER_ENABLED=0 as an opt-out", () => {
    setEnv("TURN_CLASSIFIER_ENABLED", "0");

    expect(getSemanticTurnClassifier()).toBeUndefined();
    expect(seams.createClassifier).not.toHaveBeenCalled();
    expect(seams.createChatClient).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing Chat key",
      configure: () => setEnv("LLM_CHAT_API_KEY", undefined),
    },
    {
      name: "mock Coach provider",
      configure: () => setEnv("COACH_PROVIDER", "mock"),
    },
    {
      name: "test process",
      configure: () => setEnv("NODE_ENV", "test"),
    },
  ])("stays unavailable for $name", ({ configure }) => {
    configure();

    expect(getSemanticTurnClassifier()).toBeUndefined();
    expect(seams.createClassifier).not.toHaveBeenCalled();
    expect(seams.createChatClient).not.toHaveBeenCalled();
    expect(seams.getChatModel).not.toHaveBeenCalled();
  });
});

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
