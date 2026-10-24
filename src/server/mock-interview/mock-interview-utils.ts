import type { Prisma, PrismaClient } from "@prisma/client";
import { getHot150Problem, hot150Problems } from "@/data/hot150";
import { getOrFetchProblem } from "@/server/problems/hot150-problem-cache";
import { resolveCodeRunnerProviderKind } from "@/server/tools/code-runner/run-code-with-tests";
import { hasLeetCodeSession } from "@/server/tools/leetcode-api/lc-api-client";
import {
  classifyExecutionEvidence,
  readEvidenceVerdict,
} from "@/lib/evidence-trust";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import {
  mockInterviewPhaseSchema,
  mockInterviewTurnRoleSchema,
  type MockInterviewPhase,
  type MockInterviewProblemDto,
  type MockInterviewSessionDto,
  type MockInterviewTurnDto,
  type MockInterviewTurnRole,
} from "@/types/mock-interview";
import { codeRunResultSchema, type CodeRunResult } from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import type { InterviewProblemContext } from "@/server/agents/interviewer-agent/interviewer-agent.types";

type ProblemRecord = Prisma.ProblemGetPayload<{
  include: { testCases: true };
}>;
const localDemoFallbackSlugs = new Set([
  "longest-substring-without-repeating-characters",
  "two-sum",
  "search-insert-position",
]);

export class MockInterviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "MockInterviewError";
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function selectMockInterviewProblem(
  prisma: PrismaClient,
  input: { problemId?: string; problemSlug?: string; planItemId?: string },
) {
  const providerKind = resolveCodeRunnerProviderKind();
  const canUseRemoteProblems = providerKind === "lc" && hasLeetCodeSession();
  let problem: ProblemRecord | null = null;

  if (input.problemId || input.problemSlug) {
    if (input.problemSlug && canUseRemoteProblems) {
      await getOrFetchProblem(input.problemSlug, prisma);
    }

    problem = await prisma.problem.findFirst({
      where: {
        OR: [
          input.problemId ? { id: input.problemId } : undefined,
          input.problemSlug ? { slug: input.problemSlug } : undefined,
        ].filter(Boolean) as Array<{ id: string } | { slug: string }>,
      },
      include: { testCases: { where: { isVisible: true } } },
    });
  }

  if (!problem && input.planItemId) {
    const item = await prisma.plannerPlanItem.findUnique({
      where: { id: input.planItemId },
      include: {
        problem: {
          include: { testCases: { where: { isVisible: true } } },
        },
      },
    });

    problem = item?.problem ?? null;

    if (problem && !problem.statementMarkdown.trim() && canUseRemoteProblems) {
      const fetched = await getOrFetchProblem(problem.slug, prisma);
      problem = await prisma.problem.findUnique({
        where: { id: fetched.id },
        include: { testCases: { where: { isVisible: true } } },
      });
    }
  }

  if (!problem) {
    const defaultHot150Slugs = canUseRemoteProblems
      ? hot150Problems.map((catalogProblem) => catalogProblem.slug)
      : hot150Problems
          .filter((catalogProblem) =>
            localDemoFallbackSlugs.has(catalogProblem.slug),
          )
          .map((catalogProblem) => catalogProblem.slug);

    const candidates = await prisma.problem.findMany({
      where: canUseRemoteProblems
        ? undefined
        : {
            OR: [{ isDemoSupported: true }, { localRunStatus: "runnable" }],
          },
      include: { testCases: { where: { isVisible: true } } },
      orderBy: { leetcodeNumber: "asc" },
    });
    problem =
      candidates
        .map((candidate) => ({
          candidate,
          order: defaultHot150Slugs.indexOf(candidate.slug),
        }))
        .filter((item) => item.order >= 0)
        .sort((left, right) => left.order - right.order)[0]?.candidate ??
      candidates[0] ??
      null;
  }

  if (!problem) {
    throw new MockInterviewError("No mock interview problem is available.", 404);
  }

  if (
    !canUseRemoteProblems &&
    !problem.isDemoSupported &&
    problem.localRunStatus !== "runnable"
  ) {
    throw new MockInterviewError(
      "This non-demo mock interview problem is not local-runnable yet. Choose a demo problem, pick a generated local Hot-150 problem, or enable LeetCode mode.",
      400,
    );
  }

  return problem;
}

export function toProblemDto(problem: ProblemRecord): MockInterviewProblemDto {
  const catalogProblem = getHot150Problem(problem.slug);

  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: problem.leetcodeNumber,
    hot150Order: catalogProblem?.order ?? null,
    hot150Section: catalogProblem?.section ?? null,
    difficulty: problem.difficulty,
    tags: parseJson<string[]>(problem.tags, []),
    statementMarkdown: problem.statementMarkdown,
    examples: parseJson<MockInterviewProblemDto["examples"]>(
      problem.examplesJson,
      [],
    ),
    constraints: parseJson<string[]>(problem.constraintsJson, []),
    isDemoSupported: problem.isDemoSupported,
    starterCode: {
      Python: problem.starterCodePython ?? "",
      "C++": problem.starterCodeCpp ?? "",
    },
    testCases: problem.testCases.map((testCase) => ({
      id: testCase.id,
      label: testCase.label,
      input: parseJson(testCase.inputJson, null),
      expected: parseJson(testCase.expectedJson, null),
      source: testCase.source,
    })),
  };
}

