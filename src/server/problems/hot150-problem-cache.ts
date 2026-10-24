import type { PrismaClient } from "@prisma/client";
import { getHot150Problem } from "@/data/hot150";
import { normalizeLeetCodeMetaData } from "@/data/hot150/local-run-types";
import prisma from "@/server/db/prisma";
import {
  htmlToPlainMarkdown,
  inferDesignClassContractFromExampleTestcases,
  splitLeetCodeExampleTestcases,
  type StructuredExampleInput,
} from "@/server/hot150-local/example-testcases";
import { resolveCodeRunnerProviderKind } from "@/server/tools/code-runner/run-code-with-tests";
import {
  hasLeetCodeSession,
  LcAuthError,
  LeetCodeApiClient,
  type LcProblem,
} from "@/server/tools/leetcode-api/lc-api-client";

type ProblemCachePrisma = PrismaClient;

export type GetOrFetchProblemOptions = {
  client?: Pick<LeetCodeApiClient, "getProblem">;
};

const json = (value: unknown) => JSON.stringify(value);

export async function getOrFetchProblem(
  slug: string,
  db: ProblemCachePrisma = prisma,
  options: GetOrFetchProblemOptions = {},
) {
  const catalogProblem = getHot150Problem(slug);
  const stored =
    (await db.problem.findUnique({ where: { slug } })) ??
    (catalogProblem
      ? await db.problem.create({
          data: {
            leetcodeNumber: catalogProblem.leetcodeNumber,
            slug: catalogProblem.slug,
            title: catalogProblem.title,
            difficulty: catalogProblem.difficulty,
            hot150Order: catalogProblem.order,
            hot150Section: catalogProblem.section,
            officialUrl: `https://leetcode.com/problems/${catalogProblem.slug}/`,
            statementMarkdown: "",
            examplesJson: "[]",
            constraintsJson: "[]",
            tags: json(catalogProblem.tags),
            starterCodePython: "",
            starterCodeCpp: "",
            methodName: "",
            inputContractJson: "{}",
            outputContractJson: "{}",
            isDemoSupported: false,
            localRunStatus: "not_ready",
            localRunStatusMessage:
              "Local Run is not generated yet for this Hot-150 problem.",
          },
        })
      : null);

  if (!stored) {
    throw new Error(`Only Hot-150 problems are supported in this MVP: ${slug}`);
  }

  if (stored.statementMarkdown.trim()) {
    return stored;
  }

  if (
    !options.client &&
    (resolveCodeRunnerProviderKind() !== "lc" || !hasLeetCodeSession())
  ) {
    throw new LcAuthError(
      "Remote problem fetch is not configured. Choose a supported demo problem or enable the remote judge integration explicitly.",
    );
  }

  const client = options.client ?? new LeetCodeApiClient();
  const lcProblem = await client.getProblem(slug);
  const contract =
    inferDesignClassContractFromExampleTestcases(lcProblem.exampleTestcases) ??
    normalizeLeetCodeMetaData(lcProblem.metaData);
  const examples = splitLeetCodeExampleTestcases(
    lcProblem.exampleTestcases,
    contract,
  );
  const mergedTags = unique([
    ...(catalogProblem?.tags ?? []),
    ...lcProblem.topicTags.map((tag) => tag.slug),
  ]);
  const updated = await db.problem.update({
    where: { id: stored.id },
    data: {
      leetcodeNumber: Number(lcProblem.questionFrontendId),
      title: lcProblem.title,
      difficulty: lcProblem.difficulty,
      hot150Order: catalogProblem?.order,
      hot150Section: catalogProblem?.section,
      officialUrl: `https://leetcode.com/problems/${slug}/`,
      statementMarkdown: htmlToPlainMarkdown(lcProblem.content),
      examplesJson: json(
        examples.map((example, index) => ({
          input: example.input,
          output: null,
          explanation:
            index === 0
              ? "Fetched from LeetCode exampleTestcases; expected output is shown in the statement when available."
              : undefined,
        })),
      ),
      tags: json(mergedTags),
      starterCodePython: snippetFor(lcProblem, "python3"),
      starterCodeCpp: snippetFor(lcProblem, "cpp"),
      methodName: contract.name || stored.methodName,
      inputContractJson: json(contract),
      contractKind: contract.contractKind,
      isDemoSupported: stored.isDemoSupported,
    },
  });

  await createLcExampleTests({
    db,
    problemId: updated.id,
    examples,
  });

  return updated;
}

async function createLcExampleTests(args: {
  db: ProblemCachePrisma;
  problemId: string;
  examples: StructuredExampleInput[];
}) {
  const existingCount = await args.db.problemTestCase.count({
    where: {
      problemId: args.problemId,
      source: "lc_example",
      userId: null,
    },
  });

  if (existingCount > 0 || args.examples.length === 0) {
    return;
  }

  await args.db.problemTestCase.createMany({
    data: args.examples.map((example, index) => ({
      problemId: args.problemId,
      label: `LeetCode example input ${index + 1}`,
      inputJson: json(example.input),
      expectedJson: json(null),
      source: "lc_example",
      expectedSource: "unknown",
      gtProvenance: null,
      validationStatus: "unvalidated",
      metadataJson: json({ dataInput: example.dataInput }),
      isVisible: true,
      sortOrder: index,
    })),
  });
}

function snippetFor(problem: LcProblem, langSlug: "python3" | "cpp") {
  return (
    problem.codeSnippets.find((snippet) => snippet.langSlug === langSlug)
      ?.code ?? ""
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
