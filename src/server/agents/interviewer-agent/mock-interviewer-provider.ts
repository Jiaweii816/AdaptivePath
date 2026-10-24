import type { MockInterviewReport } from "@/types/mock-interview";
import {
  DEFAULT_INTERVIEW_SCORES,
  type InterviewerProvider,
  type InterviewerTurnInput,
} from "./interviewer-agent.types";

export function createMockInterviewerProvider(): InterviewerProvider {
  return {
    async start(input) {
      return {
        messageMarkdown:
          input.responseLanguage === "zh"
            ? `我们做一场 ${input.durationMinutes} 分钟的文字 coding mock interview。我会少提示、多追问。先用一句话说明你看到 ${input.problem.title} 时的第一反应和打算验证的边界。`
            : `We will run a ${input.durationMinutes}-minute text coding mock interview. I will probe more than I teach. Start with one sentence: what is your first approach for ${input.problem.title}, and which boundary would you test first?`,
        proposedPhase: "intro",
        questionAsked: false,
      };
    },

    async continue(input) {
      return buildTurn(input, false);
    },

    async discussCode(input) {
      return buildTurn(input, true);
    },

    async complete(input) {
      const canVerdict = input.latestRunVerdict?.capabilities.canVerdict ?? Boolean(input.latestRunResult);
      const passed =
        canVerdict && input.latestRunResult?.status === "passed_visible_tests";
      const report: MockInterviewReport = {
        verdict: passed
          ? "Acceptable signal with room to tighten explanation and edge-case ownership."
          : "Mixed signal: the transcript shows useful reasoning, but correctness/debugging evidence is not yet strong.",
        overallSignal: passed ? "acceptable" : "needs_work",
        scores: {
          ...DEFAULT_INTERVIEW_SCORES,
          correctness: passed ? 0.7 : 0.35,
          debuggingWithEvidence: canVerdict ? 0.65 : 0.35,
        },
        strengths: [
          "Stayed engaged with the problem instead of jumping straight to a memorized solution.",
        ],
        concerns: passed
          ? ["Needs a crisper complexity explanation under interview pressure."]
          : ["Needs to reason from the first failed case before editing code."],
        missedFollowUps: [
          "State the edge case you would test before changing the implementation.",
        ],
        codeNotes: [
          canVerdict && input.latestRunResult
            ? `Latest run status: ${input.latestRunResult.status}.`
            : input.latestRunVerdict
              ? `Latest run was not verdict-bearing: ${input.latestRunVerdict.evidenceClass}.`
              : "No run evidence was captured during the interview.",
        ],
        recommendations: [
          {
            tag: input.problem.tags[0] ?? "debugging",
            reason: "Repeat the same pattern with explicit boundary narration.",
            problemSlug: input.problem.slug,
          },
        ],
        memoryUpdateCandidate: {
          facts: !canVerdict
            ? []
            : passed
            ? [
                {
                  factType: "skill",
                  tag: input.problem.tags[0] ?? input.problem.slug,
                  label: input.problem.tags[0] ?? input.problem.title,
                  confidence: 0.65,
                  evidenceSummary:
                    "Mock interview showed acceptable reasoning on this pattern.",
                },
              ]
            : [
                {
                  factType: "mistake",
                  tag: "debugging_without_evidence",
                  label: "Debugging without evidence",
                  confidence: 0.68,
                  evidenceSummary:
                    "Mock interview showed the candidate needed more first-failed-case reasoning.",
                },
              ],
          summary: "Mock interview feedback generated deterministic memory candidates.",
        },
      };

      return {
        report,
        reportMarkdown: buildReportMarkdown(report),
      };
    },
  };
}