export function toProblemContext(problem: {
  id: string;
  slug: string;
  title: string;
  leetcodeNumber: number | null;
  difficulty: string | null;
  tags: string;
  statementMarkdown?: string;
}): InterviewProblemContext {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: problem.leetcodeNumber,
    difficulty: problem.difficulty,
    tags: parseJson<string[]>(problem.tags, []),
    statementMarkdown: problem.statementMarkdown,
  };
}

export function toSessionDto(session: {
  id: string;
  status: string;
  currentPhase: string;
  questionCount: number;
  maxQuestions: number;
  durationMinutes: number;
  startedAt: Date;
  completedAt: Date | null;
  targetLabel: string | null;
  focusTagsJson: string;
  language: string;
  planItemId: string | null;
}): MockInterviewSessionDto {
  return {
    id: session.id,
    status:
      session.status === "completed" || session.status === "cancelled"
        ? session.status
        : "in_progress",
    currentPhase: mockInterviewPhaseSchema.parse(session.currentPhase),
    questionCount: session.questionCount,
    maxQuestions: session.maxQuestions,
    durationMinutes: session.durationMinutes,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    targetLabel: session.targetLabel,
    focusTags: parseJson<string[]>(session.focusTagsJson, []),
    language: session.language === "C++" ? "C++" : "Python",
    planItemId: session.planItemId,
  };
}

export function toTurnDto(turn: {
  id: string;
  role: string;
  contentMarkdown: string;
  phase: string;
  sequence: number;
  metadataJson: string;
  createdAt: Date;
}): MockInterviewTurnDto {
  return {
    id: turn.id,
    role: normalizeTurnRole(turn.role),
    contentMarkdown: turn.contentMarkdown,
    phase: mockInterviewPhaseSchema.parse(turn.phase),
    sequence: turn.sequence,
    metadata: parseJson<Record<string, unknown>>(turn.metadataJson, {}),
    createdAt: turn.createdAt.toISOString(),
  };
}

export function runResultFromEvidence(
  evidence:
    | {
        status: string;
        passedCount: number;
        failedCount: number;
        durationMs: number | null;
        stdout: string | null;
        stderr: string | null;
        actualOutput: string | null;
        expectedOutput: string | null;
        firstFailedCaseJson: string | null;
        rawResultJson: string;
      }
    | null
    | undefined,
): CodeRunResult | undefined {
  if (!evidence) {
    return undefined;
  }

  const raw = parseJson<CodeRunResult | undefined>(
    evidence.rawResultJson,
    undefined,
  );

  const parsed = codeRunResultSchema.safeParse(raw);
  if (parsed.success) {
    return attachCodeRunErrorDetail(parsed.data);
  }

  return attachCodeRunErrorDetail({
    status: evidence.status as CodeRunResult["status"],
    passedCount: evidence.passedCount,
    failedCount: evidence.failedCount,
    stdout: evidence.stdout ?? "",
    stderr: evidence.stderr ?? "",
    durationMs: evidence.durationMs ?? undefined,
    actualOutput: evidence.actualOutput ?? undefined,
    expectedOutput: evidence.expectedOutput ?? undefined,
    firstFailedCase: evidence.firstFailedCaseJson
      ? parseJson(evidence.firstFailedCaseJson, undefined)
      : undefined,
    testResults: [],
  });
}

export function runVerdictFromEvidence(
  evidence:
    | {
        status: string;
        passedCount: number;
        failedCount: number;
        durationMs: number | null;
        stdout: string | null;
        stderr: string | null;
        actualOutput: string | null;
        expectedOutput: string | null;
        firstFailedCaseJson: string | null;
        rawResultJson: string;
      }
    | null
    | undefined,
): EvidenceVerdict | undefined {
  const runResult = runResultFromEvidence(evidence);

  if (!runResult) {
    return undefined;
  }

  return (
    readEvidenceVerdict(rawResultRecord(runResult.rawResult).evidenceVerdict) ??
    classifyExecutionEvidence(runResult, {
      consumer: "mock_interview",
      providerUsed: readProviderUsed(runResult),
    })
  );
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizePhase(value: string): MockInterviewPhase {
  return mockInterviewPhaseSchema.parse(value);
}

export function normalizeTurnRole(value: string): MockInterviewTurnRole {
  const parsed = mockInterviewTurnRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : "interviewer";
}
