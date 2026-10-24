import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClassifierOutput } from "@/server/agents/coach-agent/turn-classifier/classifier-output.schema";
import { buildClassifierBackendFacts } from "@/server/agents/coach-agent/turn-classifier/chat-turn-classifier-context";
import { getTurnClassifier } from "@/server/agents/coach-agent/turn-classifier/get-turn-classifier";
import {
  resolveTurnUnderstanding,
  type ResolverGuardTrace,
} from "@/server/agents/coach-agent/turn-classifier/resolve-turn-understanding";
import type { TurnClassifier } from "@/server/agents/coach-agent/turn-classifier/turn-classifier.types";
import {
  validateClassifiedUnderstanding,
  type BackendFacts,
} from "@/server/agents/coach-agent/turn-classifier/validate-classified-understanding";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  COACH_PROVIDER: process.env.COACH_PROVIDER,
  LLM_CHAT_API_KEY: process.env.LLM_CHAT_API_KEY,
  TURN_CLASSIFIER_ENABLED: process.env.TURN_CLASSIFIER_ENABLED,
};

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv("NODE_ENV", ORIGINAL_ENV.NODE_ENV);
  restoreEnv("COACH_PROVIDER", ORIGINAL_ENV.COACH_PROVIDER);
  restoreEnv("LLM_CHAT_API_KEY", ORIGINAL_ENV.LLM_CHAT_API_KEY);
  restoreEnv("TURN_CLASSIFIER_ENABLED", ORIGINAL_ENV.TURN_CLASSIFIER_ENABLED);
});

describe("turn classifier opt-in boundary", () => {
  it("does not construct a live classifier when the opt-in flag is absent", () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.LLM_CHAT_API_KEY = "configured-key";
    delete process.env.COACH_PROVIDER;
    delete process.env.TURN_CLASSIFIER_ENABLED;

    expect(getTurnClassifier()).toBeUndefined();
  });
});

describe("classified execution authority", () => {
  it("derives execution grants only from deterministic explicit operations", () => {
    const common = {
      message: "Run the current code",
      workspace: classifierContext().workspace,
      requestedActions: [],
    };

    expect(
      buildClassifierBackendFacts({
        ...common,
        deterministic: parseTurnUnderstanding("Run the current code"),
      }).grantedExecutionTargets,
    ).toEqual(["current_user_code"]);
    expect(
      buildClassifierBackendFacts({
        ...common,
        deterministic: parseTurnUnderstanding("Explain this boundary"),
      }).grantedExecutionTargets,
    ).toEqual([]);
  });

  it("rejects an LLM execute operation without a deterministic explicit grant", () => {
    expect(
      validateClassifiedUnderstanding(
        executeOutput(),
        facts({ grantedExecutionTargets: [] }),
        parseTurnUnderstanding("What does this boundary mean?"),
      ),
    ).toEqual({
      ok: false,
      reason: "execute_not_explicitly_authorized",
    });
  });

  it("accepts an execute operation for the exact deterministically granted target", () => {
    const deterministic = parseTurnUnderstanding("Run the current code");
    const result = validateClassifiedUnderstanding(
      executeOutput(),
      facts({ grantedExecutionTargets: ["current_user_code"] }),
      deterministic,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.understanding.operations[0]).toMatchObject({
      family: "execute",
      target: "current_user_code",
      resolution: "explicit",
    });
  });
});

describe("classifier call observability", () => {
  it.each(["factory", "context"] as const)(
    "reports classifierActuallyCalled=false for a %s fallback",
    async (phase) => {
      const deterministic = parseTurnUnderstanding("Can you explain that again?");
      const traces: ResolverGuardTrace[] = [];
      const classifier = classifierReturning(answerOutput());

      const result = await resolveTurnUnderstanding({
        deterministic,
        facts: facts(),
        classifierFactory: () => {
          if (phase === "factory") throw new Error("factory failed");
          return classifier;
        },
        loadClassifierContext: async () => {
          if (phase === "context") throw new Error("context failed");
          return classifierContext();
        },
        guardTraceWriter: async (trace) => {
          traces.push(trace);
        },
      });

      expect(result.classifierActuallyCalled).toBe(false);
      expect(traces[0]?.classifierActuallyCalled).toBe(false);
      expect(classifier.classify).not.toHaveBeenCalled();
    },
  );

  it("reports classifierActuallyCalled=true after classify is invoked", async () => {
    const deterministic = parseTurnUnderstanding("Can you explain that again?");
    const traces: ResolverGuardTrace[] = [];
    const classifier = classifierReturning(answerOutput());

    const result = await resolveTurnUnderstanding({
      deterministic,
      facts: facts(),
      classifierFactory: () => classifier,
      loadClassifierContext: async () => classifierContext(),
      guardTraceWriter: async (trace) => {
        traces.push(trace);
      },
    });

    expect(result.classifierActuallyCalled).toBe(true);
    expect(traces[0]?.classifierActuallyCalled).toBe(true);
    expect(classifier.classify).toHaveBeenCalledTimes(1);
  });
});

function facts(overrides: Partial<BackendFacts> = {}): BackendFacts {
  return {
    workspaceLanguage: "Python",
    hasCurrentCode: true,
    hasAssistantCandidate: false,
    deniedExecutionTargets: [],
    grantedExecutionTargets: [],
    grantedDurableTools: [],
    ...overrides,
  };
}

function executeOutput(): ClassifierOutput {
  return {
    operations: [
      { family: "execute", target: "current_user_code", dependsOn: [] },
    ],
    modifiers: {
      deliveryMode: "direct",
      codeDisclosure: "guided",
      affect: "none",
    },
  };
}

function answerOutput(): ClassifierOutput {
  return {
    operations: [
      {
        family: "answer",
        target: "contextual_referent",
        topic: "general",
        dependsOn: [],
      },
    ],
    modifiers: {
      deliveryMode: "direct",
      codeDisclosure: "guided",
      affect: "none",
    },
  };
}

function classifierReturning(output: ClassifierOutput): TurnClassifier {
  return {
    classify: vi.fn(async () => output),
  };
}

function classifierContext() {
  return {
    message: "Can you explain that again?",
    projection: "assistant: prior explanation",
    workspace: {
      language: "Python" as const,
      codeState: "formed" as const,
      currentCodeLength: 80,
      selectedTestCount: 2,
      hasAssistantCandidate: false,
    },
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
