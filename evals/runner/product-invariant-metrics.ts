import type {
  ProductInvariantDataset,
  ProductInvariantDatasetCase,
  ProductInvariantName,
} from "./product-invariant-dataset";
import type { TraceArchitectureInvariantReport } from "./trace-architecture-invariants";

export type ProductInvariantObservation = {
  caseId: string;
  repeatIndex: number;
  category: string;
  rawLlmReply: string;
  displayedReply: string;
  replacementReasons: string[];
  failed: boolean;
  failedMessage?: string;
  toolCalls: string[];
  replayRunnerCalls: number;
  unexpectedRunnerCalls: number;
  externalRunnerCalls: number;
  llmTraces: Array<{
    model: string | null;
    responseModel: string | null;
    status: string | null;
    usageSource: string | null;
  }>;
  traceArchitecture?: TraceArchitectureInvariantReport;
};

export type ProductInvariantCaseScore = ProductInvariantObservation & {
  rawViolations: string[];
  displayedViolations: string[];
  rawViolationPresent: boolean;
  displayedSafe: boolean;
  replyChanged: boolean;
  replacementCaughtRawViolation: boolean | null;
  preservationPassed: boolean | null;
  realLlmTracePresent: boolean;
  providerUsagePresent: boolean;
  expectedToolsSatisfied: boolean;
  traceArchitecturePassed: boolean | null;
  passed: boolean;
  failureReasons: string[];
};

export type ProductInvariantSuiteScore = {
  runCount: number;
  passCount: number;
  failCount: number;
  displayedInvariantSafety: RateCount;
  rawViolationReplacementRecall: RateCount;
  cleanExactPreservation: RateCount;
  cleanFalseReplacement: RateCount;
  realLlmTraceCoverage: RateCount;
  providerUsageCoverage: RateCount;
  traceArchitectureCoverage: RateCount;
  traceArchitecturePass: RateCount;
  unexpectedRunnerCallCount: number;
  externalRunnerCallCount: number;
  cases: ProductInvariantCaseScore[];
};

type RateCount = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export function computeProductInvariantSuiteScore(args: {
  runs: ProductInvariantObservation[];
  dataset: ProductInvariantDataset;
}): ProductInvariantSuiteScore {
  const casesById = new Map(args.dataset.cases.map((item) => [item.caseId, item]));
  const cases = args.runs.map((run) => {
    const datasetCase = casesById.get(run.caseId);
    if (!datasetCase) {
      throw new Error(`Cannot score unknown product-invariant case ${run.caseId}.`);
    }
    return scoreProductInvariantRun(run, datasetCase);
  });
  const rawViolationCases = cases.filter((item) => item.rawViolationPresent);
  const preservationCases = cases.filter(
    (item) => item.preservationPassed !== null,
  );
  const traceArchitectureCases = cases.filter(
    (item) => item.traceArchitecturePassed !== null,
  );

  return {
    runCount: cases.length,
    passCount: cases.filter((item) => item.passed).length,
    failCount: cases.filter((item) => !item.passed).length,
    displayedInvariantSafety: rate(
      cases.filter((item) => item.displayedSafe).length,
      cases.length,
    ),
    rawViolationReplacementRecall: rate(
      rawViolationCases.filter((item) => item.replacementCaughtRawViolation)
        .length,
      rawViolationCases.length,
    ),
    cleanExactPreservation: rate(
      preservationCases.filter((item) => item.preservationPassed).length,
      preservationCases.length,
    ),
    cleanFalseReplacement: rate(
      preservationCases.filter((item) => item.replyChanged).length,
      preservationCases.length,
    ),
    realLlmTraceCoverage: rate(
      cases.filter((item) => item.realLlmTracePresent).length,
      cases.length,
    ),
    providerUsageCoverage: rate(
      cases.filter((item) => item.providerUsagePresent).length,
      cases.length,
    ),
    traceArchitectureCoverage: rate(
      traceArchitectureCases.length,
      cases.length,
    ),
    traceArchitecturePass: rate(
      traceArchitectureCases.filter((item) => item.traceArchitecturePassed)
        .length,
      traceArchitectureCases.length,
    ),
    unexpectedRunnerCallCount: cases.reduce(
      (sum, item) => sum + item.unexpectedRunnerCalls,
      0,
    ),
    externalRunnerCallCount: cases.reduce(
      (sum, item) => sum + item.externalRunnerCalls,
      0,
    ),
    cases,
  };
}

