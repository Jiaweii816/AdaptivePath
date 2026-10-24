import prisma from "@/server/db/prisma";
import { enqueueInterviewFeedback } from "@/server/jobs/enqueue-interview-feedback";
import { getInterviewerProvider } from "@/server/agents/interviewer-agent/interviewer-provider";
import { getLocalUserAndProfile, inferResponseLanguage } from "@/server/agents/coach-agent/review-pipeline";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { createTraceContext } from "@/server/llm/trace-context";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import {
  arbitrateFactCandidates,
  mapMemoryUpdateCandidateToFactCandidates,
} from "@/server/memory/store/fact-store";
import {
  DEFAULT_INTERVIEW_SCORES,
  type InterviewerReportResult,
} from "@/server/agents/interviewer-agent/interviewer-agent.types";
import { buildInterviewDossier } from "./build-interview-dossier";
import { filterMockInterviewMemoryUpdateCandidate } from "./mock-interview-memory";
import {
  MockInterviewError,
  normalizePhase,
  normalizeTurnRole,
  parseJson,
  runResultFromEvidence,
  runVerdictFromEvidence,
  toProblemContext,
  toSessionDto,
} from "./mock-interview-utils";
import {
  mockInterviewCompleteRequestSchema,
  type MockInterviewCompleteResponse,
  type MockInterviewReport,
} from "@/types/mock-interview";

const json = (value: unknown) => JSON.stringify(value);

