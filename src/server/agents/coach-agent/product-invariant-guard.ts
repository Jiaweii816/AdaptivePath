import { hashSelectedTestSuite } from "@/server/code/code-hash";
import type {
  CurrentWorkspaceContext,
  EvidenceAuthority,
  EvidenceScope,
  EvidenceSubject,
  InternalRunEvidenceEnvelope,
} from "./coach-agent.types";

export const PRODUCT_INVARIANT_GUARD_VERSION = "v1" as const;

export type ProductInvariantId =
  | "editor_save_step_fiction"
  | "candidate_run_as_current_code"
  | "advisory_selected_suite_overclaim"
  | "official_acceptance_overclaim";

export type ProductInvariantEvidenceFact = {
  subject: EvidenceSubject;
  authority: EvidenceAuthority;
  scopeKind: EvidenceScope["kind"];
  status: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
};

export type ProductInvariantGuardFacts = {
  currentCodeAuthoritativeRunStatus: CurrentWorkspaceContext["currentCodeAuthoritativeRunStatus"];
  selectedSuiteTotal: number;
  authoritativeSelectedSuite?: ProductInvariantEvidenceFact & {
    alignedToCurrentCode: boolean;
    matchesCurrentSelectedSuite: boolean;
    canVerdict: boolean;
  };
  advisoryObservations: ProductInvariantEvidenceFact[];
};

export type ProductInvariantViolation = {
  invariantId: ProductInvariantId;
  patternIds: string[];
};

export type ProductInvariantPatternMatch = {
  invariantId: ProductInvariantId;
  patternId: string;
};

export type ProductInvariantGuardResult = {
  reply: string;
  replaced: boolean;
  strategy: "unchanged" | "targeted_line_replacement" | "full_fallback";
  violations: ProductInvariantViolation[];
  evidenceSnapshot: ProductInvariantGuardFacts;
  version: typeof PRODUCT_INVARIANT_GUARD_VERSION;
};

type GuardInput = {
  reply: string;
  responseLanguage: "zh" | "en";
  facts: ProductInvariantGuardFacts;
};

type ClaimPattern = {
  id: string;
  regex: RegExp;
};

const OFFICIAL_CLAIM_PATTERNS: ClaimPattern[] = [
  {
    id: "hidden_tests_positive_success_en",
    regex:
      /\b(?:all\s+)?(?:hidden tests?|hidden cases?)\b.{0,32}\b(?:pass(?:ed|es)?|success|succeed(?:ed|s)?|green)\b/i,
  },
  {
    id: "hidden_tests_positive_success_zh",
    regex: /隐藏(?:测试|用例).{0,16}(?:通过|全过|都过|过了|成功)/,
  },
  {
    id: "guaranteed_acceptance_en",
    regex:
      /\b(?:guarantee(?:d)?|definitely|certainly)\b.{0,28}\b(?:acceptance|accepted|AC|pass(?:ed)?|correct(?:ness)?)\b/i,
  },
  {
    id: "official_accepted_en",
    regex:
      /\b(?:(?:leetcode|official(?:ly)?)\s+)?(?:is|was|has been|already|got|gets?)\s+(?:accepted|AC)\b/i,
  },
  {
    id: "leetcode_accepted_en",
    regex: /\b(?:leetcode|official(?:ly)?)\s+(?:accepted|AC)\b/i,
  },
  {
    id: "leetcode_will_accept_en",
    regex: /\b(?:leetcode|the\s+official\s+judge)\s+will\s+accept\b/i,
  },
  {
    id: "official_accepted_zh",
    regex:
      /(?:官方|LeetCode).{0,16}(?:已经|已|肯定|一定)?\s*(?:AC\b|Accepted\b|通过)/i,
  },
  {
    id: "guaranteed_correctness_zh",
    regex:
      /(?:保证|肯定|一定).{0,24}(?:正确|通过|全过|AC\b|Accepted\b|能过.{0,8}(?:官方|LeetCode).{0,8}(?:评测|判题))/i,
  },
  {
    id: "already_accepted_zh",
    regex:
      /(?:代码|解法|它|这份|现在).{0,16}(?:已经|肯定|一定)\s*(?:AC\b|Accepted\b|官方通过)/i,
  },
  {
    id: "official_judge_success_en",
    regex:
      /\b(?:it|this|the\s+(?:code|solution))\s+(?:will|would|can)\s+(?:pass|clear)\s+(?:the\s+)?(?:official|leetcode)\s+(?:judge|tests?)\b/i,
  },
  {
    id: "official_judge_green_zh",
    regex: /(?:官方|LeetCode).{0,10}(?:评测|判题).{0,16}(?:全绿|变绿|全部通过|会过)/i,
  },
];

