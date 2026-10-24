import { describe, expect, it } from "vitest";
import { projectContextMemory } from "@/features/runtime-trace/components/context-memory-projection";
import { projectSystemMemory, projectTurnLlmExchanges } from "@/features/runtime-trace/components/llm-exchange-projection";
import type { RuntimeTraceEventViewModel } from "@/features/runtime-trace/components/runtime-trace-types";

function event(overrides: Partial<RuntimeTraceEventViewModel>): RuntimeTraceEventViewModel {
  return { id: "event", traceRunId: "run", stage: "llm", kind: "llm", title: "LLM", status: "succeeded", ...overrides };
}

describe("runtime trace LLM and memory projections", () => {
  it("reads chat and review system-memory formats without using receipt hashes", () => {
    expect(projectSystemMemory([{ role: "system", content: "base\n[COACH MEMORY BRIEF — personalization only]\n- original model-visible cue\n[OUTPUT PREFERENCES — personalization only]\n- concise" }]).state).toBe("present");
    const review = projectSystemMemory([{ role: "system", content: "base\n[COACH MEMORY BRIEF — teaching personalization only; never current-code evidence]\nSelected learner cues (max 2):\n- cue\nOutput preferences:\n- short" }]);
    expect(review.state).toBe("present");
    expect(review.state === "present" && review.sections.map((section) => section.title)).toContain("Selected learner cues (max 2)");
    expect(projectSystemMemory([{ role: "system", content: "base only" }]).state).toBe("absent");
    expect(projectSystemMemory([], true).state).toBe("unavailable");
  });

  it("fails closed on prompt elision rather than producing a false incremental diff", () => {
    const projected = projectTurnLlmExchanges([
      event({ id: "one", agentIteration: 1, payload: { prompt: [{ role: "system", content: "base" }, { role: "user", content: "first" }] } }),
      event({ id: "two", agentIteration: 2, payload: { prompt: [{ role: "system", content: "base" }, { role: "trace_capture", content: "…[TRUNCATED: 8 PROMPT MESSAGES]…" }, { role: "user", content: "second" }] } }),
    ]);
    expect(projected.get("two")?.diff.state).toBe("indeterminate");
  });

  it("marks only newly introduced memory tool results as expanded evidence", () => {
    const result = { name: "past_mistake_recall", content: { items: ["a"] } };
    const projected = projectTurnLlmExchanges([
      event({ id: "one", agentIteration: 1, payload: { prompt: [{ role: "tool", content: result }] } }),
      event({ id: "two", agentIteration: 2, payload: { prompt: [{ role: "tool", content: result }, { role: "tool", content: { name: "past_problem_recall", content: { items: ["b"] } } }] } }),
    ]);
    expect(projected.get("two")?.memoryToolResults.map((item) => item.isNew)).toEqual([false, true]);
  });

  it("uses the first LLM exchange as the strategy baseline and reports only later changes", () => {
    const baseInput = {
      policy: { intent: "practice_request", primaryGoal: "Recommend practice" },
      toolMode: "tool_loop",
      toolChoice: "auto",
      availableTools: ["find_practice_problem"],
      requiredActions: [],
      tools: [{ function: { name: "find_practice_problem" } }],
    };
    const projected = projectTurnLlmExchanges([
      event({ id: "one", agentIteration: 1, payload: { input: baseInput, prompt: [{ role: "user", content: "recommend one" }] } }),
      event({ id: "two", agentIteration: 2, payload: { input: baseInput, prompt: [{ role: "user", content: "recommend one" }, { role: "tool", content: { name: "find_practice_problem", content: "items" } }] } }),
      event({ id: "three", agentIteration: 3, payload: { input: { ...baseInput, toolMode: "finalize_without_tools" }, prompt: [{ role: "user", content: "recommend one" }, { role: "tool", content: { name: "find_practice_problem", content: "items" } }] } }),
    ]);
    expect(projected.get("one")?.strategy.state).toBe("initial");
    expect(projected.get("two")?.strategy).toMatchObject({ state: "unchanged", previousIteration: 1 });
    expect(projected.get("three")?.strategy.changedFields).toContainEqual({ label: "toolMode", before: "tool_loop", after: "finalize_without_tools" });
  });

  it("dispatches context_memory by source and exposes unknown source explicitly", () => {
    const coach = projectContextMemory(event({ stage: "context_memory", kind: "retrieval", payload: { retrieval: { candidateCount: 26, candidates: [{ id: "a", title: "Cue" }], decisions: [{ candidateId: "a", selected: true, reason: "fit" }] }, metadata: { source: "build_coach_memory_context", retrievalStatus: "lexical_only", application: { selectedCandidateIds: ["a"] } } } }));
    expect(coach).toMatchObject({ type: "coach", candidateLabel: "26 → 1", retrievalStatus: "lexical_only" });
    const unknown = projectContextMemory(event({ stage: "context_memory", kind: "retrieval", payload: { metadata: { source: "future" } } }));
    expect(unknown).toMatchObject({ type: "unsupported", source: "future" });
  });
});