export async function completeMockInterview(
  rawInput: unknown,
): Promise<MockInterviewCompleteResponse> {
  const pathStartedAt = Date.now();
  const input = mockInterviewCompleteRequestSchema.parse(rawInput);
  const { user, profile } = await getLocalUserAndProfile();
  const session = await prisma.mockInterviewSession.findFirst({
    where: { id: input.sessionId, userId: user.id },
    include: { problem: true, feedback: true },
  });

  if (!session) {
    throw new MockInterviewError("Mock interview session was not found.", 404);
  }

  if (session.feedback) {
    return {
      ok: true,
      session: toSessionDto(session),
      feedbackId: session.feedback.id,
      reportMarkdown: session.feedback.reportMarkdown,
      report: reportFromFeedback(session.feedback),
    };
  }

  const responseLanguage = inferResponseLanguage({
    explicit: input.responseLanguage,
    explanationStyle: profile.explanationStyle,
    outputPreferences: profile.outputPreferences,
  });
  const [turns, latestSnapshot, latestEvidence] = await Promise.all([
    prisma.mockInterviewTurn.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "asc" },
    }),
    prisma.mockInterviewCodeSnapshot.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mockInterviewRunEvidence.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const dossier = await buildInterviewDossier(prisma, {
    userId: user.id,
    targetLabel: session.targetLabel ?? undefined,
    focusTags: parseJson<string[]>(session.focusTagsJson, []),
    responseLanguage,
  });
  const transcript = turns.map((turn) => ({
    role: normalizeTurnRole(turn.role),
    phase: normalizePhase(turn.phase),
    contentMarkdown: turn.contentMarkdown,
  }));
  const latestRunVerdict = runVerdictFromEvidence(latestEvidence);
  let providerResult: InterviewerReportResult;
  let fallbackReport = false;
  const traceContext = createTraceContext({
    prisma,
    userId: user.id,
    path: "mock_interview",
    task: "mock_interview.complete",
    problemId: session.problemId,
  });
  const latestRunTrace = latestEvidence
    ? await prisma.l1MemoryEvent.findFirst({
        where: {
          userId: user.id,
          problemId: session.problemId,
          eventType: "mock_interview_run_evidence",
          source: "mock_interview:run_code",
          memoryOrigin: traceContext.memoryOrigin,
          eventJson: { contains: `\"runEvidenceId\":\"${latestEvidence.id}\"` },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      })
    : null;

  try {
    providerResult = await getInterviewerProvider().complete({
      sessionId: session.id,
      problem: toProblemContext(session.problem),
      dossier,
      transcript,
      language: session.language === "C++" ? "C++" : "Python",
      latestCode: latestSnapshot?.code,
      latestRunResult: runResultFromEvidence(latestEvidence),
      latestRunVerdict,
      responseLanguage,
      traceContext,
    });
  } catch (error) {
    console.error("Interviewer report provider failed; using fallback.", error);
    fallbackReport = true;
    providerResult = buildFallbackReport({
      problemTitle: session.problem.title,
      latestRunResult: runResultFromEvidence(latestEvidence),
      latestRunVerdict,
    });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const feedback = await tx.mockInterviewFeedback.create({
      data: {
        sessionId: session.id,
        verdict: providerResult.report.verdict,
        overallSignal: providerResult.report.overallSignal,
        scoreJson: json(providerResult.report.scores),
        strengthsJson: json(providerResult.report.strengths),
        concernsJson: json(providerResult.report.concerns),
        missedFollowUpsJson: json(providerResult.report.missedFollowUps),
        codeNotesJson: json(providerResult.report.codeNotes),
        recommendationsJson: json(providerResult.report.recommendations),
        memoryUpdateCandidateJson: json(
          providerResult.report.memoryUpdateCandidate,
        ),
        reportMarkdown: providerResult.reportMarkdown,
      },
    });
    const updatedSession = await tx.mockInterviewSession.update({
      where: { id: session.id },
      data: {
        status: "completed",
        currentPhase: "wrap_up",
        completedAt: new Date(),
      },
    });
    const feedbackTrace = await appendL1TraceEvent(tx, {
      userId: user.id,
      problemId: session.problemId,
      eventType: "mock_interview_feedback",
      memoryOrigin: traceContext.memoryOrigin,
      traceRunId: traceContext.traceRunId,
      source: "mock_interview:complete",
      content: providerResult.report.verdict,
      eventJson: {
        traceRunId: traceContext.traceRunId,
        sessionId: session.id,
        feedbackId: feedback.id,
        overallSignal: providerResult.report.overallSignal,
        report: providerResult.report,
        fallbackReport,
        timings: {
          totalMs: Date.now() - pathStartedAt,
          llmMsTotal: traceContext.llmMsTotal,
        },
      },
    });
    const updatedFacts = (
      await arbitrateFactCandidates(tx, {
        userId: user.id,
        problemId: session.problemId,
        source: "mock_interview_feedback",
        candidates: mapMemoryUpdateCandidateToFactCandidates({
          candidate: filterMockInterviewMemoryUpdateCandidate({
            candidate: filterCandidateByEvidenceVerdict({
              candidate: providerResult.report.memoryUpdateCandidate,
              canWriteMistakeMemory:
                latestRunVerdict?.capabilities.canWriteMistakeMemory ?? true,
            }),
            problemSlug: session.problem.slug,
            problemTags: parseJson<string[]>(session.problem.tags, []),
          }),
          evidenceTraceIds: [
            ...(latestRunTrace ? [latestRunTrace.id] : []),
            feedbackTrace.id,
          ],
        }),
      })
    ).updated;
    const episode = await createMemoryEpisode(tx, {
      userId: user.id,
      problemId: session.problemId,
      kind: "mock_interview",
      title: `Mock interview: ${session.problem.title}`,
      summary: providerResult.report.verdict,
      outcome: episodeOutcomeFor(providerResult.report.overallSignal),
      tags: [
        ...parseJson<string[]>(session.problem.tags, []),
        ...providerResult.report.concerns.slice(0, 3),
      ],
      salience:
        providerResult.report.overallSignal === "risky" ? 0.9 : 0.75,
      sourceTraceIds: [feedbackTrace.id],
      memoryOrigin: traceContext.memoryOrigin,
    });

    return { feedback, updatedSession, updatedFacts, episode };
  });

  await Promise.resolve(
    enqueueInterviewFeedback(prisma, {
      userId: user.id,
      problemId: session.problemId,
      mockInterviewSessionId: session.id,
      feedbackId: outcome.feedback.id,
      fallbackReport,
      episodeId: outcome.episode.id,
      changedFactIds: outcome.updatedFacts.map((fact) => fact.id),
      originatingTraceRunId: traceContext.traceRunId,
    }),
  ).catch((error) => {
    console.error("Unable to durably enqueue Mock Interview feedback work.", {
      error,
      traceRunId: traceContext.traceRunId,
      sessionId: session.id,
      feedbackId: outcome.feedback.id,
    });
  });

  return {
    ok: true,
    session: toSessionDto(outcome.updatedSession),
    feedbackId: outcome.feedback.id,
    reportMarkdown: providerResult.reportMarkdown,
    report: providerResult.report,
  };
}

