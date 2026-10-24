import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hot150ReferenceMarkdown } from "./fixtures/hot150-reference-solutions";
import { resolve } from "node:path";
import { hot150Problems } from "@/data/hot150";
import { getHot150ComparisonOverride } from "@/data/hot150/comparison-overrides";
import {
  comparisonStrategySchema,
  normalizeLeetCodeMetaData,
  normalizeType,
  safeJson,
  type ComparisonStrategy,
  type LocalHot150Problem,
  type LocalRunStatus,
  type ProblemExecutionContract,
} from "@/data/hot150/local-run-types";
import {
  htmlToPlainMarkdown,
  inferDesignClassContractFromExampleTestcases,
  splitLeetCodeExampleTestcases,
  type StructuredExampleInput,
} from "@/server/hot150-local/example-testcases";
import {
  mapReferenceSolutionsByNumber,
  parseHot150ReferenceSolutions,
} from "@/server/hot150-local/reference-solutions";
import { createPistonRunnerProvider } from "@/server/tools/code-runner/piston-runner";
import {
  LeetCodeApiClient,
  type LcProblem,
} from "@/server/tools/leetcode-api/lc-api-client";
import type { CodeRunResult, CodeRunTestCase } from "@/types/code-runner";

type CliOptions = {
  slugs: Set<string> | null;
  outFile: string;
};