const EDITOR_CLAIM_PATTERNS: ClaimPattern[] = [
  {
    id: "editor_save_shortcut_required",
    regex:
      /\b(?:press|use|hit)?\s*(?:ctrl|cmd|command)\s*(?:\+|-)\s*s\b/i,
  },
  {
    id: "editor_unsaved_claim_en",
    regex:
      /\b(?:your|the|this)\s+(?:current\s+)?(?:code|changes?|edits?|editor(?:\s+content)?|file)\s+(?:(?:was|were|is|are|has|have)\s+)?(?:probably\s+|maybe\s+|likely\s+)?(?:not|never|wasn't|weren't|isn't|aren't|hasn't|haven't)\s+(?:been\s+)?saved\b/i,
  },
  {
    id: "editor_save_before_action_en",
    regex:
      /\b(?:save|write)\s+(?:your|the|this)\s+(?:code|changes?|edits?|editor(?:\s+content)?|file)\b.{0,36}\b(?:before|then|first|prior to)\b|\b(?:before|prior to)\b.{0,36}\b(?:run|running|review|testing|chat)\b.{0,36}\b(?:save|saving)\b/i,
  },
  {
    id: "editor_old_or_unchanged_en",
    regex:
      /\b(?:the\s+)?editor\b.{0,32}\b(?:still\s+)?(?:has|shows?|uses?|contains?)\b.{0,20}\b(?:old|previous|unchanged|initial|starter|skeleton)\b|\b(?:your|the)\s+(?:code|changes?|edits?)\b.{0,24}\b(?:did not|didn't|has not|hasn't)\s+(?:change|take effect|apply|update|stick|take)\b|\b(?:your|the|this)\s+(?:code|changes?|edits?)\s+(?:is|are|looks?|seems?)\s+(?:still\s+)?(?:unchanged|the same|identical)\b|\b(?:i\s+)?(?:do not|don't|cannot|can't)\s+see\b.{0,28}\b(?:current|your|the)\s+code\b.{0,16}\b(?:change|changed|changes|different)\b|\b(?:the\s+)?(?:runner|run)\b.{0,24}\b(?:still\s+(?:uses?|using|runs?|running)|picked\s+up|loaded|read)\b.{0,20}\b(?:old|previous|earlier)\s+(?:version|code|changes?)\b/i,
  },
  {
    id: "editor_unsaved_claim_zh",
    regex:
      /(?:你的|当前|这份|这段)?(?:代码|修改|改动|编辑器内容|文件).{0,12}(?:没有|没|尚未|未)(?:保存|生效|同步|更新)/,
  },
  {
    id: "editor_save_before_action_zh",
    regex:
      /(?:先|需要|必须|记得|请).{0,10}(?:保存|写入)(?:一下)?(?:代码|修改|改动|文件)?.{0,24}(?:再|然后|才能)(?:运行|执行|测试|评测|Review|聊天)/i,
  },
  {
    id: "editor_old_or_unchanged_zh",
    regex:
      /(?:编辑器|当前代码).{0,18}(?:还是|仍然|依旧).{0,12}(?:旧|原来|之前|未变|初始|骨架|原样|旧版本)|(?:你的|这份|当前)?代码.{0,10}(?:还是|仍然|依旧).{0,18}(?:占位|模板|骨架|初始|原样|旧|最开始)|(?:这|它|当前(?:内容|代码)?).{0,8}(?:还是|仍然|依旧).{0,12}(?:最开始|初始|骨架|原样|旧版本)|(?:还是|仍然|依旧).{0,12}(?:最开始|初始|骨架|原样|旧版本).{0,20}(?:dummy|return|代码|版本|模板|骨架)|(?:修改|改动|代码).{0,16}(?:没有|没|未)(?:生效|更新|变化|应用|被应用|被采用)|(?:代码|修改|改动).{0,12}(?:看起来|似乎|好像).{0,10}(?:和|与).{0,8}(?:上一轮|之前|原来).{0,8}(?:一样|相同|没变)|(?:没有|没)(?:有)?看到.{0,18}(?:(?:当前|你的|这份)(?:的)?代码.{0,12}(?:有|发生)(?:改动|变化)|你(?:提到|所说)(?:的)?(?:改动|修改|变化))|(?:runner|运行器|执行器|Run).{0,18}(?:仍然|还是|依旧|拿到|读到|加载|使用).{0,16}(?:旧|之前|上一次|先前).{0,8}(?:版本|代码|改动)/i,
  },
  {
    id: "editor_save_question_confirmed_zh",
    regex:
      /(?:是不是|是否|可能|也许).{0,12}(?:没|未|没有)保存.{0,24}(?:是的|确实|对|没错).{0,16}(?:需要|必须|先).{0,10}保存/,
  },
];