function reportFromFeedback(feedback: {
  verdict: string;
  overallSignal: string;
  scoreJson: string;
  strengthsJson: string;
  concernsJson: string;
  missedFollowUpsJson: string;
  codeNotesJson: string;
  recommendationsJson: string;
  memoryUpdateCandidateJson: string;
}): MockInterviewReport {
  return {
    verdict: feedback.verdict,
    overallSignal:
      feedback.overallSignal === "strong" ||
      feedback.overallSignal === "acceptable" ||
      feedback.overallSignal === "risky"
        ? feedback.overallSignal
        : "needs_work",
    scores: parseJson(feedback.scoreJson, DEFAULT_INTERVIEW_SCORES),
    strengths: parseJson(feedback.strengthsJson, []),
    concerns: parseJson(feedback.concernsJson, []),
    missedFollowUps: parseJson(feedback.missedFollowUpsJson, []),
    codeNotes: parseJson(feedback.codeNotesJson, []),
    recommendations: parseJson(feedback.recommendationsJson, []),
    memoryUpdateCandidate: parseJson(feedback.memoryUpdateCandidateJson, {
      facts: [],
    }),
  };
}

function episodeOutcomeFor(signal: MockInterviewReport["overallSignal"]) {
  if (signal === "strong") {
    return "passed" as const;
  }

  if (signal === "acceptable") {
    return "resolved" as const;
  }

  return "unresolved" as const;
}

function buildFallbackReport(args: {
  problemTitle: string;
  latestRunResult?: ReturnType<typeof runResultFromEvidence>;
  latestRunVerdict?: ReturnType<typeof runVerdictFromEvidence>;
}): InterviewerReportResult {
  const canVerdict =
    args.latestRunVerdict?.capabilities.canVerdict ??
    Boolean(args.latestRunResult);
  const passed =
    canVerdict && args.latestRunResult?.status === "passed_visible_tests";
  const report: MockInterviewReport = {
    verdict: passed
      ? `Completed mock interview for ${args.problemTitle}; latest evidence passed visible tests, but the model report was unavailable.`
      : `Completed mock interview for ${args.problemTitle}; final report model was unavailable, so use transcript and run evidence for review.`,
    overallSignal: passed ? "acceptable" : "needs_work",
    scores: DEFAULT_INTERVIEW_SCORES,
    strengths: [],
    concerns: ["Interviewer report model was unavailable."],
    missedFollowUps: [],
    codeNotes: args.latestRunResult
      ? [
          canVerdict
            ? `Latest run status: ${args.latestRunResult.status}.`
            : `Latest run was not verdict-bearing: ${args.latestRunVerdict?.evidenceClass ?? "unknown"}.`,
        ]
      : ["No run evidence was captured."],
    recommendations: [],
    memoryUpdateCandidate: { facts: [] },
  };

  return {
    report,
    reportMarkdown: [
      "## Verdict",
      report.verdict,
      "## Strong Signals",
      "- None recorded.",
      "## Concerns",
      "- Interviewer report model was unavailable.",
      "## Follow-up Questions You Missed",
      "- Review the transcript manually.",
      "## Code And Debugging Notes",
      report.codeNotes.map((note) => `- ${note}`).join("\n"),
      "## Recommended Drills",
      "- Repeat this problem in Workbench Review mode.",
    ].join("\n\n"),
  };
}

function filterCandidateByEvidenceVerdict(args: {
  candidate: MockInterviewReport["memoryUpdateCandidate"];
  canWriteMistakeMemory: boolean;
}) {
  if (args.canWriteMistakeMemory) {
    return args.candidate;
  }

  return {
    summary: args.candidate.summary,
    facts: args.candidate.facts.filter(
      (fact) =>
        fact.factType !== "mistake" &&
        fact.factType !== "weakness" &&
        fact.factType !== "unresolved_confusion",
    ),
  };
}
