import prisma from "@/server/db/prisma";
import { getHot150Problem } from "@/data/hot150";
import { getWorkbenchData } from "@/features/workbench/workbench-data";
import type { MockInterviewProblemDto } from "@/types/mock-interview";

export async function getMockInterviewPageData(args: {
  requestedSlug?: string;
}) {
  const { profile, problems, hasLeetCodeSession } = await getWorkbenchData({
    requestedSlug: args.requestedSlug,
  });
  const activeGoal = await prisma.readinessGoal.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "desc" },
  });
  const eligibleProblems = hasLeetCodeSession
    ? problems.filter((problem) => getHot150Problem(problem.slug))
    : problems.filter((problem) => problem.isDemoSupported);
  const sortedProblems = [...eligibleProblems].sort((left, right) => {
    const leftCatalog = getHot150Problem(left.slug);
    const rightCatalog = getHot150Problem(right.slug);

    return (
      (leftCatalog?.order ?? Number.MAX_SAFE_INTEGER) -
        (rightCatalog?.order ?? Number.MAX_SAFE_INTEGER) ||
      (left.leetcodeNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.leetcodeNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.title.localeCompare(right.title)
    );
  });

  return {
    displayName: profile.displayName,
    targetLabel: activeGoal?.targetLabel ?? "Coding mock interview",
    hasLeetCodeSession,
    problems: sortedProblems.map((problem): MockInterviewProblemDto => {
      const catalogProblem = getHot150Problem(problem.slug);

      return {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        leetcodeNumber: problem.leetcodeNumber,
        hot150Order: catalogProblem?.order ?? null,
        hot150Section: catalogProblem?.section ?? null,
        difficulty: problem.difficulty,
        tags: problem.tags,
        statementMarkdown: problem.statementMarkdown,
        examples: problem.examples,
        constraints: problem.constraints,
        isDemoSupported: problem.isDemoSupported,
        starterCode: problem.starterCode,
        testCases: problem.testCases.map((testCase) => ({
          id: testCase.id,
          label: testCase.label,
          input: testCase.input,
          expected: testCase.expected,
          source: testCase.source,
        })),
      };
    }),
  };
}