const SELECTED_SUITE_CLAIM_PATTERNS: ClaimPattern[] = [
  {
    id: "selected_suite_pass_en",
    regex:
      /\b(?:(?:all|every|the full|the complete|the selected|selected|the visible|visible)\s+(?:selected\s+|visible\s+)?(?:\d+\s+)?(?:tests?|cases?|examples?|samples?|suite)\s+(?:have\s+|has\s+|are\s+|were\s+|is\s+)?(?:pass(?:ed|es)?|green|clear(?:ed)?)|(?:passed|passes|cleared)\s+(?:all|every|the full|the complete|the selected|selected|the visible|visible)\s+(?:selected\s+|visible\s+)?(?:\d+\s+)?(?:tests?|cases?|examples?|samples?|suite)|(?:the\s+)?(?:selected|visible|full visible|complete)\s+suite\s+is\s+\d+\s+(?:for|out of)\s+\d+)\b/i,
  },
  {
    id: "selected_suite_pass_zh",
    regex:
      /(?:(?:选中|选择的|所选|可见|全部|所有|整组|完整|这组可见).{0,12}?(?:测试|用例|样例|测试组).{0,12}?(?:通过|全过|都过|过了|全绿|变绿)|(?:通过|全过|全绿).{0,12}?(?:选中|选择的|所选|可见|全部|所有|整组|完整).{0,12}?(?:测试|用例|样例|测试组))/,
  },
];

const CURRENT_CODE_RUN_OUTCOME_PATTERNS: ClaimPattern[] = [
  {
    id: "candidate_attributed_to_current_en",
    regex:
      /\b(?:your|the current|your current|the editor|the editor's)\s+(?:editor\s+)?(?:code|implementation)\b.{0,36}\b(?:pass(?:ed|es)?|fail(?:ed|s)?|error(?:ed|s)?|crash(?:ed|es)?|return(?:ed|s)?|output(?:ted|s)?)\b|\b(?:pass(?:ed|es)?|fail(?:ed|s)?|error(?:ed|s)?|crash(?:ed|es)?)\b.{0,28}\b(?:your|the current|your current|the editor|the editor's)\s+(?:editor\s+)?(?:code|implementation)\b/i,
  },
  {
    id: "candidate_attributed_to_current_zh",
    regex:
      /(?:你的|你这版|你当前的|你现在的|当前的?|现在的|编辑器里的|编辑器当前的)(?:这份|这版|这段)?(?:代码|实现).{0,28}(?:通过|全过|失败|没过|不通过|报错|出错|崩溃|返回|输出)|(?:通过|全过|失败|没过|不通过|报错|出错|崩溃).{0,24}(?:你的|你这版|你当前的|你现在的|当前的?|现在的|编辑器里的)(?:这份|这版|这段)?(?:代码|实现)/i,
  },
];

