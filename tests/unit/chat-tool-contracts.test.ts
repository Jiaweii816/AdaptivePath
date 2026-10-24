import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatToolManifest,
  chatToolArgSchemas,
  chatToolManifest,
  chatToolNameSchema,
  chatToolResultSchemas,
  readChatMaxToolIterations,
  type ChatToolName,
} from "@/server/tools/chat-tools/chat-tool-contracts";
import { HARD_MAX_CHAT_TOOL_ROUNDS } from "@/server/tools/chat-tools/chat-tool-runtime";

const originalBudget = process.env.CHAT_MAX_TOOL_ITERATIONS;

afterEach(() => {
  vi.resetModules();

  if (originalBudget === undefined) {
    delete process.env.CHAT_MAX_TOOL_ITERATIONS;
  } else {
    process.env.CHAT_MAX_TOOL_ITERATIONS = originalBudget;
  }
});

describe("chat tool contracts", () => {
  it("keeps the manifest, arg schemas, and result schemas keyed by the declared tools", () => {
    const expectedNames = chatToolNameSchema.options;

    expect(chatToolManifest.map((tool) => tool.function.name)).toEqual(
      expectedNames,
    );
    expect(Object.keys(chatToolArgSchemas).sort()).toEqual(
      [...expectedNames].sort(),
    );
    expect(Object.keys(chatToolResultSchemas).sort()).toEqual(
      [...expectedNames].sort(),
    );

    for (const tool of chatToolManifest) {
      expect(tool.type).toBe("function");
      expect(tool.function.description.length).toBeGreaterThan(80);
      expect(tool.function.parameters).toMatchObject({
        type: "object",
        properties: expect.any(Object),
      });
    }
  });

  it("compiles manifest descriptions without references to unavailable tools", () => {
    const availableToolNames = new Set<ChatToolName>([
      "lookup_api_reference",
      "save_knowledge_note",
    ]);
    const manifest = buildChatToolManifest(availableToolNames);

    expect(manifest.map((entry) => entry.function.name)).toEqual([
      "lookup_api_reference",
      "save_knowledge_note",
    ]);

    const serializedDescriptions = manifest
      .map((entry) => entry.function.description)
      .join("\n");
    for (const unavailableName of chatToolNameSchema.options.filter(
      (name) => !availableToolNames.has(name),
    )) {
      expect(serializedDescriptions).not.toContain(unavailableName);
    }
  });

  it("routes Chinese direction-only hint requests to get_algorithm_hint before running code", () => {
    const hintDescription = chatToolManifest.find(
      (tool) => tool.function.name === "get_algorithm_hint",
    )?.function.description;

    expect(hintDescription).toContain("暗示");
    expect(hintDescription).toContain("点拨");
    expect(hintDescription).toContain("只给方向");
    expect(hintDescription).toContain("优化思路但只要提示");
    expect(hintDescription).toContain(
      "use get_algorithm_hint before run_current_code",
    );
    expect(hintDescription).toContain("explicitly asks to run/verify/test");
  });

  it("validates known-good and known-bad tool arguments through zod schemas", () => {
    expect(
      chatToolArgSchemas.run_current_code.safeParse({
        dataInput: '"abba"',
        tests: [
          {
            label: "abba",
            input: { s: "abba" },
            expected: 2,
          },
        ],
      }).success,
    ).toBe(true);
    expect(chatToolArgSchemas.run_current_code.safeParse({}).success).toBe(
      true,
    );
    expect(
      chatToolArgSchemas.run_current_code.safeParse({
        code: "class Solution:\n    pass",
        language: "Python",
      }).success,
    ).toBe(false);
    expect(
      chatToolArgSchemas.verify_proposed_repair.safeParse({
        candidateCode: "class Solution:\n    pass",
        language: "Python",
        repair: {
          diagnosis: "Replace the placeholder.",
          changedSymbol: "Solution.solve",
          edits: [{ before: "pass", after: "return 1", reason: "Produce a result." }],
          expectedBehavior: "The method returns a value.",
        },
      }).success,
    ).toBe(true);
    expect(
      chatToolArgSchemas.verify_proposed_repair.safeParse({
        candidateCode: "class Solution:\n    pass",
        language: "Java",
      }).success,
    ).toBe(false);
    expect(
      chatToolArgSchemas.find_practice_problem.safeParse({
        mode: "reinforce",
        tags: ["sliding-window"],
        completed_ids: ["3"],
      }).success,
    ).toBe(true);
    expect(
      chatToolArgSchemas.find_practice_problem.safeParse({
        mode: "random",
        tags: ["sliding-window"],
      }).success,
    ).toBe(false);
    expect(chatToolArgSchemas.get_algorithm_hint.safeParse({}).success).toBe(
      true,
    );
    expect(
      chatToolArgSchemas.get_algorithm_hint.safeParse({
        problem_slug: "valid-parentheses",
        focus: "stack choice",
      }).success,
    ).toBe(true);
    expect(
      chatToolArgSchemas.get_algorithm_hint.safeParse({
        problem_slug: "",
      }).success,
    ).toBe(false);
    expect(
      chatToolArgSchemas.get_algorithm_hint.safeParse({
        problem_slug: "valid-parentheses",
        level: 3,
      }).success,
    ).toBe(false);
    expect(
      chatToolArgSchemas.lookup_api_reference.safeParse({
        language: "C++",
        topic: "unordered_map",
      }).success,
    ).toBe(true);
    expect(
      chatToolArgSchemas.save_mistake_book_entry.safeParse({
        title: "Container With Most Water 双指针",
        guideMarkdown: "面积由较矮柱决定；每次移动较矮一侧。",
        selfCheckQuestion: "为什么移动较矮的一侧？",
        selfCheckAnswer: "较矮柱限制当前面积，移动它才可能遇到更高边界。",
        tags: ["two_pointers"],
      }).success,
    ).toBe(true);
    expect(
      chatToolArgSchemas.save_mistake_book_entry.safeParse({
        title: "empty guide",
        guideMarkdown: "",
      }).success,
    ).toBe(false);
  });

  it("requires origin and evidence verdict metadata in code-run results", () => {
    const parsed = chatToolResultSchemas.run_current_code.parse({
      runEvidenceId: "run-1",
      reviewAttemptId: null,
      chatSessionId: "chat-1",
      codeHash: "sha256:abc",
      executedCodeHash: "sha256:abc",
      currentCodeHash: "sha256:abc",
      matchesCurrentCode: true,
      codeOrigin: "user_current_editor",
      evidenceKind: "current_editor_run",
      producer: "assistant_tool",
      subject: "current_user_code",
      authority: "advisory",
      scope: { kind: "specific_examples", totalCount: 1 },
      oracle: "provided_expected",
      result: {
        status: "runner_error",
        failureProvenance: "network",
        passedCount: 0,
        failedCount: 0,
        stdout: "",
        stderr: "ECONNRESET",
        testResults: [],
      },
      evidenceVerdict: {
        evidenceClass: "evidence_unavailable",
        replyMode: "unavailable",
        capabilities: {
          canVerdict: false,
          canWriteMistakeMemory: false,
          canWriteEpisode: false,
          canSignalPlanner: false,
          canUseFailureSalience: false,
        },
        status: "runner_error",
        provenance: "network",
        providerUsed: "mock",
        scopeLabel: "execution evidence unavailable",
        modelInstruction:
          "Do not assert that the code passed or failed. Retry execution first.",
      },
      modelInstruction:
        "Do not assert that the code passed or failed. Retry execution first.",
      llmObservation: {
        observationKind: "run_code_compact_observation",
        runEvidenceId: "run-1",
        reviewAttemptId: null,
        chatSessionId: "chat-1",
        matchesCurrentCode: true,
        codeOrigin: "user_current_editor",
        evidenceKind: "current_editor_run",
        producer: "assistant_tool",
        subject: "current_user_code",
        authority: "advisory",
        scope: { kind: "specific_examples", totalCount: 1 },
        oracle: "provided_expected",
        status: "runner_error",
        failureProvenance: "network",
        passedCount: 0,
        failedCount: 0,
        stderrSummary:
          "Captured 10 chars, 1 line(s); raw stream text withheld from the model observation.",
        untrustedOutputRedacted: true,
        redactedFields: ["result.stderr"],
        evidenceVerdict: {
          evidenceClass: "evidence_unavailable",
          replyMode: "unavailable",
          capabilities: {
            canVerdict: false,
            canWriteMistakeMemory: false,
            canWriteEpisode: false,
            canSignalPlanner: false,
            canUseFailureSalience: false,
          },
          status: "runner_error",
          provenance: "network",
          providerUsed: "mock",
          scopeLabel: "execution evidence unavailable",
          modelInstruction:
            "Do not assert that the code passed or failed. Retry execution first.",
        },
        modelInstruction:
          "Do not assert that the code passed or failed. Retry execution first.",
      },
    });

    expect(parsed.evidenceVerdict.evidenceClass).toBe("evidence_unavailable");
    expect(parsed.codeOrigin).toBe("user_current_editor");
    expect(parsed.modelInstruction).toContain("Do not assert");
    expect(parsed.llmObservation.stderrSummary).toContain(
      "raw stream text withheld",
    );
    expectNoModelHashLeak(parsed.llmObservation);
  });

  it("reads CHAT_MAX_TOOL_ITERATIONS from env and falls back to the default", async () => {
    delete process.env.CHAT_MAX_TOOL_ITERATIONS;
    vi.resetModules();
    await expect(
      import("@/server/tools/chat-tools/chat-tool-contracts").then(
        (module) => module.CHAT_MAX_TOOL_ITERATIONS,
      ),
    ).resolves.toBe(5);

    process.env.CHAT_MAX_TOOL_ITERATIONS = "2";
    vi.resetModules();
    await expect(
      import("@/server/tools/chat-tools/chat-tool-contracts").then(
        (module) => module.CHAT_MAX_TOOL_ITERATIONS,
      ),
    ).resolves.toBe(2);

    expect(
      readChatMaxToolIterations({
        CHAT_MAX_TOOL_ITERATIONS: "nope",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(5);

    expect(
      readChatMaxToolIterations({
        CHAT_MAX_TOOL_ITERATIONS: "999999",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(HARD_MAX_CHAT_TOOL_ROUNDS);
  });
});

function expectNoModelHashLeak(value: unknown) {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain("sha256:");
  expect(serialized).not.toContain('"codeHash"');
  expect(serialized).not.toContain('"executedCodeHash"');
  expect(serialized).not.toContain('"currentCodeHash"');
}
