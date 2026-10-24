import { createHash } from "node:crypto";
import { z } from "zod";

export const manualProvenanceClassificationSchema = z.enum([
  "learner",
  "development",
  "evaluation",
  "test",
  "unsure",
]);

export type ManualProvenanceClassification = z.infer<
  typeof manualProvenanceClassificationSchema
>;

export type ManualProvenanceDecision = {
  reviewAttemptId: string;
  chatSessionId: string;
  leetcodeNumber: number | null;
  problemTitle: string;
  activityLabel: string;
  classification: ManualProvenanceClassification;
  decisionSource: "activity_checkbox" | "problem_batch";
};

export type ManualProvenanceManifest = {
  manifestVersion: 1;
  learnerHandle: string;
  sourceMarkdownSha256: string;
  decisionFingerprint: string;
  generatedAt: string;
  counts: {
    total: number;
    learner: number;
    development: number;
    evaluation: number;
    test: number;
    unsure: number;
  };
  decisions: ManualProvenanceDecision[];
};

type ProblemContext = {
  leetcodeNumber: number | null;
  problemTitle: string;
  batch?: {
    classification: ManualProvenanceClassification;
    expectedClusterCount: number;
  };
};

const problemHeadingPattern = /^## LC (\d+) · (.+)$/;
const activityHeadingPattern = /^### (活动 [^·]+ · .+)$/;
const reviewMarkerPattern =
  /^<!-- patterncoach-provenance-review reviewAttemptId="([^"]+)" chatSessionId="([^"]+)" currentOrigin="([^"]+)" -->$/;
const batchMarkerPattern =
  /^<!-- patterncoach-provenance-batch leetcodeNumber="(\d+)" classification="([^"]+)" clusterCount="(\d+)" -->$/;
const checkboxPattern =
  /^- \[([^\]]*)\] (Learner|Development|Evaluation\/Test|Unsure)$/;

export function parseManualProvenanceReviewMarkdown(
  markdown: string,
): ManualProvenanceDecision[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const decisions: ManualProvenanceDecision[] = [];
  const problemCounts = new Map<number, number>();
  const batchCounts = new Map<number, number>();
  let problem: ProblemContext | undefined;
  let activityLabel = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const problemMatch = problemHeadingPattern.exec(line);
    if (problemMatch) {
      problem = {
        leetcodeNumber: Number(problemMatch[1]),
        problemTitle: problemMatch[2]!.trim(),
      };
      activityLabel = "";
      continue;
    }

    const batchMatch = batchMarkerPattern.exec(line);
    if (batchMatch) {
      if (!problem || problem.leetcodeNumber !== Number(batchMatch[1])) {
        throw new Error(
          `Batch decision at line ${index + 1} does not match its problem heading.`,
        );
      }
      problem.batch = {
        classification: normalizeClassification(batchMatch[2]!),
        expectedClusterCount: Number(batchMatch[3]),
      };
      continue;
    }

    const activityMatch = activityHeadingPattern.exec(line);
    if (activityMatch) {
      activityLabel = activityMatch[1]!;
      continue;
    }

    const reviewMatch = reviewMarkerPattern.exec(line);
    if (!reviewMatch) continue;
    if (!problem || !activityLabel) {
      throw new Error(
        `Review decision at line ${index + 1} is missing problem/activity context.`,
      );
    }

    const selected: ManualProvenanceClassification[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]!;
      if (
        reviewMarkerPattern.test(candidate) ||
        problemHeadingPattern.test(candidate) ||
        activityHeadingPattern.test(candidate)
      ) {
        break;
      }
      const checkboxMatch = checkboxPattern.exec(candidate);
      if (checkboxMatch && isCheckedMarker(checkboxMatch[1]!)) {
        selected.push(normalizeClassification(checkboxMatch[2]!));
      }
    }

    const classification = resolveDecisionClassification({
      problem,
      activityLabel,
      selected,
    });
    decisions.push({
      reviewAttemptId: reviewMatch[1]!,
      chatSessionId: reviewMatch[2]!,
      leetcodeNumber: problem.leetcodeNumber,
      problemTitle: problem.problemTitle,
      activityLabel,
      classification,
      decisionSource: problem.batch ? "problem_batch" : "activity_checkbox",
    });
    if (problem.leetcodeNumber !== null) {
      problemCounts.set(
        problem.leetcodeNumber,
        (problemCounts.get(problem.leetcodeNumber) ?? 0) + 1,
      );
      if (problem.batch) {
        batchCounts.set(
          problem.leetcodeNumber,
          (batchCounts.get(problem.leetcodeNumber) ?? 0) + 1,
        );
      }
    }
  }

  const duplicateIds = duplicateValues(
    decisions.map((decision) => decision.reviewAttemptId),
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Approval document contains duplicate ReviewAttempt ids: ${duplicateIds.join(", ")}`,
    );
  }

  for (const [leetcodeNumber, count] of batchCounts) {
    const batch = decisions.find(
      (decision) => decision.leetcodeNumber === leetcodeNumber,
    );
    const problemContext = findBatchContext(lines, leetcodeNumber);
    if (!batch || !problemContext || count !== problemContext.expectedClusterCount) {
      throw new Error(
        `LC ${leetcodeNumber} batch expected ${problemContext?.expectedClusterCount ?? "unknown"} clusters but found ${count}.`,
      );
    }
    if ((problemCounts.get(leetcodeNumber) ?? 0) !== count) {
      throw new Error(`LC ${leetcodeNumber} batch did not cover every cluster.`);
    }
  }

  if (decisions.length === 0) {
    throw new Error("Approval document contains no provenance decisions.");
  }
  return decisions;
}

export function buildManualProvenanceManifest(args: {
  learnerHandle: string;
  markdown: string;
  generatedAt?: Date;
}): ManualProvenanceManifest {
  const decisions = parseManualProvenanceReviewMarkdown(args.markdown);
  const counts = {
    total: decisions.length,
    learner: 0,
    development: 0,
    evaluation: 0,
    test: 0,
    unsure: 0,
  };
  for (const decision of decisions) {
    counts[decision.classification] += 1;
  }
  const decisionPayload = decisions
    .map((decision) => ({
      reviewAttemptId: decision.reviewAttemptId,
      chatSessionId: decision.chatSessionId,
      classification: decision.classification,
    }))
    .sort((a, b) => a.reviewAttemptId.localeCompare(b.reviewAttemptId));

  return {
    manifestVersion: 1,
    learnerHandle: args.learnerHandle,
    sourceMarkdownSha256: sha256(args.markdown),
    decisionFingerprint: sha256(JSON.stringify(decisionPayload)),
    generatedAt: (args.generatedAt ?? new Date()).toISOString(),
    counts,
    decisions,
  };
}

export function parseManualProvenanceManifest(
  value: unknown,
): ManualProvenanceManifest {
  const manifest = manualProvenanceManifestSchema.parse(value);
  const rebuiltCounts = {
    total: manifest.decisions.length,
    learner: 0,
    development: 0,
    evaluation: 0,
    test: 0,
    unsure: 0,
  };
  for (const decision of manifest.decisions) {
    rebuiltCounts[decision.classification] += 1;
  }
  if (JSON.stringify(rebuiltCounts) !== JSON.stringify(manifest.counts)) {
    throw new Error("Approval manifest counts do not match its decisions.");
  }
  const duplicateIds = duplicateValues(
    manifest.decisions.map((decision) => decision.reviewAttemptId),
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Approval manifest contains duplicate ReviewAttempt ids: ${duplicateIds.join(", ")}`,
    );
  }
  return manifest;
}