export function buildProductInvariantGuardFacts(
  workspace: CurrentWorkspaceContext,
): ProductInvariantGuardFacts {
  const authoritative = workspace.latestAuthoritativeRunEvidence;
  const selectedSuiteFingerprint = hashSelectedTestSuite(
    workspace.selectedTests.map((test) => test.id),
  );
  const authoritativeSelectedSuite =
    authoritative?.scope.kind === "selected_suite"
      ? {
          ...toEvidenceFact(authoritative),
          alignedToCurrentCode:
            workspace.currentCodeAuthoritativeRunStatus ===
            "authoritative_run_matches_current_code",
          matchesCurrentSelectedSuite:
            typeof authoritative.suiteFingerprint === "string" &&
            authoritative.suiteFingerprint === selectedSuiteFingerprint,
          canVerdict:
            authoritative.evidenceVerdict?.capabilities.canVerdict === true,
        }
      : undefined;

  return {
    currentCodeAuthoritativeRunStatus:
      workspace.currentCodeAuthoritativeRunStatus,
    selectedSuiteTotal: workspace.selectedTests.length,
    authoritativeSelectedSuite,
    advisoryObservations: workspace.currentTurnRunObservations
      .filter((observation) => observation.authority === "advisory")
      .map(toEvidenceFact),
  };
}

export function applyProductInvariantGuard(
  input: GuardInput,
): ProductInvariantGuardResult {
  const lineMatches = findViolatingLines(input.reply, input.facts);
  const violations = collapseViolations(
    lineMatches.flatMap((entry) => entry.matches),
  );

  if (violations.length === 0) {
    return buildResult(input.reply, false, "unchanged", [], input.facts);
  }

  if (
    violations.some(
      (violation) =>
        violation.invariantId === "advisory_selected_suite_overclaim",
    )
  ) {
    return buildResult(
      buildFullFallback({
        language: input.responseLanguage,
        violations,
        facts: input.facts,
      }),
      true,
      "full_fallback",
      violations,
      input.facts,
    );
  }

  const rewritten = rewriteViolatingLines({
    markdown: input.reply,
    lineMatches,
    language: input.responseLanguage,
    facts: input.facts,
  });
  const residual = collapseViolations(
    findViolatingLines(rewritten, input.facts).flatMap((entry) => entry.matches),
  );

  if (rewritten.trim() && residual.length === 0) {
    return buildResult(
      rewritten,
      true,
      "targeted_line_replacement",
      violations,
      input.facts,
    );
  }

  const fallback = buildFullFallback({
    language: input.responseLanguage,
    violations,
    facts: input.facts,
  });

  return buildResult(
    fallback,
    true,
    "full_fallback",
    violations,
    input.facts,
  );
}

export function findOfficialAcceptanceOverclaims(
  markdown: string,
): ProductInvariantPatternMatch[] {
  return findViolatingLines(markdown, emptyGuardFacts()).flatMap((entry) =>
    entry.matches.filter(
      (match) => match.invariantId === "official_acceptance_overclaim",
    ),
  );
}

function findViolatingLines(markdown: string, facts: ProductInvariantGuardFacts) {
  const scannableLines = collectScannableLines(markdown);
  const matchesByLine = new Map<number, ProductInvariantPatternMatch[]>();
  const individualKeys = new Map<number, Set<string>>();

  for (const line of scannableLines) {
    const matches = findLineMatches(line.text, facts);
    individualKeys.set(
      line.index,
      new Set(matches.map(patternMatchKey)),
    );
    addLineMatches(matchesByLine, [line.index], matches);
  }

  for (let windowSize = 2; windowSize <= 3; windowSize += 1) {
    for (let start = 0; start + windowSize <= scannableLines.length; start += 1) {
      const window = scannableLines.slice(start, start + windowSize);
      if (!linesShareProseBlock(window)) {
        continue;
      }

      const crossLineMatches = findLineMatches(
        window.map((line) => line.text.trim()).join(" "),
        facts,
      ).filter((match) =>
        window.every(
          (line) => !individualKeys.get(line.index)?.has(patternMatchKey(match)),
        ),
      );
      addLineMatches(
        matchesByLine,
        window.map((line) => line.index),
        crossLineMatches,
      );
    }
  }

  return [...matchesByLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([lineIndex, matches]) => ({
      lineIndex,
      matches: uniquePatternMatches(matches),
    }));
}

type ScannableLine = {
  index: number;
  text: string;
  blockId: number;
};

function collectScannableLines(markdown: string): ScannableLine[] {
  const result: ScannableLine[] = [];
  let fence: { marker: "```" | "~~~"; prose: boolean } | undefined;
  let blockId = 0;

  markdown.split("\n").forEach((line, index) => {
    const fenceLine = readFenceLine(line);
    if (fenceLine) {
      if (fence?.marker === fenceLine.marker) {
        fence = undefined;
      } else if (!fence) {
        fence = {
          marker: fenceLine.marker,
          prose: isProseFenceLanguage(fenceLine.language),
        };
      }
      blockId += 1;
      return;
    }

    if (!line.trim()) {
      blockId += 1;
      return;
    }

    if (fence && !fence.prose) {
      return;
    }

    result.push({ index, text: line, blockId });
  });

  return result;
}