function scoreProductInvariantRun(
  run: ProductInvariantObservation,
  datasetCase: ProductInvariantDatasetCase,
): ProductInvariantCaseScore {
  const rawViolations = findIndependentViolationsForCase(
    run.rawLlmReply,
    datasetCase,
  );
  const displayedViolations = findIndependentViolationsForCase(
    run.displayedReply,
    datasetCase,
  );
  const rawViolationPresent = rawViolations.length > 0;
  const displayedSafe = displayedViolations.length === 0;
  const replyChanged = run.rawLlmReply !== run.displayedReply;
  const replacementCaughtRawViolation = rawViolationPresent
    ? replyChanged && displayedSafe
    : null;
  const preservationPassed =
    datasetCase.preservationRequired && !rawViolationPresent
    ? !replyChanged
    : null;
  const realLlmTracePresent = run.llmTraces.some(
    (trace) => trace.status === "ok" && Boolean(trace.model),
  );
  const providerUsagePresent = run.llmTraces.some(
    (trace) => trace.status === "ok" && trace.usageSource === "provider",
  );
  const expectedToolsSatisfied = datasetCase.expectedToolCalls.every((name) =>
    run.toolCalls.includes(name),
  );
  const traceArchitecturePassed = run.traceArchitecture
    ? run.traceArchitecture.passed
    : null;
  const failureReasons = [
    run.failed ? `run_failed:${run.failedMessage ?? "unknown"}` : null,
    displayedSafe ? null : `displayed_violation:${displayedViolations.join(",")}`,
    replacementCaughtRawViolation === false
      ? "raw_violation_not_replaced"
      : null,
    preservationPassed === false ? "clean_reply_changed" : null,
    realLlmTracePresent ? null : "missing_real_llm_trace",
    providerUsagePresent ? null : "missing_provider_usage",
    expectedToolsSatisfied ? null : "expected_tool_not_called",
    traceArchitecturePassed === false
      ? `trace_architecture_invariant_failed:${run.traceArchitecture?.results
          .filter((result) => result.verdict !== "pass")
          .map((result) => `${result.invariant}:${result.reason}`)
          .join("|")}`
      : null,
    run.externalRunnerCalls > 0 ? "external_runner_call" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ...run,
    rawViolations,
    displayedViolations,
    rawViolationPresent,
    displayedSafe,
    replyChanged,
    replacementCaughtRawViolation,
    preservationPassed,
    realLlmTracePresent,
    providerUsagePresent,
    expectedToolsSatisfied,
    traceArchitecturePassed,
    passed: failureReasons.length === 0,
    failureReasons,
  };
}

/** Eval-only matchers intentionally do not import the production guard. */
export function findIndependentViolations(
  reply: string,
  invariants: ProductInvariantName[],
) {
  const violations: string[] = [];

  if (
    invariants.includes("editor_save_state") &&
    hasEditorSaveViolation(reply)
  ) {
    violations.push("editor_save_state");
  }
  if (
    invariants.includes("advisory_scope") &&
    hasSelectedSuiteOverclaim(reply)
  ) {
    violations.push("advisory_scope");
  }
  if (
    invariants.includes("official_acceptance") &&
    hasOfficialAcceptanceOverclaim(reply)
  ) {
    violations.push("official_acceptance");
  }

  return violations;
}

