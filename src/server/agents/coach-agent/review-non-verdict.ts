import { isNonVerdict } from "@/lib/evidence-trust";
import type { CodeRunResult } from "@/types/code-runner";
import type { CoachDiagnosis, CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";

export function buildNonVerdictReviewResult(args: {
  evidenceVerdict: EvidenceVerdict;
  problemSlug: string;
  problemTags: string[];
  runResult: CodeRunResult;
  responseLanguage: "zh" | "en";
}): CoachReviewResult | undefined {
  if (args.evidenceVerdict.evidenceClass === "local_only") return undefined;
  if (shouldUseStaticRemoteReview(args.evidenceVerdict)) return undefined;
  if (!isNonVerdict(args.evidenceVerdict)) return undefined;

  return {
    diagnosis: buildNeutralDiagnosis({
      problemSlug: args.problemSlug,
      problemTags: args.problemTags,
      runResult: args.runResult,
      userIssueSummary:
        args.evidenceVerdict.evidenceClass === "user_input"
          ? userInputSummary(args.runResult.status)
          : "Execution evidence was unavailable for this Review.",
      coachSummary: args.evidenceVerdict.modelInstruction,
    }),
    coachReply:
      args.evidenceVerdict.evidenceClass === "user_input"
        ? buildUserInputReply(args.responseLanguage, args.runResult.status)
        : buildExecutionUnavailableReply(args.responseLanguage, args.runResult),
    degraded: {
      reason: `${args.evidenceVerdict.evidenceClass}: ${args.runResult.status}`,
      memorySkipped: true,
    },
  };
}

function shouldUseStaticRemoteReview(evidenceVerdict: EvidenceVerdict) {
  return (
    evidenceVerdict.evidenceClass === "evidence_unavailable" &&
    evidenceVerdict.providerUsed === "lc_submit"
  );
}

function buildNeutralDiagnosis(args: {
  problemSlug: string;
  problemTags: string[];
  runResult: CodeRunResult;
  userIssueSummary: string;
  coachSummary: string;
}): CoachDiagnosis {
  return {
    problemSlug: args.problemSlug,
    runStatus: args.runResult.status,
    userIssueSummary: args.userIssueSummary,
    coachSummary: args.coachSummary,
    mistakeTags: [],
    skillTags: args.problemTags,
    memoryUpdateCandidate: {
      facts: [],
      summary:
        "Skipped learner memory updates because this Review is not mistake-memory eligible.",
    },
  };
}

function buildExecutionUnavailableReply(
  language: "zh" | "en",
  runResult: CodeRunResult,
) {
  if (language === "en") {
    return [
      "The execution service was unavailable, so I cannot determine whether this code passes.",
      "Please retry Review My Code or run local visible tests first.",
      runResult.stderr ? `Runner message: ${runResult.stderr}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    "这次执行服务不可用，所以我不能判断你的代码是否通过。",
    "请先重试 Review My Code，或先运行本地可见测试。",
    runResult.stderr ? `Runner message: ${runResult.stderr}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUserInputReply(
  language: "zh" | "en",
  status: CodeRunResult["status"],
) {
  if (language === "en") {
    if (status === "empty_code") {
      return "I cannot run a Review yet because the code editor is empty. Add your current solution first, then run Review My Code.";
    }
    if (status === "no_tests") {
      return "I cannot produce an execution-backed Review because no visible tests were selected. Select or add a visible test, then run Review My Code again.";
    }
    return "This language is not supported in the MVP. Use Python or C++ for execution-backed Review.";
  }
  if (status === "empty_code") {
    return "现在还不能做执行证据型 Review，因为代码区是空的。请先放入你的当前代码，再点 Review My Code。";
  }
  if (status === "no_tests") {
    return "现在还不能做执行证据型 Review，因为没有选中可见测试。请先选择或添加一个可见测试，再点 Review My Code。";
  }
  return "当前语言不在 MVP 支持范围内。请使用 Python 或 C++ 来做执行证据型 Review。";
}

function userInputSummary(status: CodeRunResult["status"]) {
  if (status === "empty_code") {
    return "No code was provided for execution-backed Review.";
  }
  if (status === "no_tests") {
    return "No visible tests were selected for execution-backed Review.";
  }
  if (status === "unsupported_language") {
    return "The selected language is not supported for MVP execution.";
  }
  return `Review input was not judgeable: ${status}.`;
}

export function runResultWithEvidenceVerdict(
  runResult: CodeRunResult,
  evidenceVerdict: EvidenceVerdict,
): CodeRunResult {
  const rawResult =
    runResult.rawResult &&
    typeof runResult.rawResult === "object" &&
    !Array.isArray(runResult.rawResult)
      ? (runResult.rawResult as Record<string, unknown>)
      : {};
  return { ...runResult, rawResult: { ...rawResult, evidenceVerdict } };
}