function linesShareProseBlock(lines: ScannableLine[]) {
  return (
    lines.length > 0 &&
    lines.every(
      (line, index) =>
        line.blockId === lines[0]?.blockId &&
        (index === 0 || line.index === lines[index - 1]!.index + 1),
    )
  );
}

function addLineMatches(
  matchesByLine: Map<number, ProductInvariantPatternMatch[]>,
  lineIndexes: number[],
  matches: ProductInvariantPatternMatch[],
) {
  if (matches.length === 0) {
    return;
  }

  for (const lineIndex of lineIndexes) {
    matchesByLine.set(lineIndex, [
      ...(matchesByLine.get(lineIndex) ?? []),
      ...matches,
    ]);
  }
}

function patternMatchKey(match: ProductInvariantPatternMatch) {
  return `${match.invariantId}:${match.patternId}`;
}

function findLineMatches(
  line: string,
  facts: ProductInvariantGuardFacts,
): ProductInvariantPatternMatch[] {
  const matches: ProductInvariantPatternMatch[] = [];

  for (const pattern of EDITOR_CLAIM_PATTERNS) {
    if (hasUnsafeEditorMatch(line, pattern)) {
      matches.push({
        invariantId: "editor_save_step_fiction",
        patternId: pattern.id,
      });
    }
  }

  if (!canClaimSelectedSuitePassed(facts)) {
    for (const pattern of selectedSuitePatterns(facts.selectedSuiteTotal)) {
      if (hasUnsafePositiveMatch(line, pattern, "selected_suite")) {
        matches.push({
          invariantId: "advisory_selected_suite_overclaim",
          patternId: pattern.id,
        });
      }
    }
  }

  if (hasCandidateOnlyRunEvidence(facts)) {
    for (const pattern of CURRENT_CODE_RUN_OUTCOME_PATTERNS) {
      if (hasUnsafeCandidateAttribution(line, pattern)) {
        matches.push({
          invariantId: "candidate_run_as_current_code",
          patternId: pattern.id,
        });
      }
    }
  }

  for (const pattern of OFFICIAL_CLAIM_PATTERNS) {
    if (hasUnsafePositiveMatch(line, pattern, "official")) {
      matches.push({
        invariantId: "official_acceptance_overclaim",
        patternId: pattern.id,
      });
    }
  }

  return uniquePatternMatches(matches);
}

function hasCandidateOnlyRunEvidence(facts: ProductInvariantGuardFacts) {
  const hasCandidate = facts.advisoryObservations.some(
    (observation) => observation.subject === "assistant_candidate",
  );
  const hasCurrentAdvisory = facts.advisoryObservations.some(
    (observation) => observation.subject === "current_user_code",
  );
  const hasAlignedAuthoritativeCurrent =
    facts.authoritativeSelectedSuite?.alignedToCurrentCode === true;
  return hasCandidate && !hasCurrentAdvisory && !hasAlignedAuthoritativeCurrent;
}

function hasUnsafeCandidateAttribution(line: string, pattern: ClaimPattern) {
  return splitClaimClauses(line).some((clause) => {
    if (!pattern.regex.test(clause)) return false;
    if (/[?？]\s*$/.test(clause)) return false;
    return !/(?:候选|assistant candidate|candidate edit).{0,28}(?:不是|不代表|不能|does not|doesn't|is not|isn't).{0,24}(?:你的|当前|编辑器|your|current|editor)/iu.test(
      clause,
    );
  });
}

function selectedSuitePatterns(selectedSuiteTotal: number): ClaimPattern[] {
  if (selectedSuiteTotal <= 0) {
    return SELECTED_SUITE_CLAIM_PATTERNS;
  }

  const total = escapeRegex(String(selectedSuiteTotal));
  return [
    ...SELECTED_SUITE_CLAIM_PATTERNS,
    {
      id: "selected_suite_matching_fraction",
      regex: new RegExp(
        `(?:\\b${total}\\s*\\/\\s*${total}\\b.{0,24}\\bpass(?:ed|es)?\\b|${total}\\s*\\/\\s*${total}.{0,18}(?:通过|全过|都过|过了))`,
        "i",
      ),
    },
    {
      id: "selected_suite_matching_count_zh",
      regex: new RegExp(
        `${total}\\s*(?:个|组)?(?:测试|用例|样例).{0,12}(?:全部|都|全)?(?:通过|过了|全过)`,
      ),
    },
  ];
}

