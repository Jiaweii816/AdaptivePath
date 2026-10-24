import { DIAGNOSIS_SENTINEL } from "./review-output-protocol";
import { formatReviewMemorySection } from "./review-memory";
import type { CoachReviewInput } from "./coach-agent.types";

type ReviewMode = "passed" | "diagnostic" | "static_remote_unavailable";

function reviewMode(input: CoachReviewInput): ReviewMode {
  if (isStaticRemoteUnavailableReview(input)) {
    return "static_remote_unavailable";
  }

  return input.runResult.status === "passed_visible_tests"
    ? "passed"
    : "diagnostic";
}

function isStaticRemoteUnavailableReview(input: CoachReviewInput) {
  return (
    input.evidenceVerdict?.evidenceClass === "evidence_unavailable" &&
    input.evidenceVerdict.providerUsed === "lc_submit"
  );
}

function buildReplyShapeInstruction(
  mode: ReviewMode,
  localOnly: boolean,
): string[] {
  if (mode === "static_remote_unavailable") {
    return [
      "1) First write one static Review reply as plain markdown, with no fixed headings.",
      "   - The first sentence must be exactly: 远程 LeetCode 评测暂时不可用，当前为静态代码审查，并非官方判定结果。建议您点击左侧 LeetCode 链接提交代码以获取官方正式评测。",
      "   - After that sentence, add a concise static code review opinion based on the problem statement, constraints, method signature, and user code.",
      "   - Use the Review thinking model internally, but do not reveal chain-of-thought, '<think>' tags, or reasoning-process labels.",
      "   - Do not claim the code passed, failed, was accepted, or was rejected. Do not cite local visible-test pass counts as the Review result.",
      "   - Keep the static opinion short: one likely risk or one reason the approach appears plausible, plus one concrete boundary case to verify manually or on LeetCode.",
    ];
  }

  if (mode === "passed") {
    if (localOnly) {
      return [
        "1) First write one short Local-Evidence Examiner reply as plain markdown, with no fixed headings.",
        "   - State that the current revision passed the selected local visible tests, and name the observed count only when useful.",
        "   - Make clear in the same reply that this is not an official LeetCode verdict and does not cover hidden tests.",
        "   - You may briefly assess the algorithm against the supplied statement and constraints, but do not convert local passing cases into an official correctness claim.",
        "   - End with ONE next step: add/trace one meaningful boundary case or verify with the official judge. Keep optimization opt-in.",
      ];
    }

    return [
      "1) First write one short success-state coach reply, as plain markdown. Do NOT use fixed diagnostic Review headings when the run already passed.",
      "   - If the current algorithm is not close to optimal, use this shape: 当前算法还可以再优化 / the current algorithm can be optimized, name ONE algorithm, describe it in one brief phrase, ask whether the learner wants an explanation, then tell them to record Today self-rating and continue to the next Today item if provided.",
      "   - If the current algorithm is already near optimal, use this shape: 当前算法已经接近最优解 / the current algorithm is already near optimal, then tell them to record Today self-rating and continue to the next Today item if provided.",
    ];
  }

  return buildFailedReplyShapeInstruction();
}

function buildFailedReplyShapeInstruction(): string[] {
  return [
    "1) First write the coach reply as plain markdown. Do NOT use fixed section headings. Keep it concise: 2-4 short paragraphs or bullets, no padded walkthrough and no meta-narration about your own method.",
    "   - Root cause in ONE sentence: name the concrete variable, branch, or line that is most likely wrong; be mechanism-level and falsifiable.",
    "   - Brief why: explain the mechanism in one short sentence. Do not step through variable values across a case in Review.",
    "   - Minimal fix: preserve the learner's current approach and give the smallest change direction that should address all known evidence - not a rewrite into a canonical solution.",
    "   - End with ONE optional invitation to Chat walkthrough when a concrete failed/error case exists: ask whether the learner wants you to walk through that exact case. Do not perform the walkthrough in Review.",
    "   No full official solution, no official-success claim, no internal source tags (e.g. review_diagnosis) shown to the learner.",
  ];
}

