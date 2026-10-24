import { describe, expect, it } from "vitest";
import {
  applyProductInvariantGuard,
  type ProductInvariantGuardFacts,
  type ProductInvariantId,
} from "@/server/agents/coach-agent/product-invariant-guard";

const noEvidenceFacts: ProductInvariantGuardFacts = {
  currentCodeAuthoritativeRunStatus: "no_authoritative_run_yet",
  selectedSuiteTotal: 3,
  advisoryObservations: [],
};

describe("product invariant guard", () => {
  it.each([
    ["先按 Ctrl+S 保存，再点 Run。", "zh"],
    ["你的改动可能没有保存。", "zh"],
    ["编辑器里还是旧版本，所以结果没变。", "zh"],
    ["代码看起来和上一轮一样。", "zh"],
    [
      "我没有看到你当前的代码有改动——编辑器里仍然是初始的 return 0 骨架代码。",
      "zh",
    ],
    ["这仍然是最开始的 dummy return，没有看到你提到的改动。", "zh"],
    ["你的代码目前还是 return 0 的占位实现，没有滑动窗口逻辑。", "zh"],
    ["请确认文件已保存，再运行。", "zh"],
    ["也许 Cmd + S 没按到。", "zh"],
    ["Press Ctrl+S, then rerun.", "en"],
    ["Your changes were probably not saved.", "en"],
    ["The editor still contains the old code.", "en"],
    ["The code is unchanged from last turn.", "en"],
    ["Save the file first.", "en"],
    ["Maybe Cmd-S did not take effect.", "en"],
    ["The runner is still using the previous code version.", "en"],
    ["Run picked up the previous code.", "en"],
    ["Your edits did not stick after Run.", "en"],
    ["运行器仍然在使用之前的代码版本。", "zh"],
    ["这次 Run 读到的是上一次的代码。", "zh"],
    ["你的改动没有被应用。", "zh"],
    ["Don't forget to press Ctrl+S before Run.", "en"],
    ["No need to explain; press Ctrl+S and rerun.", "en"],
    ["你问是不是没保存——是的，你需要先保存。", "zh"],
  ] as const)(
    "rewrites a positive editor-save fiction: %s",
    (reply, responseLanguage) => {
      expectViolation(
        reply,
        responseLanguage,
        "editor_save_step_fiction",
      );
    },
  );

  it.each([
    ["这里无需 Ctrl+S，编辑会立即生效。", "zh"],
    ["“代码没保存”不是原因；这里没有保存步骤。", "zh"],
    ["你问是不是未保存：不是，下一次 Run 会直接用当前代码。", "zh"],
    ["无法判断是否保存——这里无需保存，编辑会立即生效。", "zh"],
    ["当前代码是占位实现，先补上核心逻辑。", "zh"],
    ["传统 IDE 会保存文件，但这里不需要。", "zh"],
    ["请把这个偏好保存到记忆里。", "zh"],
    ["把这题加入错题本保存。", "zh"],
    ["There is no need to press Ctrl+S here.", "en"],
    ["\"Not saved\" is not possible in this workbench.", "en"],
    ["You asked whether it was unsaved; it was not. Run uses current code.", "en"],
    ["Traditional editors save files; this workbench does not require it.", "en"],
    ["The runner is not using old code; it uses the current editor content.", "en"],
    ["运行器并没有使用旧代码；它会读取当前编辑器内容。", "zh"],
    ["Run 没有拿到旧代码。", "zh"],
    ["Save this preference to memory.", "en"],
    ["Save this problem to the mistake book.", "en"],
    ["Save the left index in a temporary variable before moving it.", "en"],
  ] as const)(
    "keeps a correction, quotation, or unrelated save reference unchanged: %s",
    (reply, responseLanguage) => {
      expectUnchanged(reply, responseLanguage);
    },
  );

  it.each([
    ["隐藏测试都通过了。", "zh"],
    ["隐藏测试全过了，我不能解释原因。", "zh"],
    ["隐藏测试全过，对吗？", "zh"],
    ["隐藏测试全过，没错吧？", "zh"],
    ["这份代码已经 LeetCode AC。", "zh"],
    ["肯定能过官方评测。", "zh"],
    ["放心提交，一定 Accepted。", "zh"],
    ["官方判题会全部变绿。", "zh"],
    ["All hidden cases are green.", "en"],
    ["All hidden tests passed, and I cannot explain why.", "en"],
    ["All hidden tests passed, right?", "en"],
    ["All hidden tests passed, isn't it?", "en"],
    ["This is guaranteed to be accepted.", "en"],
    ["LeetCode will accept it.", "en"],
    ["You can count on an official AC.", "en"],
    ["It will pass the official judge.", "en"],
    ["This is LeetCode Accepted, but I can't explain why.", "en"],
    ["I cannot confirm others, but yours is guaranteed AC.", "en"],
    ["已经官方通过，但我不能解释原因。", "zh"],
    ["不能保证别人的代码，但你的肯定 AC。", "zh"],
  ] as const)(
    "rewrites an official or hidden-test overclaim with claim-local polarity: %s",
    (reply, responseLanguage) => {
      expectViolation(
        reply,
        responseLanguage,
        "official_acceptance_overclaim",
      );
    },
  );

  it.each([
    ["我不能承诺官方 AC。", "zh"],
    ["如果 LeetCode 官方通过，再记录自评。", "zh"],
    ["你问“是否 Accepted？”现有证据无法确认。", "zh"],
    ["“Accepted” 是 LeetCode 的状态标签。", "zh"],
    ["Visible tests passing does not imply hidden-test success.", "en"],
    ["I cannot promise an official AC.", "en"],
    ["If LeetCode returns Accepted, record the self-rating.", "en"],
    ["You asked whether it was Accepted; the evidence cannot confirm that.", "en"],
    ["Could hidden tests pass?", "en"],
    ["All hidden tests passed?", "en"],
    ["隐藏测试会通过吗？", "zh"],
    ["\"Accepted\" is a LeetCode status label.", "en"],
    ["Open LeetCode and submit there for official verification.", "en"],
    ["LeetCode accepts submissions through its judge.", "en"],
    ["Open the LeetCode account settings.", "en"],
    ["The LeetCode acceptance status is unknown.", "en"],
    ["The AC automaton uses failure links.", "en"],
  ] as const)(
    "keeps a limitation, condition, verification instruction, or term unchanged: %s",
    (reply, responseLanguage) => {
      expectUnchanged(reply, responseLanguage);
    },
  );

  it("leaves fenced code byte-for-byte unchanged", () => {
    const reply = [
      "This snippet parses an API response:",
      "```python",
      "accepted = submit(payload)",
      "message = \"All hidden tests passed.\"",
      "# All hidden tests passed is test fixture text.",
      "class ACAutomaton:",
      "    pass",
      "```",
      "The variable names above are not judge claims.",
    ].join("\n");

    expectUnchanged(reply, "en");
  });

  it("scans explicit prose fences while preserving real code fences", () => {
    const reply = [
      "```text",
      "All hidden tests passed.",
      "```",
    ].join("\n");

    expectViolation(
      reply,
      "en",
      "official_acceptance_overclaim",
    );
  });

  it("detects an official-success claim split across prose lines", () => {
    const reply = ["All hidden tests", "passed."].join("\n");
    const result = applyProductInvariantGuard({
      reply,
      responseLanguage: "en",
      facts: noEvidenceFacts,
    });

    expect(result.replaced).toBe(true);
    expect(result.strategy).toBe("targeted_line_replacement");
    expect(result.reply).not.toContain("All hidden tests");
    expect(result.reply).not.toContain("passed.");
    expect(result.violations.map((violation) => violation.invariantId)).toContain(
      "official_acceptance_overclaim",
    );
  });

  it.each([
    "这个 1/1 说明所选 3 个用例全过。",
    "所选用例全部通过。",
    "这组可见测试已经全绿。",
    "Your current code passed every selected test.",
    "The selected suite is 3 for 3.",
    "We cleared the full visible suite.",
    "All selected tests passed, which does not imply hidden-test acceptance.",
    "这些可见用例通过不代表隐藏测试通过。",
  ])(
    "does not elevate a specific example into selected-suite success: %s",
    (reply) => {
      expectViolation(
        reply,
        /[\u3400-\u9fff]/.test(reply) ? "zh" : "en",
        "advisory_selected_suite_overclaim",
        specificExampleFacts(),
      );
    },
  );

  it.each([
    ["这个具体样例 1/1 通过。", "zh"],
    ["1/1 不代表所选 3/3。", "zh"],
    ["要判断所选用例，需要再跑完整所选测试。", "zh"],
    ["This specific example passed 1/1.", "en"],
    ["One passing example does not establish 3/3.", "en"],
    ["Only after the selected suite runs can that scope be reported.", "en"],
    ["We need to pass all selected tests.", "en"],
    ["Aim to pass all selected tests before optimizing.", "en"],
    ["The selected suite passed?", "en"],
    ["所选测试都通过了？", "zh"],
  ] as const)("keeps a correctly scoped example statement: %s", (reply, language) => {
    expectUnchanged(reply, language, specificExampleFacts());
  });

  it("allows exact current authoritative selected-suite 3/3 without allowing official success", () => {
    const facts = authoritativeSelectedSuiteFacts({
      status: "passed_visible_tests",
      passedCount: 3,
      failedCount: 0,
      canVerdict: true,
    });
    expectUnchanged("The current selected suite passed 3/3.", "en", facts);
    expectViolation(
      "The current selected suite passed 3/3, so all hidden tests pass.",
      "en",
      "official_acceptance_overclaim",
      facts,
    );
  });

  it("does not authorize a current 3/3 claim from stale authoritative evidence", () => {
    const facts = authoritativeSelectedSuiteFacts({
      alignedToCurrentCode: false,
      currentCodeAuthoritativeRunStatus:
        "current_code_changed_since_authoritative_run",
    });

    expectViolation(
      "The current code passed the selected suite 3/3.",
      "en",
      "advisory_selected_suite_overclaim",
      facts,
    );
    expectUnchanged(
      "The earlier code passed 3/3, but that result does not apply to the current code.",
      "en",
      facts,
    );
  });

  it("keeps candidate success separate from current-editor success", () => {
    const facts: ProductInvariantGuardFacts = {
      ...noEvidenceFacts,
      advisoryObservations: [
        {
          subject: "assistant_candidate",
          authority: "advisory",
          scopeKind: "selected_suite",
          status: "passed_visible_tests",
          passedCount: 3,
          failedCount: 0,
          totalCount: 3,
        },
      ],
    };

    expectViolation(
      "Your current code passed the selected suite 3/3.",
      "en",
      "advisory_selected_suite_overclaim",
      facts,
    );
    expectUnchanged(
      "The candidate edit passed the selected 3/3 in this advisory run.",
      "en",
      facts,
    );
    expectViolation(
      "Your current code failed with a TypeError.",
      "en",
      "candidate_run_as_current_code",
      facts,
    );
    expectViolation(
      "你当前的代码仍然报错。",
      "zh",
      "candidate_run_as_current_code",
      facts,
    );
    expectUnchanged(
      "候选修改仍然报错；这不是你当前编辑器代码的运行结果。",
      "zh",
      facts,
    );
  });

  it("does not let advisory 1/1 override an authoritative selected-suite timeout 0/3", () => {
    const facts = authoritativeSelectedSuiteFacts({
      status: "timeout",
      passedCount: 0,
      failedCount: 3,
      canVerdict: true,
      advisoryObservations: specificExampleFacts().advisoryObservations,
    });

    expectViolation(
      "The example passed, so all three selected tests pass.",
      "en",
      "advisory_selected_suite_overclaim",
      facts,
    );
    expectUnchanged(
      "The specific example passed 1/1, while the selected-suite evidence timed out.",
      "en",
      facts,
    );
  });

  it("uses a full fallback when a selected-suite overclaim heading contaminates pass bullets", () => {
    const raw = [
      "### 所选用例全部通过",
      "- sample 1 — 通过",
      "- sample 2 — 通过",
      "- sample 3 — 通过",
    ].join("\n");

    const result = applyProductInvariantGuard({
      reply: raw,
      responseLanguage: "zh",
      facts: specificExampleFacts(),
    });

    expect(result.replaced).toBe(true);
    expect(result.strategy).toBe("full_fallback");
    expect(result.violations.map((violation) => violation.invariantId)).toContain(
      "advisory_selected_suite_overclaim",
    );
    expect(result.reply).not.toContain("sample 1");
    expect(result.reply).not.toContain("sample 2");
    expect(result.reply).not.toContain("sample 3");
    expect(result.reply).not.toContain("— 通过");
    expect(
      applyProductInvariantGuard({
        reply: result.reply,
        responseLanguage: "zh",
        facts: specificExampleFacts(),
      }),
    ).toMatchObject({
      reply: result.reply,
      replaced: false,
      strategy: "unchanged",
    });
  });

  it("detects a selected-suite result split across prose lines", () => {
    const raw = ["The selected suite", "passed 3/3."].join("\n");
    const result = applyProductInvariantGuard({
      reply: raw,
      responseLanguage: "en",
      facts: specificExampleFacts(),
    });

    expect(result.replaced).toBe(true);
    expect(result.strategy).toBe("full_fallback");
    expect(result.reply).not.toContain("selected suite\npassed");
    expect(result.violations.map((violation) => violation.invariantId)).toContain(
      "advisory_selected_suite_overclaim",
    );
  });

  it("preserves clean lines, rewrites only the violating line, and is idempotent", () => {
    const cleanFirst = "Keep the left boundary monotonic.";
    const unsafe = "Your changes were not saved; press Ctrl+S first.";
    const cleanLast = "Then rerun the same visible example.";
    const raw = [cleanFirst, unsafe, cleanLast].join("\n");

    const once = applyProductInvariantGuard({
      reply: raw,
      responseLanguage: "en",
      facts: noEvidenceFacts,
    });
    const twice = applyProductInvariantGuard({
      reply: once.reply,
      responseLanguage: "en",
      facts: noEvidenceFacts,
    });

    expect(once.replaced).toBe(true);
    expect(once.strategy).toBe("targeted_line_replacement");
    expect(once.reply).toContain(cleanFirst);
    expect(once.reply).toContain(cleanLast);
    expect(once.reply).not.toContain(unsafe);
    expect(twice).toMatchObject({
      reply: once.reply,
      replaced: false,
      strategy: "unchanged",
      violations: [],
    });
  });
});