function hasUnsafeEditorMatch(line: string, pattern: ClaimPattern) {
  for (const clause of splitClaimClauses(line)) {
    if (!pattern.regex.test(clause)) {
      continue;
    }

    if (editorClaimIsExplicitCorrection(clause, pattern.id)) {
      continue;
    }

    return true;
  }

  return false;
}

function hasUnsafePositiveMatch(
  line: string,
  pattern: ClaimPattern,
  kind: "selected_suite" | "official",
) {
  for (const clause of splitClaimClauses(line)) {
    for (const match of findPatternMatches(clause, pattern.regex)) {
      if (
        !positiveClaimIsLimitedOrConditional({
          clause,
          matchIndex: match.index,
          matchText: match.text,
          kind,
        })
      ) {
        return true;
      }
    }
  }

  return false;
}

function splitClaimClauses(line: string) {
  return line
    .split(
      /(?<=[。！？!?；;.])|\b(?:but|however|yet|nevertheless|although|though|even though)\b|(?:但是|不过|然而|但|虽然|尽管)/i,
    )
    .map((part) => part.trim())
    .filter(Boolean);
}

function editorClaimIsExplicitCorrection(clause: string, patternId: string) {
  if (patternId === "editor_save_shortcut_required") {
    return /(?:no need|do not need|don't need|does not need|doesn't need|is not needed|isn't needed|without needing|无需|不用|不需要|没必要).{0,28}(?:ctrl|cmd|command)\s*(?:\+|-)\s*s|(?:ctrl|cmd|command)\s*(?:\+|-)\s*s.{0,20}(?:is not needed|isn't needed|无需|不用|不需要|没必要)/i.test(
      clause,
    );
  }

  return (
    /(?:not because|isn't because|does not mean|doesn't mean|cannot infer|can't infer|(?<!是)不是|不代表|不意味着|并非|不能说明|无法推断).{0,36}(?:not saved|unsaved|没保存|未保存|没有保存|旧版本|old version|unchanged)/i.test(
      clause,
    ) ||
    /(?:not saved|unsaved|没保存|未保存|没有保存|旧版本|old version|unchanged).{0,24}(?:is not the (?:cause|reason)|isn't the (?:cause|reason)|不是原因|并非原因|不成立)/i.test(
      clause,
    ) ||
    /(?:runner|运行器|执行器|Run).{0,14}(?:并没有|没有|没|并未|不是).{0,10}(?:使用|读取|加载|拿到).{0,10}(?:旧|之前|先前).{0,8}(?:代码|版本)/i.test(
      clause,
    )
  );
}

