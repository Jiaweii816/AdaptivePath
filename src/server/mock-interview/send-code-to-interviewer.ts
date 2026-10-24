import prisma from "@/server/db/prisma";
import { appendL1TraceEvents } from "@/server/memory/l1-trace/append-trace";
import { getInterviewerProvider } from "@/server/agents/interviewer-agent/interviewer-provider";
import { getLocalUserAndProfile, inferResponseLanguage } from "@/server/agents/coach-agent/review-pipeline";
import { createTraceContext } from "@/server/llm/trace-context";
import { buildInterviewDossier } from "./build-interview-dossier";
import {
  applyPhaseGuard,
  elapsedInterviewMinutes,
  legalNextPhases,
  shouldForceWrapUp,
} from "./interview-phase-policy";
import {
  MockInterviewError,
  normalizePhase,
  normalizeTurnRole,
  parseJson,
  runResultFromEvidence,
  runVerdictFromEvidence,
  toProblemContext,
  toSessionDto,
  toTurnDto,
} from "./mock-interview-utils";
import {
  mockInterviewSendCodeRequestSchema,
  type MockInterviewTurnResponse,
} from "@/types/mock-interview";

const json = (value: unknown) => JSON.stringify(value);

export async function sendCodeToInterviewer(
  rawInput: unknown,
): Promise<MockInterviewTurnResponse> {
  const pathStartedAt = Date.now();
  const input = mockInterviewSendCodeRequestSchema.parse(rawInput);
  const { user, profile } = await getLocalUserAndProfile();
  const session = await prisma.mockInterviewSession.findFirst({
    where: { id: input.sessionId, userId: user.id },
    include: { problem: true },
  });

  if (!session) {
    throw new MockInterviewError("Mock interview session was not found.", 404);
  }

  if (session.status === "completed") {
    throw new MockInterviewError("This mock interview is already completed.", 409);
  }

  const responseLanguage = inferResponseLanguage({
    explicit: undefined,
    userQuestion: input.message,
    explanationStyle: profile.explanationStyle,
    outputPreferences: profile.outputPreferences,
  });
  const currentPhase = normalizePhase(session.currentPhase);
  const forceWrapUp = shouldForceWrapUp({
    startedAt: session.startedAt,
    durationMinutes: session.durationMinutes,
    questionCount: session.questionCount,
    maxQuestions: session.maxQuestions,
  });
  const [recentTurns, latestSnapshot, latestSequence] = await Promise.all([
    prisma.mockInterviewTurn.findMany({
      where: { sessionId: session.id },
      orderBy: { sequence: "desc" },
      take: 12,
    }),
    prisma.mockInterviewCodeSnapshot.findFirst({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mockInterviewTurn.aggregate({
      where: { sessionId: session.id },
      _max: { sequence: true },
    }),
  ]);
  const reusableSnapshot =
    latestSnapshot?.language === input.language && latestSnapshot.code === input.code
      ? latestSnapshot
      : null;
  const matchingEvidence = reusableSnapshot
    ? await prisma.mockInterviewRunEvidence.findFirst({
        where: {
          sessionId: session.id,
          codeSnapshotId: reusableSnapshot.id,
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const candidateContent =
    input.message?.trim() ||
    `I am sending my current ${input.language} code snapshot to the interviewer.`;
  const candidateSequence = (latestSequence._max.sequence ?? 0) + 1;
  const interviewerSequence = candidateSequence + 1;
  const dossier = await buildInterviewDossier(prisma, {
    userId: user.id,
    targetLabel: session.targetLabel ?? undefined,
    focusTags: parseJson<string[]>(session.focusTagsJson, []),
    responseLanguage,
  });
  const codePhase = currentPhase === "intro" ? "coding" : currentPhase;
  const transcript = [
    ...recentTurns.reverse().map((turn) => ({
      role: normalizeTurnRole(turn.role),
      phase: normalizePhase(turn.phase),
      contentMarkdown: turn.contentMarkdown,
    })),
    {
      role: "candidate" as const,
      phase: codePhase,
      contentMarkdown: candidateContent,
    },
  ];
  const traceContext = createTraceContext({
    prisma,
    userId: user.id,
    path: "mock_interview",
    task: "mock_interview.send_code",
    problemId: session.problemId,
  });
  const providerResult = await getInterviewerProvider().discussCode({
    sessionId: session.id,
    problem: toProblemContext(session.problem),
    dossier,
    transcript,
    currentPhase: codePhase,
    legalPhases: forceWrapUp ? ["wrap_up"] : legalNextPhases(codePhase),
    questionCount: session.questionCount,
    maxQuestions: session.maxQuestions,
    durationMinutes: session.durationMinutes,
    elapsedMinutes: elapsedInterviewMinutes(session.startedAt),
    language: input.language,
    latestCode: input.code,
    latestRunResult: runResultFromEvidence(matchingEvidence),
    latestRunVerdict: runVerdictFromEvidence(matchingEvidence),
    responseLanguage,
    traceContext,
  });
  const guardedPhase = applyPhaseGuard({
    currentPhase: codePhase,
    proposedPhase: providerResult.proposedPhase,
    forceWrapUp,
  });
  const countedQuestion =
    guardedPhase !== "wrap_up" && providerResult.questionAsked;
  const nextQuestionCount = countedQuestion
    ? Math.min(session.questionCount + 1, session.maxQuestions)
    : session.questionCount;

  const result = await prisma.$transaction(async (tx) => {
    const codeSnapshot =
      reusableSnapshot ??
      (await tx.mockInterviewCodeSnapshot.create({
        data: {
          sessionId: session.id,
          problemId: session.problemId,
          language: input.language,
          code: input.code,
        },
      }));
    const candidateTurn = await tx.mockInterviewTurn.create({
      data: {
        sessionId: session.id,
        role: "candidate",
        phase: codePhase,
        sequence: candidateSequence,
        contentMarkdown: candidateContent,
        metadataJson: json({
          type: "code_snapshot",
          codeSnapshotId: codeSnapshot.id,
          responseLanguage,
        }),
      },
    });
    const interviewerTurn = await tx.mockInterviewTurn.create({
      data: {
        sessionId: session.id,
        role: "interviewer",
        phase: guardedPhase,
        sequence: interviewerSequence,
        contentMarkdown: providerResult.messageMarkdown,
        metadataJson: json({
          type: "code_discussion",
          codeSnapshotId: codeSnapshot.id,
          proposedPhase: providerResult.proposedPhase,
          questionAsked: providerResult.questionAsked,
          countedQuestion,
          responseLanguage,
        }),
      },
    });
    const updatedSession = await tx.mockInterviewSession.update({
      where: { id: session.id },
      data: {
        currentPhase: guardedPhase,
        questionCount: nextQuestionCount,
      },
    });

    await appendL1TraceEvents(tx, [
      {
        userId: user.id,
        problemId: session.problemId,
        eventType: "mock_interview_code_discussion",
        source: "mock_interview:send_code",
        content: candidateContent,
        eventJson: {
          traceRunId: traceContext.traceRunId,
          sessionId: session.id,
          turnId: candidateTurn.id,
          codeSnapshotId: codeSnapshot.id,
          runEvidenceId: matchingEvidence?.id,
        },
      },
      {
        userId: user.id,
        problemId: session.problemId,
        eventType: "mock_interview_turn",
        source: "mock_interview:send_code",
        content: providerResult.messageMarkdown,
        eventJson: {
          traceRunId: traceContext.traceRunId,
          sessionId: session.id,
          turnId: interviewerTurn.id,
          phase: guardedPhase,
          countedQuestion,
          questionCount: nextQuestionCount,
          timings: {
            totalMs: Date.now() - pathStartedAt,
            llmMsTotal: traceContext.llmMsTotal,
          },
        },
      },
    ]);

    return { candidateTurn, interviewerTurn, updatedSession };
  });

  return {
    ok: true,
    session: toSessionDto(result.updatedSession),
    candidateTurn: toTurnDto(result.candidateTurn),
    interviewerTurn: toTurnDto(result.interviewerTurn),
  };
}