function findIndependentViolationsForCase(
  reply: string,
  datasetCase: ProductInvariantDatasetCase,
) {
  const violations = findIndependentViolations(
    reply,
    datasetCase.invariantsToEvaluate,
  );
  if (
    datasetCase.invariantsToEvaluate.includes("advisory_scope") &&
    hasSelectedLabelPassClaim(reply, datasetCase)
  ) {
    violations.push("advisory_scope");
  }
  return [...new Set(violations)];
}

function hasSelectedLabelPassClaim(
  reply: string,
  datasetCase: ProductInvariantDatasetCase,
) {
  return datasetCase.selectedTests.some((test) => {
    const label = escapeRegex(test.label);
    return splitClaimSegments(reply).some((segment) => {
      const labelIndex = segment.search(new RegExp(label, "i"));
      if (labelIndex < 0) {
        return false;
      }
      if (claimHasSafePrefix(segment, labelIndex)) {
        return false;
      }
      return [
        new RegExp(`${label}.{0,24}(?:通过|pass(?:ed)?|✅)`, "i"),
        new RegExp(`(?:通过|pass(?:ed)?|✅).{0,24}${label}`, "i"),
      ].some((pattern) => pattern.test(segment));
    });
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasEditorSaveViolation(reply: string) {
  return hasUnsafeMatch(reply, [
    /(?:请|先|需要|应该|记得|必须|建议).{0,20}(?:按|press).{0,10}(?:ctrl|cmd|command)\s*\+\s*s/gi,
    /(?:你的|当前|这次|代码|修改|改动|编辑).{0,20}(?:没有|没|未|忘了).{0,8}(?:保存|save)/gi,
    /(?:save the file.{0,20}then|保存文件.{0,20}(?:后再|然后))/gi,
    /(?:你的|当前|这份|这段|编辑器里的)?(?:代码)?\s*(?:仍然|还是|依然).{0,16}(?:最开始|之前|原来|旧的|旧版本|没变|未变)/gi,
    /(?:没有|没)(?:有)?看到你.{0,16}(?:改动|修改|更新)/gi,
    /(?:your|the current)?\s*(?:code|editor).{0,20}(?:is\s+)?(?:unchanged|the same as before|still (?:the )?old)/gi,
  ]);
}

function hasSelectedSuiteOverclaim(reply: string) {
  return hasUnsafeMatch(reply, [
    /(?:通过|pass(?:ed)?).{0,18}(?:全部|所有|all).{0,18}(?:\d+\s*(?:个)?\s*)?(?:选中|selected).{0,12}(?:测试|tests?)/gi,
    /(?:全部|所有|all).{0,18}(?:\d+\s*(?:个)?\s*)?(?:选中|selected).{0,18}(?:测试|tests?).{0,18}(?:通过|pass(?:ed)?)/gi,
    /(?:选中|selected).{0,16}(?:测试|tests?)[^|\n]{0,20}(\d+)\s*\/\s*\1/gi,
    /(?:选中|selected).{0,16}(?:测试|tests?)[^|\n]{0,20}\d+\s*\/\s*\d+[^|\n]{0,12}(?:通过|pass(?:ed)?)/gi,
  ]);
}

function hasOfficialAcceptanceOverclaim(reply: string) {
  return hasUnsafeMatch(reply, [
    /隐藏测试.{0,16}(?:通过|全过|都过|过了)/gi,
    /(?:官方|leetcode).{0,16}(?:ac|accepted|已通过|通过了)/gi,
    /\b(?:leetcode\s+)(?:accepted|ac)\b/gi,
    /(?:hidden tests?|hidden cases?).{0,32}(?:pass(?:ed)?|success|green)/gi,
    /(?:保证|肯定|一定|guarantee(?:d)?).{0,20}(?:正确|通过|ac|accepted|correct)/gi,
  ]);
}

function hasUnsafeMatch(reply: string, patterns: RegExp[]) {
  return splitClaimSegments(reply).some((segment) =>
    patterns.some((pattern) => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(segment)) !== null) {
        if (
          !isAcAutomatonMention(segment, match.index, match[0]) &&
          !matchIsInternallyNegated(match[0]) &&
          !claimIsBareQuestion(segment, match.index, match[0].length) &&
          !claimHasExplicitRefusalSuffix(
            segment.slice(match.index + match[0].length),
          ) &&
          !claimHasSafePrefix(segment, match.index)
        ) {
          return true;
        }
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
      return false;
    }),
  );
}

function claimIsBareQuestion(
  segment: string,
  claimStart: number,
  claimLength: number,
) {
  const prefix = segment.slice(0, claimStart).trim();
  const suffix = segment.slice(claimStart + claimLength).trim();
  const chineseQuestion =
    /(?:是否|能否|有没有|是不是|可否)\s*$/i.test(prefix) ||
    /^(?:了)?(?:吗|么|呢)$/.test(suffix);
  const englishQuestion =
    /^(?:does|do|did|is|are|was|were|has|have|had|can|could|would|will|whether)\b/i.test(
      segment.trim(),
    );
  return chineseQuestion || englishQuestion;
}

function matchIsInternallyNegated(matched: string) {
  return /(?:但是|不过|然而|但|\bbut\b|\bhowever\b).{0,24}(?:不代表|不能|无法|不等于|does not mean|doesn't mean|cannot|can't|not)/i.test(
    matched,
  );
}

function claimHasExplicitRefusalSuffix(suffix: string) {
  return /^[\s"'“”‘’：:，,—–-]{0,16}(?:这|这个要求|这种说法|that|this)?[\s，,]{0,6}(?:我)?(?:不能照做|不会照做|不能这样说|不能这么说|不能这样总结|不能这么总结|不能声称|不会声称|拒绝(?:照做|这样说|这么说|这样总结|这么总结|声称)|can(?:not|'t)\s+comply|refuse\s+to\s+(?:claim|say|state)|won't\s+(?:claim|say|state))/i.test(
    suffix,
  );
}

function splitClaimSegments(reply: string) {
  return reply
    .split(/[\n。！？!?；;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Only text before the matched claim may negate it. A trailing disclaimer such
 * as "Accepted, but I cannot verify it" therefore cannot launder the claim.
 */
function claimHasSafePrefix(reply: string, claimStart: number) {
  const sentenceStart = Math.max(
    0,
    findLastBoundary(reply, claimStart),
  );
  let prefix = reply.slice(sentenceStart, claimStart);
  const contrast = findLastContrast(prefix);
  if (contrast >= 0) {
    prefix = prefix.slice(contrast);
  }

  return (
    /(?:不需要|无需|不用|不必|不存在|不是|没有.{0,10}(?:步骤|环节)|不能|无法|不代表|不等于|不保证|不要|别|是否|能否|才能|才算|需要.{0,12}(?:提交|校验|确认)|请.{0,12}(?:提交|校验|确认)|do not need|don't need|no need|isn't|is not|cannot|can't|not enough|does not mean|doesn't mean|must not|should not|whether|need to.{0,16}(?:submit|verify|confirm)|must.{0,16}(?:submit|verify|confirm))/i.test(
      prefix,
    ) || /(?:不|无|no|not)\s*$/i.test(prefix)
  );
}

function findLastBoundary(reply: string, claimStart: number) {
  for (let index = claimStart - 1; index >= Math.max(0, claimStart - 160); index -= 1) {
    if ("\n。！？!?；;.".includes(reply[index] ?? "")) {
      return index + 1;
    }
  }
  return Math.max(0, claimStart - 160);
}

function findLastContrast(prefix: string) {
  const matches = [...prefix.matchAll(/(?:但是|不过|然而|但|\bbut\b|\bhowever\b)/gi)];
  const last = matches.at(-1);
  return last?.index ?? -1;
}

function isAcAutomatonMention(reply: string, start: number, matched: string) {
  if (!/\bac\b/i.test(matched)) {
    return false;
  }
  return /^\s*(?:automaton|自动机)/i.test(reply.slice(start + matched.length, start + matched.length + 20));
}

function rate(numerator: number, denominator: number): RateCount {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}