function positiveClaimIsLimitedOrConditional(args: {
  clause: string;
  matchIndex: number;
  matchText: string;
  kind: "selected_suite" | "official";
}) {
  const prefix = args.clause.slice(0, args.matchIndex);
  const localPrefix = prefix.slice(-120);
  const suffix = args.clause.slice(args.matchIndex + args.matchText.length);
  const limitation =
    /(?:cannot|can't|cant|can not|do not|don't|does not|doesn't|must not|should not|shouldn't|not enough evidence|does not mean|doesn't mean|not guarantee|without evidence|不能|无法|不代表|不等于|不保证|不意味着|没有证据|证据不足|不能说明)/i;
  if (limitation.test(localPrefix)) {
    return true;
  }

  if (
    /^(?:\s*(?:if|when|once|after)\b|\s*(?:如果|若|当|等|待).{0,20})/i.test(
      args.clause,
    ) ||
    /(?:通过|Accepted|AC)后/.test(localPrefix) ||
    /^\s*后/.test(suffix)
  ) {
    return true;
  }

  if (claimIsQuestion(args.clause, localPrefix)) {
    return true;
  }

  if (
    args.kind === "selected_suite" &&
    /(?:\b(?:need|needs|needed|aim|aims|goal|target|try|trying|must|should|want|plan)\s+(?:is\s+)?(?:to\s+)?$|(?:需要|目标|争取|尽量|应该|必须|计划).{0,12}$)/i.test(
      localPrefix,
    )
  ) {
    return true;
  }

  if (args.kind === "official") {
    if (
      /(?:whether|can you (?:confirm|check)|did it|是否|能否|可否|确认是否).{0,28}(?:accepted|AC|official|leetcode|官方|通过)/i.test(
        args.clause,
      )
    ) {
      return true;
    }

    const hasPositivePromise =
      /(?:guarantee|guaranteed|definitely|certainly|will pass|will be accepted|保证|肯定|一定|会过|全绿)/i.test(
        args.clause,
      );
    return (
      !hasPositivePromise &&
      /^(?:\s*(?:please\s+)?(?:submit|verify|confirm|check)|\s*(?:请|去|可以|需要).{0,8}(?:提交|评测|验证|确认))\b/i.test(
        args.clause,
      )
    );
  }

  return false;
}

function claimIsQuestion(clause: string, localPrefix: string) {
  void localPrefix;
  if (!/[?？]\s*$/.test(clause)) {
    return false;
  }

  const startsAsQuestion =
    /^\s*(?:could|can|would|will|did|do|does|is|are|has|have|might|may|whether)\b|^\s*(?:是否|能否|会不会|有没有|可否|难道)/i.test(
      clause,
    );
  if (startsAsQuestion) {
    return true;
  }

  const isTagQuestion =
    /[,，]\s*(?:right|correct|isn't it|aren't they|didn't it|doesn't it|yes|no)\s*\?\s*$|[,，]\s*(?:对吗|是吗|没错吧|对吧|是不是)\s*？\s*$/i.test(
      clause,
    );
  return !isTagQuestion;
}

function findPatternMatches(text: string, regex: RegExp) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const search = new RegExp(regex.source, flags);
  const matches: Array<{ index: number; text: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = search.exec(text)) !== null) {
    matches.push({ index: match.index, text: match[0] });
    if (match[0].length === 0) {
      search.lastIndex += 1;
    }
  }

  return matches;
}

function canClaimSelectedSuitePassed(facts: ProductInvariantGuardFacts) {
  const evidence = facts.authoritativeSelectedSuite;
  return Boolean(
    evidence &&
      evidence.alignedToCurrentCode &&
      evidence.matchesCurrentSelectedSuite &&
      evidence.subject === "current_user_code" &&
      evidence.authority === "authoritative" &&
      evidence.scopeKind === "selected_suite" &&
      evidence.canVerdict &&
      evidence.status === "passed_visible_tests" &&
      evidence.failedCount === 0 &&
      evidence.passedCount === facts.selectedSuiteTotal &&
      evidence.totalCount === facts.selectedSuiteTotal,
  );
}

function rewriteViolatingLines(args: {
  markdown: string;
  lineMatches: Array<{
    lineIndex: number;
    matches: ProductInvariantPatternMatch[];
  }>;
  language: "zh" | "en";
  facts: ProductInvariantGuardFacts;
}) {
  const matchesByLine = new Map(
    args.lineMatches.map((entry) => [entry.lineIndex, entry.matches]),
  );
  const emittedCorrections = new Set<string>();

  return args.markdown
    .split("\n")
    .map((line, index) => {
      const matches = matchesByLine.get(index);
      if (!matches) {
        return line;
      }

      const prefix = line.match(/^(\s*(?:(?:[-+*]|\d+[.)])\s+|>\s*)?)/)?.[0] ?? "";
      const corrections = collapseViolations(matches).map((violation) =>
        buildInvariantCorrection({
          language: args.language,
          invariantId: violation.invariantId,
          facts: args.facts,
        }),
      );
      const correction = [...new Set(corrections)].join(" ");
      if (emittedCorrections.has(correction)) {
        return "";
      }
      emittedCorrections.add(correction);

      return `${prefix}${correction}`;
    })
    .join("\n");
}

