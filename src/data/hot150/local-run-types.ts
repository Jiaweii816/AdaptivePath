import { z } from "zod";

export const comparisonStrategySchema = z.enum([
  "exact",
  "unordered",
  "multiset_top",
  "multiset_deep",
  "float_tol",
  "inplace_arg",
  "op_sequence",
  "special_judge",
]);

export const localRunStatusSchema = z.enum([
  "not_ready",
  "runnable",
  "harness_review",
  "unsupported",
]);

export const problemContractKindSchema = z.enum([
  "pure_function",
  "inplace_arg",
  "linked_list",
  "binary_tree",
  "grid",
  "design_class",
  "unsupported",
]);

export const problemExecutionParamSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
});

export const problemExecutionContractSchema = z.object({
  name: z.string().min(1),
  params: z.array(problemExecutionParamSchema).default([]),
  returnType: z.string().default("unknown"),
  contractKind: problemContractKindSchema.default("pure_function"),
  inputAdapter: z.string().optional(),
});

export const localHot150TestCaseSchema = z.object({
  label: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  expected: z.unknown(),
  source: z.enum(["local_sample", "local_basic", "local_boundary"]),
  expectedSource: z.enum(["generated", "seed", "user"]).default("generated"),
  gtProvenance: z.string().nullable().default("ac_solution"),
  validationStatus: z
    .enum(["validated", "harness_review", "pending", "unvalidated"])
    .default("pending"),
  sortOrder: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const localHot150ProblemSchema = z.object({
  leetcodeNumber: z.number().int().positive(),
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  hot150Order: z.number().int().positive(),
  hot150Section: z.string().min(1),
  officialUrl: z.string().url(),
  statementMarkdown: z.string().default(""),
  examples: z
    .array(
      z.object({
        input: z.unknown(),
        output: z.unknown(),
        explanation: z.string().optional(),
      }),
    )
    .default([]),
  constraints: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  starterCodePython: z.string().default(""),
  starterCodeCpp: z.string().default(""),
  methodName: z.string().min(1),
  executionContract: problemExecutionContractSchema,
  comparisonStrategy: comparisonStrategySchema.default("exact"),
  comparisonConfig: z.record(z.string(), z.unknown()).default({}),
  localRunStatus: localRunStatusSchema,
  localRunStatusMessage: z.string().optional(),
  localRunValidatedAt: z.string().optional(),
  referenceSolutionHash: z.string().optional(),
  tests: z.array(localHot150TestCaseSchema).default([]),
});

export const localHot150BankSchema = z.object({
  generatedAt: z.string(),
  generatorVersion: z.number().int().positive(),
  problems: z.array(localHot150ProblemSchema),
});

export type ComparisonStrategy = z.infer<typeof comparisonStrategySchema>;
export type LocalRunStatus = z.infer<typeof localRunStatusSchema>;
export type ProblemContractKind = z.infer<typeof problemContractKindSchema>;
export type ProblemExecutionContract = z.infer<
  typeof problemExecutionContractSchema
>;
export type LocalHot150Problem = z.infer<typeof localHot150ProblemSchema>;
export type LocalHot150Bank = z.infer<typeof localHot150BankSchema>;

export function normalizeLeetCodeMetaData(value: unknown): ProblemExecutionContract {
  const parsed =
    typeof value === "string" ? safeJson<Record<string, unknown>>(value, {}) : value;
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const params = Array.isArray(record.params)
    ? record.params
        .map((param) =>
          param && typeof param === "object" && !Array.isArray(param)
            ? (param as Record<string, unknown>)
            : {},
        )
        .map((param, index) => ({
          name: String(param.name ?? `arg${index}`),
          type: String(param.type ?? "unknown"),
        }))
        .filter((param) => param.name.trim())
    : [];
  const returnRecord =
    record.return && typeof record.return === "object" && !Array.isArray(record.return)
      ? (record.return as Record<string, unknown>)
      : {};
  const name = String(record.name ?? record.className ?? "");
  const returnType = String(returnRecord.type ?? record.returnType ?? "unknown");
  const contractKind = inferContractKind({ name, params, returnType });

  return problemExecutionContractSchema.parse({
    name,
    params,
    returnType,
    contractKind,
  });
}

export function inferContractKind(args: {
  name: string;
  params: Array<{ name: string; type: string }>;
  returnType: string;
}): ProblemContractKind {
  const returnType = normalizeType(args.returnType);
  const paramTypes = args.params.map((param) => normalizeType(param.type));

  if (returnType === "void") {
    return "inplace_arg";
  }

  if (paramTypes.some((type) => type.includes("listnode"))) {
    return "linked_list";
  }

  if (paramTypes.some((type) => type.includes("treenode"))) {
    return "binary_tree";
  }

  if (
    paramTypes.some((type) =>
      ["integer[][]", "char[][]", "character[][]", "string[][]", "boolean[][]"].includes(type),
    )
  ) {
    return "grid";
  }

  if (args.params.length === 0 && /^[A-Z]/.test(args.name)) {
    return "design_class";
  }

  return "pure_function";
}

export function normalizeType(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