const defaultOutFile = resolve("src/data/hot150/local-bank.generated.ts");

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const markdown = hot150ReferenceMarkdown();
  const references = mapReferenceSolutionsByNumber(
    parseHot150ReferenceSolutions(markdown),
  );
  const client = new LeetCodeApiClient();
  const runner = createPistonRunnerProvider({ providerUsed: "local_hot150" });
  const selectedProblems = hot150Problems.filter(
    (problem) => !options.slugs || options.slugs.has(problem.slug),
  );
  const generatedProblems: LocalHot150Problem[] = [];

  for (const catalogProblem of selectedProblems) {
    const reference = references.get(catalogProblem.leetcodeNumber);

    if (!reference) {
      throw new Error(
        `Missing reference solution for LC ${catalogProblem.leetcodeNumber}.`,
      );
    }

    console.log(
      `Building local bank entry for LC ${catalogProblem.leetcodeNumber} ${catalogProblem.slug}`,
    );
    let lcProblem: LcProblem | null = null;
    let contract: ProblemExecutionContract = fallbackContract(
      catalogProblem.title,
    );
    let examples: StructuredExampleInput[] = [];
    let comparisonStrategy: ComparisonStrategy = "exact";
    let comparisonConfig: Record<string, unknown> = {};
    let runResult: CodeRunResult | null = null;
    let validationError: string | null = null;

    try {
      lcProblem = await client.getProblem(catalogProblem.slug);
      contract =
        inferDesignClassContractFromExampleTestcases(lcProblem.exampleTestcases) ??
        normalizeLeetCodeMetaData(lcProblem.metaData);
      contract = applyInputAdapter(catalogProblem.leetcodeNumber, contract);
      examples = splitLeetCodeExampleTestcases(
        lcProblem.exampleTestcases,
        contract,
      );

      if (examples.length === 0) {
        throw new Error(
          "No structured example testcases were produced from LeetCode metadata.",
        );
      }

      const comparison = selectComparisonPlan(catalogProblem.leetcodeNumber, contract);
      comparisonStrategy = comparison.strategy;
      comparisonConfig = comparison.config;
      validateComparisonSelection(catalogProblem.leetcodeNumber, contract, comparison);

      const testCases = examples.map<CodeRunTestCase>((example, index) => ({
        id: `local-sample-${index + 1}`,
        label: `local sample ${index + 1}`,
        input: example.input,
        expected: null,
        source: "local_sample",
      }));

      runResult = await runner.run({
        problem: {
          slug: catalogProblem.slug,
          title: catalogProblem.title,
          leetcodeNumber: catalogProblem.leetcodeNumber,
          methodName: contract.name,
          tags: catalogProblem.tags,
          inputContract: contract,
          localRunStatus: "runnable",
          comparisonStrategy,
          comparisonConfig,
          contractKind: contract.contractKind,
        },
        language: "Python",
        code: reference.code,
        testCases,
        executionKind: "visible_run",
      });
    } catch (error) {
      validationError = formatError(error);
      contract = fallbackContract(catalogProblem.title, lcProblem?.metaData);
    }

    const failedHarness =
      validationError !== null ||
      runResult?.status === "runtime_error" ||
      runResult?.status === "syntax_error" ||
      runResult?.status === "compile_error" ||
      runResult?.status === "runner_error" ||
      runResult?.status === "timeout" ||
      runResult?.status === "empty_code" ||
      runResult?.status === "no_tests" ||
      runResult?.status === "unsupported_language";
    const rawTests = examples.map((example, index) => {
      const testResult = runResult?.testResults[index];
      const hasActual = Boolean(testResult && "actual" in testResult);

      return {
        label: `local sample ${index + 1}`,
        input: example.input,
        expected: hasActual ? testResult?.actual : null,
        source: "local_sample" as const,
        sortOrder: index,
        metadata: {
          dataInput: example.dataInput,
          gtGeneratedBy: "ac_solution_piston",
          referenceProvider:
            readProviderUsed(runResult?.rawResult) ?? "local_hot150",
        },
      };
    });
    const hasMissingActual = examples.some((_, index) => {
      const testResult = runResult?.testResults[index];

      return !(testResult && "actual" in testResult);
    });
    let localRunStatus: LocalRunStatus =
      failedHarness || hasMissingActual ? "harness_review" : "runnable";
    let harnessMessage = firstNonEmptyString(
      validationError,
      runResult?.stderr,
      runResult?.status,
      "unknown harness failure",
    );

    if (localRunStatus === "runnable") {
      const selfCheckResult = await runner.run({
        problem: {
          slug: catalogProblem.slug,
          title: catalogProblem.title,
          leetcodeNumber: catalogProblem.leetcodeNumber,
          methodName: contract.name,
          tags: catalogProblem.tags,
          inputContract: contract,
          localRunStatus: "runnable",
          comparisonStrategy,
          comparisonConfig,
          contractKind: contract.contractKind,
        },
        language: "Python",
        code: reference.code,
        testCases: rawTests.map<CodeRunTestCase>((test, index) => ({
          id: `local-self-check-${index + 1}`,
          label: test.label,
          input: test.input,
          expected: test.expected,
          source: test.source,
        })),
        executionKind: "visible_run",
      });

      if (selfCheckResult.status !== "passed_visible_tests") {
        localRunStatus = "harness_review";
        const selfCheckDetail = firstNonEmptyString(
          selfCheckResult.stderr,
          JSON.stringify(selfCheckResult.firstFailedCase),
          "no detailed self-check output",
        );
        harnessMessage = `self-check failed with ${selfCheckResult.status}: ${selfCheckDetail}`;
      }
    }

    const tests = rawTests.map((test) => ({
      ...test,
      expectedSource: "generated" as const,
      gtProvenance: "ac_solution",
      validationStatus:
        localRunStatus === "runnable"
          ? ("validated" as const)
          : ("harness_review" as const),
      metadata: {
        ...test.metadata,
        referenceRunStatus:
          localRunStatus === "runnable" ? "gt_emitted" : "harness_failed",
      },
    }));

    generatedProblems.push({
      leetcodeNumber: catalogProblem.leetcodeNumber,
      slug: catalogProblem.slug,
      title: lcProblem?.title ?? catalogProblem.title,
      difficulty: lcProblem?.difficulty ?? catalogProblem.difficulty,
      hot150Order: catalogProblem.order,
      hot150Section: catalogProblem.section,
      officialUrl: `https://leetcode.com/problems/${catalogProblem.slug}/`,
      statementMarkdown: lcProblem ? htmlToPlainMarkdown(lcProblem.content) : "",
      examples: tests.map((test) => ({
        input: test.input,
        output: test.expected,
      })),
      constraints: [],
      tags: [
        ...new Set([
          ...catalogProblem.tags,
          ...(lcProblem?.topicTags.map((tag) => tag.slug) ?? []),
        ]),
      ],
      starterCodePython:
        lcProblem?.codeSnippets.find((snippet) => snippet.langSlug === "python3")
          ?.code ?? "",
      starterCodeCpp:
        lcProblem?.codeSnippets.find((snippet) => snippet.langSlug === "cpp")
          ?.code ?? "",
      methodName: contract.name,
      executionContract: contract,
      comparisonStrategy,
      comparisonConfig,
      localRunStatus,
      localRunStatusMessage:
        localRunStatus === "runnable"
          ? "Local Python Run is available with reference-solution-generated visible tests."
          : `Harness review required before local Run is enabled: ${harnessMessage}`,
      localRunValidatedAt:
        localRunStatus === "runnable" ? new Date().toISOString() : undefined,
      referenceSolutionHash: `sha256:${createHash("sha256")
        .update(reference.code)
        .digest("hex")}`,
      tests,
    });
  }

  await writeLocalBank(options.outFile, generatedProblems);
  console.log(`Wrote ${generatedProblems.length} local bank entries to ${options.outFile}`);
}