const manualProvenanceDecisionSchema = z.object({
  reviewAttemptId: z.string().trim().min(1),
  chatSessionId: z.string().trim().min(1),
  leetcodeNumber: z.number().int().positive().nullable(),
  problemTitle: z.string().trim().min(1),
  activityLabel: z.string().trim().min(1),
  classification: manualProvenanceClassificationSchema,
  decisionSource: z.enum(["activity_checkbox", "problem_batch"]),
});

const manualProvenanceManifestSchema = z.object({
  manifestVersion: z.literal(1),
  learnerHandle: z.string().trim().min(1),
  sourceMarkdownSha256: z.string().regex(/^[a-f0-9]{64}$/),
  decisionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    learner: z.number().int().nonnegative(),
    development: z.number().int().nonnegative(),
    evaluation: z.number().int().nonnegative(),
    test: z.number().int().nonnegative(),
    unsure: z.number().int().nonnegative(),
  }),
  decisions: z.array(manualProvenanceDecisionSchema).min(1),
});

function resolveDecisionClassification(args: {
  problem: ProblemContext;
  activityLabel: string;
  selected: ManualProvenanceClassification[];
}) {
  if (args.problem.batch) {
    if (
      args.selected.length > 0 &&
      args.selected.some(
        (selection) => selection !== args.problem.batch!.classification,
      )
    ) {
      throw new Error(
        `${args.activityLabel} conflicts with the LC ${args.problem.leetcodeNumber} batch decision.`,
      );
    }
    return args.problem.batch.classification;
  }
  if (args.selected.length !== 1) {
    throw new Error(
      `${args.problem.problemTitle} ${args.activityLabel} must have exactly one classification; found ${args.selected.length}.`,
    );
  }
  return args.selected[0]!;
}

function normalizeClassification(
  value: string,
): ManualProvenanceClassification {
  switch (value.trim().toLowerCase()) {
    case "learner":
      return "learner";
    case "development":
      return "development";
    case "evaluation/test":
    case "evaluation":
      return "evaluation";
    case "test":
      return "test";
    case "unsure":
      return "unsure";
    default:
      throw new Error(`Unknown provenance classification: ${value}`);
  }
}

function isCheckedMarker(value: string) {
  return ["1", "x", "✓", "✔"].includes(value.trim().toLowerCase());
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function findBatchContext(lines: string[], leetcodeNumber: number) {
  for (const line of lines) {
    const match = batchMarkerPattern.exec(line);
    if (match && Number(match[1]) === leetcodeNumber) {
      return { expectedClusterCount: Number(match[3]) };
    }
  }
  return undefined;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