function buildRunEvidenceRules(mode: ReviewMode, localOnly: boolean): string[] {
  if (mode === "static_remote_unavailable") {
    return [
      "- Remote LeetCode execution evidence is unavailable for this Review.",
      "- Treat the Run evidence JSON only as infrastructure provenance. It is not evidence that the learner code passed or failed.",
      "- Do not use Piston/local visible-test results as the Review conclusion in this mode. If local runs exist elsewhere in the UI, they remain separate local Run evidence, not official Review evidence.",
      "- Static code review may discuss code structure, invariants, complexity, and edge cases, but every correctness statement must be framed as static reasoning, not a judge verdict.",
      "- diagnosis.runStatus must stay equal to the provided run evidence status. diagnosis.mistakeTags must be [] unless a concrete code issue is visible from static reading alone. memoryUpdateCandidate.facts must be []. diagnosis.selfCheck must be null or omitted.",
    ];
  }

  const shared = [
    "- Treat the current Run evidence JSON as more authoritative than static hunches or generic assumptions.",
    "- If evidenceClass is local_only, use the actual local cases, passed/failed counts, actual/expected output, stdout, stderr, and first failed case when relevant, but scope every behavioral claim to the selected local visible tests.",
    "- Local visible evidence is evidence for only the current revision, current problem, and selected visible/custom cases represented in this prompt. It is not an official LeetCode verdict and says nothing about hidden tests.",
    "- If Run evidence JSON has errorDetail, use it as the normalized interpretation of stderr/raw judge text. Keep raw stderr secondary.",
    "- If failureProvenance is user_code, describe the failure as the learner's code behavior. Do not say Piston, LeetCode, the judge, or the sandbox crashed unless the status/provenance explicitly says runner_error, judge_service, sandbox_service, adapter, or network.",
  ];

  if (mode === "passed") {
    if (localOnly) {
      return [
        ...shared,
        "- The selected local visible tests passed. Do not invent a failed case, mismatch, or bug. Do not say the problem is solved, accepted, officially confirmed, or ready to move on.",
        "- diagnosis.mistakeTags must be [] and memoryUpdateCandidate.facts must not contain mistake facts. diagnosis.selfCheck must be null or omitted.",
      ];
    }

    return [
      ...shared,
      "- If runStatus is passed_visible_tests, the current attempt has no failed case. Do not say any case failed, do not mention a mismatch, and do not tell the user to fix a bug. Keep the success reply short; you may mention the pass count only if it helps, then tell the user to record the Today self-rating if relevant and recommend the next Today item if provided.",
      "- If runStatus is passed_visible_tests, diagnosis.mistakeTags must be [] and memoryUpdateCandidate.facts must not contain mistake facts.",
      "- If runStatus is passed_visible_tests, diagnosis.selfCheck must be null or omitted.",
      "- If runStatus is passed_visible_tests, diagnosis.coachSummary must be either exactly `near_optimal` or `can_optimize: <algorithm name> - <one brief description>`. Choose by inspecting the current code and problem constraints. Do not invent an optimization if you are unsure.",
    ];
  }

  return [
    ...shared,
    "- If runStatus is not passed_visible_tests, focus on the first current failed case or current error before mentioning historical weaknesses.",
  ];
}

function buildHeadingInstruction(mode: ReviewMode): string[] {
  if (mode === "static_remote_unavailable") {
    return [
      "Static remote-unavailable reply shape: exact required disclaimer first, then one compact static-review paragraph. No section headings.",
    ];
  }

  if (mode === "passed") {
    return [
      "Passed-run reply shape: no section headings; one compact paragraph or two short sentences.",
      "Passed-run English shape: no section headings; one compact paragraph or two short sentences.",
    ];
  }

  return [
    "Failed-run reply shape: no fixed headings; root cause first, one brief why sentence, minimal fix direction, then an optional invitation to walk through the concrete failed case in Chat. Do not include a variable trace or case walkthrough in Review.",
  ];
}