function parseCliOptions(args: string[]): CliOptions {
  let outFile = defaultOutFile;
  let slugs: Set<string> | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out") {
      outFile = resolve(args[index + 1] ?? defaultOutFile);
      index += 1;
      continue;
    }

    if (arg === "--slugs") {
      slugs = new Set(
        (args[index + 1] ?? "")
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean),
      );
      index += 1;
    }
  }

  return { slugs, outFile };
}

async function writeLocalBank(outFile: string, problems: LocalHot150Problem[]) {
  const payload = {
    generatedAt: new Date().toISOString(),
    generatorVersion: 1,
    problems,
  };
  const source = [
    'import { localHot150BankSchema } from "./local-run-types";',
    "",
    `export const localHot150Bank = localHot150BankSchema.parse(${JSON.stringify(payload, null, 2)});`,
    "",
  ].join("\n");

  await writeFile(outFile, source, "utf8");
}

type ComparisonPlan = {
  config: Record<string, unknown>;
  strategy: ComparisonStrategy;
};

function selectComparisonPlan(
  leetcodeNumber: number,
  contract: ProblemExecutionContract,
): ComparisonPlan {
  const override = getHot150ComparisonOverride(leetcodeNumber);

  if (override) {
    return {
      config: override.comparisonConfig ?? {},
      strategy: comparisonStrategySchema.parse(override.strategy),
    };
  }

  if (contract.contractKind === "inplace_arg") {
    return { config: {}, strategy: "inplace_arg" };
  }

  if (contract.contractKind === "design_class") {
    return { config: {}, strategy: "op_sequence" };
  }

  return { config: {}, strategy: "exact" };
}

function validateComparisonSelection(
  leetcodeNumber: number,
  contract: ProblemExecutionContract,
  comparison: ComparisonPlan,
) {
  const override = getHot150ComparisonOverride(leetcodeNumber);

  if (requiresExplicitComparison(contract) && !override) {
    throw new Error(
      `LC ${leetcodeNumber} return type ${contract.returnType} requires an explicit comparison override.`,
    );
  }

  if (
    comparison.strategy === "special_judge" &&
    comparison.config.kind !== "topological_order"
  ) {
    throw new Error(
      `LC ${leetcodeNumber} uses special_judge without a supported comparisonConfig.kind.`,
    );
  }
}

function requiresExplicitComparison(contract: ProblemExecutionContract) {
  if (contract.contractKind === "inplace_arg" || contract.contractKind === "design_class") {
    return false;
  }

  const returnType = normalizeType(contract.returnType);

  return (
    returnType.includes("[]") ||
    returnType.includes("list<") ||
    returnType.includes("vector<") ||
    returnType.includes("double") ||
    returnType.includes("float")
  );
}

function applyInputAdapter(
  leetcodeNumber: number,
  contract: ProblemExecutionContract,
): ProblemExecutionContract {
  if (leetcodeNumber === 141) {
    return {
      ...contract,
      inputAdapter: "linked_list_with_cycle",
    };
  }

  if (leetcodeNumber === 138) {
    return {
      ...contract,
      inputAdapter: "node_random_list",
      params: contract.params.map((param) =>
        param.name === "head" ? { ...param, type: "Node" } : param,
      ),
      returnType: "Node",
    };
  }

  if (leetcodeNumber === 117) {
    return {
      ...contract,
      inputAdapter: "node_next_tree",
      params: contract.params.map((param) =>
        param.name === "root" ? { ...param, type: "Node" } : param,
      ),
      returnType: "Node",
    };
  }

  if (leetcodeNumber === 133) {
    return {
      ...contract,
      inputAdapter: "node_graph",
      name: "cloneGraph",
      params: [{ name: "node", type: "Node" }],
      returnType: "Node",
      contractKind: "pure_function",
    };
  }

  if (leetcodeNumber === 427) {
    return {
      ...contract,
      inputAdapter: "quad_tree",
      returnType: "Node",
    };
  }

  return contract;
}

function fallbackContract(
  title: string,
  metadata?: string | null,
): ProblemExecutionContract {
  const record = safeJson<Record<string, unknown>>(metadata, {});
  const name = firstNonEmptyString(
    record.name,
    record.className,
    pascalCase(title),
  );

  return {
    name,
    params: [],
    returnType: "unknown",
    contractKind: "unsupported",
  };
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "UnsupportedProblem";
}

function pascalCase(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "UnsupportedProblem"
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readProviderUsed(rawResult: unknown) {
  if (!rawResult || typeof rawResult !== "object") {
    return undefined;
  }

  const providerUsed = (rawResult as { providerUsed?: unknown }).providerUsed;

  return typeof providerUsed === "string" ? providerUsed : undefined;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