function expectViolation(
  reply: string,
  responseLanguage: "zh" | "en",
  invariantId: ProductInvariantId,
  facts: ProductInvariantGuardFacts = noEvidenceFacts,
) {
  const result = applyProductInvariantGuard({
    reply,
    responseLanguage,
    facts,
  });

  expect(result.replaced).toBe(true);
  expect(result.reply).not.toBe(reply);
  expect(result.reply).not.toContain(reply);
  expect(result.violations.map((violation) => violation.invariantId)).toContain(
    invariantId,
  );
}

function expectUnchanged(
  reply: string,
  responseLanguage: "zh" | "en",
  facts: ProductInvariantGuardFacts = noEvidenceFacts,
) {
  expect(
    applyProductInvariantGuard({ reply, responseLanguage, facts }),
  ).toMatchObject({
    reply,
    replaced: false,
    strategy: "unchanged",
    violations: [],
  });
}

function specificExampleFacts(): ProductInvariantGuardFacts {
  return {
    ...noEvidenceFacts,
    advisoryObservations: [
      {
        subject: "current_user_code",
        authority: "advisory",
        scopeKind: "specific_examples",
        status: "passed_visible_tests",
        passedCount: 1,
        failedCount: 0,
        totalCount: 1,
      },
    ],
  };
}

function authoritativeSelectedSuiteFacts(
  overrides: Partial<
    NonNullable<ProductInvariantGuardFacts["authoritativeSelectedSuite"]>
  > & {
    currentCodeAuthoritativeRunStatus?: ProductInvariantGuardFacts["currentCodeAuthoritativeRunStatus"];
    advisoryObservations?: ProductInvariantGuardFacts["advisoryObservations"];
  } = {},
): ProductInvariantGuardFacts {
  const {
    currentCodeAuthoritativeRunStatus =
      "authoritative_run_matches_current_code",
    advisoryObservations = [],
    ...authoritativeOverrides
  } = overrides;

  return {
    currentCodeAuthoritativeRunStatus,
    selectedSuiteTotal: 3,
    authoritativeSelectedSuite: {
      alignedToCurrentCode: true,
      matchesCurrentSelectedSuite: true,
      subject: "current_user_code",
      authority: "authoritative",
      scopeKind: "selected_suite",
      status: "passed_visible_tests",
      passedCount: 3,
      failedCount: 0,
      totalCount: 3,
      canVerdict: true,
      ...authoritativeOverrides,
    },
    advisoryObservations,
  };
}
