import { describe, expect, it, vi } from "vitest";

import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import {
  parseTurnUnderstanding,
} from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import {
  captureShadowTurnUnderstandingBestEffort,
} from "@/server/agents/coach-agent/turn-understanding/shadow-trace";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

describe("shadow turn-understanding parser", () => {
  it.each([
    ["Can you explain that again?", "answer", "concept"],
    ["Show me the full code again", "answer", "active_problem"],
    ["Why is this bug still happening?", "diagnose", "current_user_code"],
    ["Can you optimize my current code?", "optimize", "current_user_code"],
    ["Give me the full Python code", "answer", "active_problem"],
    ["Run it again", "execute", "current_user_code"],
  ] as const)(
    "keeps the P0 regression meaning for %s",
    (message, family, target) => {
      const understanding = parseTurnUnderstanding(message);

      expect(understanding.operations).toEqual(
        expect.arrayContaining([expect.objectContaining({ family, target })]),
      );
      expect(understanding.negationSignals).toEqual([]);
      expect(understanding.unsupportedScope).toEqual({});
      if (message.toLowerCase().includes("again")) {
        expect(
          understanding.operations.some(({ family }) => family === "recall"),
        ).toBe(false);
      }
    },
  );

  it("assembles all matched operations for a compound turn", () => {
    const message =
      "Run my current code, then save this problem to my mistake book, and recommend another practice problem";
    const understanding = parseTurnUnderstanding(message);

    expect(understanding.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "execute", target: "current_user_code" }),
        expect.objectContaining({ family: "persist", target: "mistake_book" }),
        expect.objectContaining({ family: "recommend", target: "practice_problem" }),
      ]),
    );
    expect(understanding.route).toBe("llm");
  });

  it.each([
    ["Don't run my current code", "execute"],
    ["Do not save this problem to my mistake book", "persist"],
  ] as const)("does not invent a %s side effect for %s", (message, family) => {
    const understanding = parseTurnUnderstanding(message);

    expect(understanding.operations.some((operation) => operation.family === family)).toBe(false);
    expect(understanding.negationSignals.length).toBeGreaterThan(0);
    expect(understanding.ambiguity.blocksSideEffect).toBe(false);
    expect(understanding.route).toBe("llm");
  });

  it.each([
    ["Give me the full C++ code", "C++"],
    ["How do I use priority_queue in cpp?", "cpp"],
    ["Write this in Java", "Java"],
    ["Show the JavaScript implementation", "JavaScript"],
    ["Use TypeScript for this solution", "TypeScript"],
    ["Give me the C# version", "C#"],
    ["Implement this in Go", "Go"],
    ["Use Golang", "Golang"],
    ["Rewrite it in Rust", "Rust"],
    ["Show me Ruby code", "Ruby"],
    ["Use Kotlin", "Kotlin"],
    ["Write it in Swift", "Swift"],
  ])("marks active unsupported scope: %s", (message, span) => {
    const understanding = parseTurnUnderstanding(message);

    expect(understanding.unsupportedScope.languageMention).toBe(span);
    expect(understanding.route).toBe("llm");
  });

  it.each([
    "Can you go through it again?",
    "I default to Python; use C++ only when I explicitly ask",
    "Don't use Java; give me the full Python code",
    "Don’t use Java; give me the full Python code",
    "I used Java before, now give me the full Python code",
    "Give me the full Python code",
  ])("does not mark a non-active language mention: %s", (message) => {
    expect(parseTurnUnderstanding(message).unsupportedScope).toEqual({});
  });

  it("preserves all exact-span discourse, negation, and learner-state evidence", () => {
    const understanding = parseTurnUnderstanding(
      "Again, I'm anxious and still stuck, but don't run it.",
    );

    expect(understanding.discourseMarkers.map(({ span }) => span)).toEqual([
      "Again",
      "still",
      "it",
    ]);
    expect(understanding.negationSignals.map(({ span }) => span)).toEqual([
      "don't",
    ]);
    expect(understanding.learnerStateSignals.map(({ span }) => span)).toEqual([
      "anxious",
      "stuck",
    ]);
  });

  it("uses the canonical requested-action result supplied by the caller", () => {
    const message = "Please save this problem to my mistake book";
    const actions = resolveRequestedActions(message);
    const understanding = parseTurnUnderstanding(
      message,
      buildChatTurnPlan(message),
      actions,
    );

    expect(actions).toHaveLength(1);
    expect(understanding.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "persist", target: "mistake_book" }),
      ]),
    );
  });
});

describe("multi-clause reducer completeness", () => {
  it("keeps the whole-message API read beside a handbook persistence clause", () => {
    const understanding = parseTurnUnderstanding(
      "deque 又忘了，这种语法以后最好能在复习手册里看到。",
    );

    expect(
      understanding.operations.map(({ family, target }) => ({ family, target })),
    ).toEqual([
      { family: "lookup_api", target: "api_object" },
      { family: "persist", target: "knowledge_handbook" },
    ]);
  });

  it("preserves the parser's legacy candidate-run interpretation", () => {
    const message = "Don't run your candidate; explain this";
    expect(buildChatTurnPlan(message).toolCapabilities).toContain(
      "verify_proposed_repair",
    );
    expect(parseTurnUnderstanding(message).operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: "execute", target: "assistant_candidate" }),
      ]),
    );
  });
});

describe("consumed turn-understanding trace isolation", () => {
  it("uses the supplied understanding and fails open on trace errors", async () => {
    const traceContext = {} as Parameters<
      typeof captureShadowTurnUnderstandingBestEffort
    >[0];
    const legacyPlan = buildChatTurnPlan("explain this");
    const understanding = parseTurnUnderstanding("explain this", legacyPlan, []);
    const args = { understanding, legacyPlan, requestedActions: [] };
    const append = vi.fn();

    await expect(
      captureShadowTurnUnderstandingBestEffort(traceContext, args, {
        append,
        appendFailure: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(append).toHaveBeenCalledWith(traceContext, args);

    await expect(
      captureShadowTurnUnderstandingBestEffort(traceContext, args, {
        append: vi.fn(async () => {
          throw new Error("trace append failed");
        }),
        appendFailure: vi.fn(async () => {
          throw new Error("failure trace append failed");
        }),
      }),
    ).resolves.toBeUndefined();
  });
});