function buildTurn(input: InterviewerTurnInput, codeFocused: boolean) {
  const nextPhase = chooseNextPhase(input, codeFocused);
  const canVerdict = input.latestRunVerdict?.capabilities.canVerdict ?? Boolean(input.latestRunResult);
  const runStatus = canVerdict ? input.latestRunResult?.status : undefined;
  const zh = input.responseLanguage === "zh";

  if (nextPhase === "wrap_up") {
    return {
      messageMarkdown: zh
        ? "时间和提问预算都差不多了。我们停在这里，进入 debrief。"
        : "We are at the edge of the time and question budget. Let's stop here and move to the debrief.",
      proposedPhase: "wrap_up" as const,
      questionAsked: false,
    };
  }

  const messageMarkdown = zh
    ? buildChineseQuestion(input, codeFocused, runStatus)
    : buildEnglishQuestion(input, codeFocused, runStatus);

  return {
    messageMarkdown,
    proposedPhase: nextPhase,
    questionAsked: true,
  };
}

function chooseNextPhase(input: InterviewerTurnInput, codeFocused: boolean) {
  if (input.legalPhases.includes("wrap_up") && input.questionCount >= input.maxQuestions) {
    return "wrap_up" as const;
  }

  if (codeFocused && input.legalPhases.includes("code_discussion")) {
    return "code_discussion" as const;
  }

  if (input.currentPhase === "intro" && input.legalPhases.includes("technical_screen")) {
    return "technical_screen" as const;
  }

  if (input.currentPhase === "technical_screen" && input.legalPhases.includes("coding")) {
    return "coding" as const;
  }

  return "stay" as const;
}

function buildChineseQuestion(
  input: InterviewerTurnInput,
  codeFocused: boolean,
  runStatus?: string,
) {
  if (codeFocused) {
    return runStatus && runStatus !== "passed_visible_tests"
      ? `我看到最新运行状态是 \`${runStatus}\`。先不要急着改代码：第一个失败用例为什么会得到这个实际输出？请指到你认为最可疑的一行。`
      : "代码先看起来有一个可讨论点：你怎么证明这个写法不会漏掉最小边界输入？请用一个具体例子走一遍。";
  }

  if (input.currentPhase === "intro") {
    return "好，现在别写代码。先说你的核心不变量是什么？用一句话说明每一步循环后你希望保持什么为真。";
  }

  if (input.currentPhase === "technical_screen") {
    return "如果输入规模变大，你这个思路的时间复杂度和空间复杂度分别是什么？别只给结论，说明是哪一层循环或数据结构导致的。";
  }

  return "继续。现在挑一个你最担心的边界 case，手动走一遍返回值。";
}

function buildEnglishQuestion(
  input: InterviewerTurnInput,
  codeFocused: boolean,
  runStatus?: string,
) {
  if (codeFocused) {
    return runStatus && runStatus !== "passed_visible_tests"
      ? `The latest run status is \`${runStatus}\`. Do not edit yet: why does the first failed case produce that actual output, and which line is most suspicious?`
      : "There is still one thing I want to verify in the code: how do you know this does not miss the smallest boundary input? Walk one concrete case.";
  }

  if (input.currentPhase === "intro") {
    return "Good. Before writing code, state the invariant in one sentence. What should remain true after each loop step?";
  }

  if (input.currentPhase === "technical_screen") {
    return "If the input grows, what are the time and space complexities? Do not just give the labels; tie them to the loop or data structure.";
  }

  return "Continue. Pick the boundary case you are most worried about and walk through the return value by hand.";
}

function buildReportMarkdown(report: MockInterviewReport) {
  return [
    "## Verdict",
    report.verdict,
    "## Strong Signals",
    list(report.strengths),
    "## Concerns",
    list(report.concerns),
    "## Follow-up Questions You Missed",
    list(report.missedFollowUps),
    "## Code And Debugging Notes",
    list(report.codeNotes),
    "## Recommended Drills",
    list(report.recommendations.map((item) => `${item.tag}: ${item.reason}`)),
  ].join("\n\n");
}

function list(values: string[]) {
  return values.map((value) => `- ${value}`).join("\n");
}