export function buildCoachReviewPrompt(input: CoachReviewInput) {
  const mode = reviewMode(input);
  const localOnly = input.evidenceVerdict?.evidenceClass === "local_only";
  const languageInstruction = buildReviewLanguageInstruction(input, mode);

  return [
    "You are CoachAgent for PatternCoach AI.",
    languageInstruction,
    "Output format - follow exactly:",
    ...buildReplyShapeInstruction(mode, localOnly),
    "2) Then, on its very own line, write this sentinel exactly:",
    DIAGNOSIS_SENTINEL,
    "3) Then write a single JSON diagnosis object. Write nothing after it.",
    "Never put the markdown reply inside JSON. The reply must come BEFORE the sentinel; the JSON object must come AFTER it.",
    "Diagnosis JSON shape:",
    '{"problemSlug":"...","runStatus":"...","userIssueSummary":"...","coachSummary":"...","mistakeTags":[],"skillTags":[],"selfCheck":{"question":"...","answer":"..."},"memoryUpdateCandidate":{"facts":[],"summary":"..."}}',
    "If LeetCode judge evidence includes total counts, compare_result, or a first failed last_testcase, you may cite that concrete evidence. Never claim you can see the full hidden-test list or guarantee official success.",
    "",
    "Critical run-evidence rules:",
    input.evidenceVerdict
      ? `- Evidence verdict: ${JSON.stringify(input.evidenceVerdict)}`
      : "- Evidence verdict: not provided; use only the current Run evidence JSON.",
    input.evidenceVerdict
      ? `- Evidence policy instruction: ${input.evidenceVerdict.modelInstruction}`
      : "- Evidence policy instruction: do not claim hidden-test success.",
    ...buildRunEvidenceRules(mode, localOnly),
    ...buildHeadingInstruction(mode),
    "",
    `Problem: ${input.problem.leetcodeNumber ?? ""}. ${input.problem.title} (${input.problem.slug})`,
    `Tags: ${input.problem.tags.join(", ")}`,
    `Language: ${input.language}`,
    `User state: ${input.userState ?? "not specified"}`,
    `User question: ${input.userQuestion ?? "not specified"}`,
    `Planner context: ${formatReviewPlannerContext(input.planner)}`,
    "",
    ...formatProblemStatement(input),
    "",
    ...formatReviewRunEvidence(input),
    "",
    "User code:",
    "```",
    input.code.slice(0, 6000),
    "```",
    ...formatReviewMemorySection(input.memory),
    "",
    "Diagnosis JSON requirements:",
    "- problemSlug: string",
    "- runStatus: one of the provided run evidence statuses",
    "- userIssueSummary: one short sentence",
    "- coachSummary: one short sentence",
    "- mistakeTags: array of stable snake_case tags",
    "- skillTags: array of stable snake_case tags",
    "- selfCheck: null for passed runs; otherwise { question, answer } that teach THIS problem's method/pattern - NOT the learner's specific bug.",
    "  - question: ask the key decision or standard pattern of this problem (e.g. why BFS vs DP, how to detect interval overlap). It must be answerable by someone who never saw the learner's code, and must NOT restate its own answer.",
    "  - answer: give the transferable method / decision rule PLUS a minimal correct code skeleton of a few lines.",
    "  - FORBIDDEN in both fields: the learner's specific submission, raw judge/runner output (e.g. 'expected ['/'actual ['/'Wrong Answer'), any system or pipeline text (e.g. 'structured JSON', 'evidence-only'), internal snake_case diagnostic tags, and generic filler such as '先锁定这题的关键决策，再用一个失败用例验证'.",
    "  - response language; question <= ~80 chars; answer prose <= ~160 chars plus a short code block; no full official solution.",
    "- memoryUpdateCandidate: { facts: [{ factType, tag, label, confidence (float 0.0–1.0), evidenceSummary }], summary }",
    "- Recommended factType values: mistake, strength, skill, preference. Use mistake for recurring bug patterns.",
    "  - Emit mistake only when this Review has aligned failed execution evidence whose Evidence verdict has canWriteMistakeMemory=true. This includes evidence-scoped local_only Review failures. A single Review remains only pending evidence; deterministic code decides later promotion.",
    "  - Local visible evidence may support Review Episode and L2 candidates, but label/evidenceSummary must say what the selected visible case demonstrated and must not imply official acceptance or hidden-test coverage.",
    "  - A mistake tag must encode both the problem topic and a portable learning mechanism. A bare topic, code shape, unfinished implementation, syntax surface, or internal pipeline label is not a durable mechanism.",
    "  - The tag topic must match the provided problem tags. Never label a DP/state-machine problem as binary search, or vice versa.",
    "  - label and evidenceSummary must be normal human teaching language; never copy the snake_case tag into either field.",
  ].join("\n");
}

function buildReviewLanguageInstruction(
  input: CoachReviewInput,
  mode: ReviewMode,
) {
  if (mode === "static_remote_unavailable") {
    return input.responseLanguage === "en"
      ? "Respond in Chinese for the required remote-unavailable disclaimer, then continue in the user's current language if clearly different. No fixed headings."
      : "Respond in Chinese. No fixed headings; follow the static remote-unavailable reply shape.";
  }

  if (input.responseLanguage === "en") {
    return mode === "passed"
      ? "Respond in English with a concise success-state reply."
      : "Respond in English. No fixed section headings; follow the reply beats.";
  }

  return mode === "passed"
    ? "Respond in Chinese with a concise success-state reply."
    : "Respond in Chinese. No fixed section headings; follow the reply beats.";
}

function formatProblemStatement(input: CoachReviewInput) {
  const statement = input.problem.statementMarkdown?.trim();

  if (!statement) {
    return [
      "Problem statement:",
      "Not available in the local cache. Do not rely on memory for details that are missing from the title, tags, method name, or user code.",
    ];
  }

  return [
    "Problem statement (authoritative; use this over memory or assumptions):",
    statement.slice(0, 8000),
    statement.length > 8000
      ? "[Problem statement truncated for prompt budget.]"
      : "",
  ].filter(Boolean);
}

function formatReviewRunEvidence(input: CoachReviewInput) {
  return ["Run evidence JSON:", JSON.stringify(input.runResult, null, 2)];
}

function formatReviewPlannerContext(
  planner: CoachReviewInput["planner"] | undefined,
) {
  if (!planner?.nextTodayItem) {
    return planner?.currentPlanItemId
      ? JSON.stringify({ currentPlanItemId: planner.currentPlanItemId })
      : "none";
  }

  return JSON.stringify({
    currentPlanItemId: planner.currentPlanItemId,
    nextTodayItem: planner.nextTodayItem,
    instruction:
      "When the current run passes, recommend this nextTodayItem after the learner records their Today self-rating.",
  });
}
