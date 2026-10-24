import { describe, expect, it, vi } from "vitest";
import {
  chatToolRuntimeMetadata,
  createChatToolRuntime,
  DEFAULT_CHAT_TOOL_COST_BUDGET,
  DEFAULT_CHAT_TOOL_EXECUTION_LIMIT,
  DEFAULT_CHAT_TOOL_REQUEST_LIMIT,
  HARD_MAX_CHAT_TOOL_COST_BUDGET,
  HARD_MAX_CHAT_TOOL_EXECUTION_LIMIT,
  HARD_MAX_CHAT_TOOL_REQUEST_LIMIT,
  readChatToolRuntimeConfig,
} from "@/server/tools/chat-tools/chat-tool-runtime";
import {
  chatToolNameSchema,
  type ChatToolName,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import { prepareChatToolCall } from "@/server/tools/chat-tools/chat-tool-dispatch";

describe("chat tool runtime", () => {
  it("declares exhaustive, bounded metadata for every chat tool", () => {
    const toolNames = [...chatToolNameSchema.options].sort();

    expect(Object.keys(chatToolRuntimeMetadata).sort()).toEqual(toolNames);
    for (const name of toolNames) {
      const metadata = chatToolRuntimeMetadata[name];
      expect(metadata.costUnits).toBeGreaterThan(0);
      expect(Number.isInteger(metadata.costUnits)).toBe(true);
      expect(metadata.costUnits).toBeLessThanOrEqual(
        HARD_MAX_CHAT_TOOL_COST_BUDGET,
      );
    }

    expect(chatToolRuntimeMetadata.run_current_code).toMatchObject({
      effect: "execute",
      costUnits: 3,
      idempotency: "turn_reusable",
      maxExecutionsPerTurn: 1,
    });
    expect(chatToolRuntimeMetadata.verify_proposed_repair).toMatchObject({
      effect: "execute",
      costUnits: 3,
      idempotency: "turn_reusable",
      maxExecutionsPerTurn: 1,
    });
    for (const name of [
      "past_problem_recall",
      "past_mistake_recall",
    ] satisfies ChatToolName[]) {
      expect(chatToolRuntimeMetadata[name]).toMatchObject({
        effect: "read",
        idempotency: "turn_reusable",
        maxExecutionsPerTurn: 1,
      });
    }

    for (const name of [
      "note_memory",
      "save_knowledge_note",
      "save_mistake_book_entry",
    ] satisfies ChatToolName[]) {
      expect(chatToolRuntimeMetadata[name]).toMatchObject({
        effect: "write",
        idempotency: "non_reusable",
        maxExecutionsPerTurn: 1,
      });
      expect(chatToolRuntimeMetadata[name]).not.toHaveProperty(
        "requiresExplicitUserGrant",
      );
    }
  });

  it("hard-clamps runtime budgets and falls back on malformed values", () => {
    expect(
      readChatToolRuntimeConfig({
        CHAT_TOOL_COST_BUDGET: "999999",
        CHAT_TOOL_REQUEST_LIMIT: "999999",
        CHAT_TOOL_EXECUTION_LIMIT: "999999",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      costBudget: HARD_MAX_CHAT_TOOL_COST_BUDGET,
      requestLimit: HARD_MAX_CHAT_TOOL_REQUEST_LIMIT,
      executionLimit: HARD_MAX_CHAT_TOOL_EXECUTION_LIMIT,
    });

    expect(
      readChatToolRuntimeConfig({
        CHAT_TOOL_COST_BUDGET: "-1",
        CHAT_TOOL_REQUEST_LIMIT: "Infinity",
        CHAT_TOOL_EXECUTION_LIMIT: "not-a-number",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      costBudget: DEFAULT_CHAT_TOOL_COST_BUDGET,
      requestLimit: DEFAULT_CHAT_TOOL_REQUEST_LIMIT,
      executionLimit: DEFAULT_CHAT_TOOL_EXECUTION_LIMIT,
    });
  });

  it("deduplicates canonical arguments within one workspace without a second dispatch", async () => {
    const runtime = createChatToolRuntime({
      policy: {
        workspaceIdentity: {
          problemId: "problem-3",
          language: "Python",
          codeHash: "internal-code-a",
          selectedSuiteFingerprint: "suite-a",
        },
      },
    });
    const execute = vi.fn(async () => ({
      name: "run_current_code" as const,
      result: { marker: "first-result" },
    }));
    const first = prepareChatToolCall({
      id: "call-1",
      name: "run_current_code",
      arguments: {
        tests: [
          {
            label: "abba",
            input: { s: "abba", metadata: { beta: 2, alpha: 1 } },
            expected: 2,
          },
        ],
      },
    });
    const sameSemanticArgsWithDifferentKeyOrder = prepareChatToolCall({
      id: "call-2",
      name: "run_current_code",
      arguments: {
        tests: [
          {
            expected: 2,
            input: { metadata: { alpha: 1, beta: 2 }, s: "abba" },
            label: "abba",
          },
        ],
      },
    });

    const firstDecision = await runtime.invoke(first, execute);
    const secondDecision = await runtime.invoke(
      sameSemanticArgsWithDifferentKeyOrder,
      execute,
    );

    expect(firstDecision).toMatchObject({
      disposition: "executed",
      result: { marker: "first-result" },
      costUnits: 3,
    });
    expect(secondDecision).toMatchObject({
      disposition: "reused",
      result: { marker: "first-result" },
      reusedFromToolCallId: "call-1",
      costUnits: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      requested: 2,
      executed: 1,
      reused: 1,
      denied: 0,
      costSpent: 3,
    });
  });

  it("reuses history reads when the model rewrites its non-authoritative query", async () => {
    const runtime = createChatToolRuntime({});
    const execute = vi.fn(async () => ({
      name: "past_mistake_recall" as const,
      result: { items: [] },
    }));
    const first = prepareChatToolCall({
      id: "history-1",
      name: "past_mistake_recall",
      arguments: { query: "DP transition mistakes" },
    });
    const second = prepareChatToolCall({
      id: "history-2",
      name: "past_mistake_recall",
      arguments: { query: "monotonic stack mistakes" },
    });

    expect(await runtime.invoke(first, execute)).toMatchObject({
      disposition: "executed",
    });
    expect(await runtime.invoke(second, execute)).toMatchObject({
      disposition: "reused",
      reusedFromToolCallId: "history-1",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      requested: 2,
      executed: 1,
      reused: 1,
      denied: 0,
    });
  });

  it("keeps reuse caches isolated between workspace runtimes", async () => {
    const execute = vi.fn(async () => ({
      name: "lookup_api_reference" as const,
      result: { marker: "lookup" },
    }));
    const call = prepareChatToolCall({
      id: "lookup",
      name: "lookup_api_reference",
      arguments: { language: "Python", topic: "deque" },
    });
    const runtimeA = createChatToolRuntime({
      policy: {
        workspaceIdentity: { problemId: "problem-a", codeHash: "code-a" },
      },
    });
    const runtimeB = createChatToolRuntime({
      policy: {
        workspaceIdentity: { problemId: "problem-b", codeHash: "code-b" },
      },
    });

    await runtimeA.invoke(call, execute);
    await runtimeB.invoke({ ...call, id: "lookup-b" }, execute);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(runtimeA.snapshot().reused).toBe(0);
    expect(runtimeB.snapshot().reused).toBe(0);
  });

  it("never reuses a duplicate non-idempotent hint call", async () => {
    const runtime = createChatToolRuntime({});
    const execute = vi.fn(async () => ({
      name: "get_algorithm_hint" as const,
      result: { level: 1 },
    }));
    const first = prepareChatToolCall({
      id: "hint-1",
      name: "get_algorithm_hint",
      arguments: { problem_slug: "two-sum" },
    });
    const second = { ...first, id: "hint-2" };

    const firstDecision = await runtime.invoke(first, execute);
    const secondDecision = await runtime.invoke(second, execute);

    expect(firstDecision.disposition).toBe("executed");
    expect(secondDecision).toMatchObject({
      disposition: "denied",
      observation: { reason: "per_tool_cap_reached" },
    });
    expect(secondDecision.disposition).not.toBe("reused");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      executed: 1,
      reused: 0,
      denied: 1,
    });
  });

  it("permits the Pilot experience recall once, then denies a rewritten pattern", async () => {
    const runtime = createChatToolRuntime({});
    const execute = vi.fn(async () => ({
      name: "recall_learning_experience" as const,
      result: { status: "empty" },
    }));
    const first = prepareChatToolCall({
      id: "experience-1",
      name: "recall_learning_experience",
      arguments: {
        ftsKeywords: ["left = mid", "interval does not shrink"],
        failurePattern: "mid does not move after equality",
      },
    });
    const second = prepareChatToolCall({
      id: "experience-2",
      name: "recall_learning_experience",
      arguments: {
        ftsKeywords: ["right boundary", "interval does not shrink"],
        failurePattern: "right boundary does not shrink",
      },
    });

    expect(await runtime.invoke(first, execute)).toMatchObject({
      disposition: "executed",
    });
    expect(await runtime.invoke(second, execute)).toMatchObject({
      disposition: "denied",
      observation: { reason: "per_tool_cap_reached" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      executed: 1,
      reused: 0,
      denied: 1,
      perToolExecutions: { recall_learning_experience: 1 },
    });
  });

  it("allows model-planned durable writes within normal runtime limits", async () => {
    const runtime = createChatToolRuntime({});
    const execute = vi.fn(async () => ({
      name: "save_mistake_book_entry" as const,
      result: { saved: true },
    }));
    const call = prepareChatToolCall({
      id: "model-planned-write",
      name: "save_mistake_book_entry",
      arguments: {
        title: "model-planned write",
        guideMarkdown:
          "The runtime should validate limits, not lexical intent.",
      },
    });

    const decision = await runtime.invoke(call, execute);

    expect(decision).toMatchObject({
      disposition: "executed",
      result: { saved: true },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      requested: 1,
      executed: 1,
      denied: 0,
      costSpent: 2,
    });
  });

  it("still enforces manifest availability before charging a durable write", async () => {
    const runtime = createChatToolRuntime({});
    const execute = vi.fn(async () => ({
      name: "save_mistake_book_entry" as const,
      result: { saved: true },
    }));
    const call = prepareChatToolCall({
      id: "authorized-write",
      name: "save_mistake_book_entry",
      arguments: {
        title: "authorized",
        guideMarkdown: "authorized for this exact turn",
      },
    });

    const denied = await runtime.invoke(call, execute, {
      availableToolNames: new Set(["lookup_api_reference"]),
    });
    expect(denied).toMatchObject({
      disposition: "denied",
      observation: { reason: "tool_not_available_this_turn" },
    });
    expect(runtime.snapshot()).toMatchObject({ requested: 0, costSpent: 0 });

    const executed = await runtime.invoke(call, execute, {
      availableToolNames: new Set(["save_mistake_book_entry"]),
    });
    expect(executed).toMatchObject({ disposition: "executed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("charges a handler error and returns a structured observation", async () => {
    const runtime = createChatToolRuntime({});
    const call = prepareChatToolCall({
      id: "lookup-fails",
      name: "lookup_api_reference",
      arguments: { language: "Python", topic: "deque" },
    });

    const decision = await runtime.invoke(call, async () => {
      throw new Error("database unavailable");
    });

    expect(decision).toMatchObject({
      disposition: "error",
      costUnits: 1,
      observation: {
        observationKind: "chat_tool_runtime_observation",
        disposition: "error",
        reason: "tool_execution_error",
        modelInstruction: expect.stringContaining("Do not invent"),
      },
    });
    expect(runtime.snapshot()).toMatchObject({
      requested: 1,
      executed: 1,
      errors: 1,
      costSpent: 1,
      remainingCost: DEFAULT_CHAT_TOOL_COST_BUDGET - 1,
    });
  });

  it("enforces the request hard stop even when a later call could be reused", async () => {
    const runtime = createChatToolRuntime({
      config: { costBudget: 8, requestLimit: 1, executionLimit: 8 },
    });
    const execute = vi.fn(async () => ({
      name: "lookup_api_reference" as const,
      result: { marker: "lookup" },
    }));
    const first = prepareChatToolCall({
      id: "lookup-1",
      name: "lookup_api_reference",
      arguments: { language: "Python", topic: "deque" },
    });

    await runtime.invoke(first, execute);
    const decision = await runtime.invoke(
      { ...first, id: "lookup-2" },
      execute,
    );

    expect(decision).toMatchObject({
      disposition: "denied",
      observation: { reason: "request_limit_reached" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runtime.snapshot()).toMatchObject({
      requested: 2,
      executed: 1,
      reused: 0,
      denied: 1,
    });
  });

  it("only suppresses an unrequested exact selected-suite rerun", async () => {
    const exactPolicy = {
      workspaceIdentity: {
        problemId: "problem-3",
        codeHash: "code-a",
        selectedSuiteFingerprint: "suite-a",
      },
      authoritativeSelectedSuite: {
        codeHash: "code-a",
        suiteFingerprint: "suite-a",
        canVerdict: true,
      },
    } as const;
    const exactRuntime = createChatToolRuntime({ policy: exactPolicy });
    const selectedSuiteCall = prepareChatToolCall({
      id: "selected-suite",
      name: "run_current_code",
      arguments: {},
    });
    const execute = vi.fn(async () => ({
      name: "run_current_code" as const,
      result: { marker: "run" },
    }));

    const denied = await exactRuntime.invoke(selectedSuiteCall, execute);
    expect(denied).toMatchObject({
      disposition: "denied",
      observation: { reason: "fresh_selected_suite_already_available" },
    });

    const explicitRuntime = createChatToolRuntime({
      policy: { ...exactPolicy, explicitExecutionRequested: true },
    });
    expect(
      await explicitRuntime.invoke(
        { ...selectedSuiteCall, id: "explicit-rerun" },
        execute,
      ),
    ).toMatchObject({ disposition: "executed" });

    const changedSuiteRuntime = createChatToolRuntime({
      policy: {
        ...exactPolicy,
        workspaceIdentity: {
          ...exactPolicy.workspaceIdentity,
          selectedSuiteFingerprint: "suite-b",
        },
      },
    });
    expect(
      await changedSuiteRuntime.invoke(
        { ...selectedSuiteCall, id: "changed-suite" },
        execute,
      ),
    ).toMatchObject({ disposition: "executed" });

    const customScopeRuntime = createChatToolRuntime({ policy: exactPolicy });
    const customScopeCall = prepareChatToolCall({
      id: "custom-scope",
      name: "run_current_code",
      arguments: {
        tests: [{ label: "abba", input: { s: "abba" }, expected: 2 }],
      },
    });
    expect(
      await customScopeRuntime.invoke(customScopeCall, execute),
    ).toMatchObject({ disposition: "executed" });

    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("suppresses a comment-only selected-suite rerun by execution fingerprint", async () => {
    const runtime = createChatToolRuntime({
      policy: {
        workspaceIdentity: {
          problemId: "problem-3",
          codeHash: "raw-code-after-comment-edit",
          executionFingerprint: "execfp:v1:same-execution",
          selectedSuiteFingerprint: "suite-a",
        },
        authoritativeSelectedSuite: {
          codeHash: "raw-code-before-comment-edit",
          executionFingerprint: "execfp:v1:same-execution",
          suiteFingerprint: "suite-a",
          canVerdict: true,
        },
      },
    });
    const execute = vi.fn(async () => ({
      name: "run_current_code" as const,
      result: { marker: "should-not-run" },
    }));

    const decision = await runtime.invoke(
      prepareChatToolCall({
        id: "comment-only-rerun",
        name: "run_current_code",
        arguments: {},
      }),
      execute,
    );

    expect(decision).toMatchObject({
      disposition: "denied",
      observation: { reason: "fresh_selected_suite_already_available" },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