function buildInvariantCorrection(args: {
  language: "zh" | "en";
  invariantId: ProductInvariantId;
  facts: ProductInvariantGuardFacts;
}) {
  if (args.invariantId === "editor_save_step_fiction") {
    return args.language === "en"
      ? "The editor's current contents are used directly for this turn; base the diagnosis on the current code and available Run or Review evidence."
      : "编辑器当前内容会直接作为本轮代码使用；请以当前代码和已有的 Run 或 Review 证据为准。";
  }

  if (args.invariantId === "official_acceptance_overclaim") {
    return args.language === "en"
      ? "PatternCoach can report only the available visible execution evidence; use LeetCode's official judge for final acceptance."
      : "PatternCoach 只能报告当前已有的可见执行证据；最终是否通过请以 LeetCode 官方评测为准。";
  }

  if (args.invariantId === "candidate_run_as_current_code") {
    return args.language === "en"
      ? "The execution result belongs only to the assistant-constructed candidate. It does not describe or change the learner's current editor code."
      : "这次执行结果只属于助手构造的候选代码，不能描述成用户当前编辑器代码的运行结果，也不会修改编辑器代码。";
  }

  const authoritative = args.facts.authoritativeSelectedSuite;
  if (authoritative?.alignedToCurrentCode && authoritative.canVerdict) {
    const counts = `${authoritative.passedCount}/${authoritative.totalCount}`;
    return args.language === "en"
      ? `The authoritative selected-suite evidence is ${counts} with status ${authoritative.status}; a scoped assistant-run example does not replace that suite result.`
      : `当前可信的选中测试证据是 ${counts}，状态为 ${authoritative.status}；助手运行的特定示例不能替代整组选中测试结果。`;
  }

  return args.language === "en"
    ? "A scoped assistant-run example describes only that example; it does not establish the current selected-suite result."
    : "助手运行的特定示例只说明该示例，不能据此判定当前选中的整组测试结果。";
}

function buildFullFallback(args: {
  language: "zh" | "en";
  violations: ProductInvariantViolation[];
  facts: ProductInvariantGuardFacts;
}) {
  return [
    ...new Set(
      args.violations.map((violation) =>
        buildInvariantCorrection({
          language: args.language,
          invariantId: violation.invariantId,
          facts: args.facts,
        }),
      ),
    ),
  ].join("\n\n");
}

function collapseViolations(matches: ProductInvariantPatternMatch[]) {
  const byInvariant = new Map<ProductInvariantId, Set<string>>();
  for (const match of matches) {
    const patternIds = byInvariant.get(match.invariantId) ?? new Set<string>();
    patternIds.add(match.patternId);
    byInvariant.set(match.invariantId, patternIds);
  }

  return [...byInvariant.entries()].map(([invariantId, patternIds]) => ({
    invariantId,
    patternIds: [...patternIds],
  }));
}

function uniquePatternMatches(matches: ProductInvariantPatternMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.invariantId}:${match.patternId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildResult(
  reply: string,
  replaced: boolean,
  strategy: ProductInvariantGuardResult["strategy"],
  violations: ProductInvariantViolation[],
  facts: ProductInvariantGuardFacts,
): ProductInvariantGuardResult {
  return {
    reply,
    replaced,
    strategy,
    violations,
    evidenceSnapshot: facts,
    version: PRODUCT_INVARIANT_GUARD_VERSION,
  };
}

function toEvidenceFact(
  evidence: InternalRunEvidenceEnvelope,
): ProductInvariantEvidenceFact {
  return {
    subject: evidence.subject,
    authority: evidence.authority,
    scopeKind: evidence.scope.kind,
    status: evidence.result.status,
    passedCount: evidence.result.passedCount,
    failedCount: evidence.result.failedCount,
    totalCount:
      evidence.scope.totalCount ??
      evidence.result.passedCount + evidence.result.failedCount,
  };
}

function readFenceLine(
  line: string,
): { marker: "```" | "~~~"; language: string } | undefined {
  const match = line.match(/^\s*(```|~~~)\s*([^\s`]*)/);
  if (match?.[1] !== "```" && match?.[1] !== "~~~") {
    return undefined;
  }

  return {
    marker: match[1],
    language: (match[2] ?? "").toLowerCase(),
  };
}

function isProseFenceLanguage(language: string) {
  return new Set(["text", "txt", "plaintext", "plain", "markdown", "md", "prose"]).has(
    language,
  );
}

function emptyGuardFacts(): ProductInvariantGuardFacts {
  return {
    currentCodeAuthoritativeRunStatus: "no_authoritative_run_yet",
    selectedSuiteTotal: 0,
    advisoryObservations: [],
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
