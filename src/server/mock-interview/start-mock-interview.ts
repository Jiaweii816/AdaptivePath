import prisma from "@/server/db/prisma";
import { appendL1TraceEvents } from "@/server/memory/l1-trace/append-trace";
import { getInterviewerProvider } from "@/server/agents/interviewer-agent/interviewer-provider";
import { getLocalUserAndProfile, inferResponseLanguage } from "@/server/agents/coach-agent/review-pipeline";
import { createTraceContext } from "@/server/llm/trace-context";
import {
  MOCK_INTERVIEW_DURATION_MINUTES,
  MOCK_INTERVIEW_MAX_QUESTIONS,
} from "./interview-phase-policy";
import { buildInterviewDossier } from "./build-interview-dossier";
import {
  selectMockInterviewProblem,
  toProblemContext,
  toProblemDto,
  toSessionDto,
  toTurnDto,
  parseJson,
} from "./mock-interview-utils";
import {
  mockInterviewStartRequestSchema,
  type MockInterviewStartResponse,
} from "@/types/mock-interview";

const json = (value: unknown) => JSON.stringify(value);

export async function startMockInterview(
  rawInput: unknown,
): Promise<MockInterviewStartResponse> {
  const pathStartedAt = Date.now();
  const input = mockInterviewStartRequestSchema.parse(rawInput);
  const { user, profile } = await getLocalUserAndProfile();
  const problem = await selectMockInterviewProblem(prisma, input);
  const problemTags = parseJson<string[]>(problem.tags, []);
  const responseLanguage = inferResponseLanguage({
    explicit: input.responseLanguage,
    userQuestion: input.targetLabel,
    explanationStyle: profile.explanationStyle,
    outputPreferences: profile.outputPreferences,
  });
  const dossier = await buildInterviewDossier(prisma, {
    userId: user.id,
    targetLabel: input.targetLabel,
    focusTags: input.focusTags.length > 0 ? input.focusTags : problemTags,
    responseLanguage,
  });
  const provider = getInterviewerProvider();
  const traceContext = createTraceContext({
    prisma,
    userId: user.id,
    path: "mock_interview",
    task: "mock_interview.start",
    problemId: problem.id,
  });
  const first = await provider.start({
    sessionId: "pending",
    problem: toProblemContext(problem),
    dossier,
    durationMinutes: MOCK_INTERVIEW_DURATION_MINUTES,
    maxQuestions: MOCK_INTERVIEW_MAX_QUESTIONS,
    language: input.language,
    latestCode: problem.starterCodePython ?? undefined,
    responseLanguage,
    traceContext,
  });

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.mockInterviewSession.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        targetLabel: dossier.targetLabel,
        focusTagsJson: json(dossier.focusTags),
        currentPhase: "intro",
        language: input.language,
        questionCount: 0,
        maxQuestions: MOCK_INTERVIEW_MAX_QUESTIONS,
        durationMinutes: MOCK_INTERVIEW_DURATION_MINUTES,
        planItemId: input.planItemId,
      },
    });

    const firstTurn = await tx.mockInterviewTurn.create({
      data: {
        sessionId: session.id,
        role: "interviewer",
        phase: "intro",
        sequence: 1,
        contentMarkdown: first.messageMarkdown,
        metadataJson: json({
          type: "opening",
          proposedPhase: first.proposedPhase,
          questionAsked: false,
          countedQuestion: false,
          responseLanguage,
        }),
      },
    });

    await appendL1TraceEvents(tx, [
      {
        userId: user.id,
        problemId: problem.id,
        eventType: "mock_interview_started",
        source: "mock_interview:start",
        content: `Started mock interview for ${problem.title}`,
        eventJson: {
          traceRunId: traceContext.traceRunId,
          sessionId: session.id,
          problemSlug: problem.slug,
          targetLabel: dossier.targetLabel,
          focusTags: dossier.focusTags,
          durationMinutes: MOCK_INTERVIEW_DURATION_MINUTES,
          maxQuestions: MOCK_INTERVIEW_MAX_QUESTIONS,
        },
      },
      {
        userId: user.id,
        problemId: problem.id,
        eventType: "mock_interview_turn",
        source: "mock_interview:start",
        content: first.messageMarkdown,
        eventJson: {
          traceRunId: traceContext.traceRunId,
          sessionId: session.id,
          turnId: firstTurn.id,
          role: "interviewer",
          phase: "intro",
          openingNotCounted: true,
          timings: {
            totalMs: Date.now() - pathStartedAt,
            llmMsTotal: traceContext.llmMsTotal,
          },
        },
      },
    ]);

    return { session, firstTurn };
  });

  return {
    ok: true,
    session: toSessionDto(result.session),
    problem: toProblemDto(problem),
    firstTurn: toTurnDto(result.firstTurn),
  };
}
