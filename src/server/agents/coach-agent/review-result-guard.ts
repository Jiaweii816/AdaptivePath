import {
  canWriteStrengthCandidate,
  classifyExecutionEvidence,
  isNonVerdict,
} from "@/lib/evidence-trust";
import type { CodeRunResult } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";
import type { CoachReviewPlannerContext } from "./coach-agent.types";
import { buildPassedRunResult } from "./review-passed-result";
import {
  deriveFailedReviewMistakeFact,
  derivePassedReviewStrengthFact,
} from "./passed-review-strength";
import { resolveCanonicalMechanismSignal } from "@/server/problems/hot150-taxonomy";

export function alignReviewResultWithRunEvidence(args: {
  coachResult: CoachReviewResult;
  problemSlug: string;
  problemTitle: string;
  problemTags: string[];
  code?: string;
  runResult: CodeRunResult;
  evidenceVerdict?: EvidenceVerdict;
  responseLanguage: "zh" | "en";
  planner?: CoachReviewPlannerContext;
}): CoachReviewResult {
  const evidenceVerdict =
    args.evidenceVerdict ??
    classifyExecutionEvidence(args.runResult, { consumer: "review" });
  const gatedResult = sanitizeReviewResultForEvidence({
    coachResult: args.coachResult,
    evidenceVerdict,
    runResult: args.runResult,
    code: args.code,
    problemTags: args.problemTags,
  });

  if (evidenceVerdict.evidenceClass === "local_only") {
    return withAlignedRunStatus(gatedResult, args.runResult.status);
  }
  if (isNonVerdict(evidenceVerdict)) return gatedResult;
  if (args.runResult.status !== "passed_visible_tests") {
    return withAlignedRunStatus(gatedResult, args.runResult.status);
  }
  return buildPassedRunResult({ ...args, coachResult: gatedResult });
}

function withAlignedRunStatus(
  result: CoachReviewResult,
  runStatus: CodeRunResult["status"],
) {
  if (result.diagnosis.runStatus === runStatus) return result;
  return {
    ...result,
    diagnosis: { ...result.diagnosis, runStatus },
  };
}

function sanitizeReviewResultForEvidence(args: {
  coachResult: CoachReviewResult;
  evidenceVerdict: EvidenceVerdict;
  runResult: CodeRunResult;
  code?: string;
  problemTags: string[];
}): CoachReviewResult {
  if (args.evidenceVerdict.capabilities.canWriteMistakeMemory) {
    let mistakeResult = withFactPolarity(args.coachResult, [
      "mistake",
      "weakness",
    ]);
    const existingFacts = mistakeResult.diagnosis.memoryUpdateCandidate.facts
      .filter(
        (fact) =>
          resolveCanonicalMechanismSignal({
            rawTag: fact.tag,
            problemTags: args.problemTags,
          }).decision === "canonical",
      )
      .map((fact) => ({ ...fact, factType: "mistake" }));
    const derived =
      existingFacts.length === 0
        ? deriveFailedReviewMistakeFact({
            code: args.code,
            problemTags: args.problemTags,
            evidenceScope:
              args.evidenceVerdict.evidenceClass === "local_only"
                ? "local_visible"
                : "official_judge",
            runResult: args.runResult,
          })
        : undefined;
    mistakeResult = {
      ...mistakeResult,
      degraded:
        derived && mistakeResult.degraded
          ? {
              ...mistakeResult.degraded,
              reason: `${mistakeResult.degraded.reason} | Deterministic failed-evidence mistake remains arbitration-eligible.`,
              memorySkipped: false,
            }
          : mistakeResult.degraded,
      diagnosis: {
        ...mistakeResult.diagnosis,
        memoryUpdateCandidate: {
          facts: derived ? [derived] : existingFacts,
          summary: derived
            ? "A deterministic source check produced one evidence-scoped mistake candidate."
            : mistakeResult.diagnosis.memoryUpdateCandidate.summary,
        },
      },
    };
    return mistakeResult;
  }
  if (canWriteStrengthCandidate(args.evidenceVerdict)) {
    let strengthResult = withFactPolarity(args.coachResult, [
      "strength",
      "skill",
    ]);
    const existingFacts = strengthResult.diagnosis.memoryUpdateCandidate.facts
      .filter(
        (fact) =>
          resolveCanonicalMechanismSignal({
            rawTag: fact.tag,
            problemTags: args.problemTags,
          }).decision === "canonical",
      )
      .map((fact) => ({ ...fact, factType: "strength" }));
    const derived =
      existingFacts.length === 0
        ? derivePassedReviewStrengthFact({
            code: args.code,
            problemTags: args.problemTags,
            evidenceScope:
              args.evidenceVerdict.evidenceClass === "local_only"
                ? "local_visible"
                : "official_judge",
          })
        : undefined;
    strengthResult = {
      ...strengthResult,
      degraded:
        derived && strengthResult.degraded
          ? {
              ...strengthResult.degraded,
              reason: `${strengthResult.degraded.reason} | Deterministic passed-evidence strength remains arbitration-eligible.`,
              memorySkipped: false,
            }
          : strengthResult.degraded,
      diagnosis: {
        ...strengthResult.diagnosis,
        memoryUpdateCandidate: {
          facts: derived ? [derived] : existingFacts,
          summary: derived
            ? "A deterministic source check produced one evidence-scoped strength candidate."
            : strengthResult.diagnosis.memoryUpdateCandidate.summary,
        },
      },
    };
    return {
      ...strengthResult,
      diagnosis: {
        ...strengthResult.diagnosis,
        runStatus: args.runResult.status,
        mistakeTags: [],
      },
    };
  }
  return {
    ...args.coachResult,
    diagnosis: {
      ...args.coachResult.diagnosis,
      runStatus: args.runResult.status,
      mistakeTags: [],
      memoryUpdateCandidate: {
        facts: [],
        summary:
          "Skipped learner mistake memory because this evidence is not mistake-memory eligible.",
      },
    },
    degraded: mergeMemorySkippedDegradation(
      args.coachResult.degraded,
      `Evidence gate skipped mistake memory for ${args.evidenceVerdict.evidenceClass}.`,
    ),
  };
}

function withFactPolarity(
  result: CoachReviewResult,
  allowedFactTypes: string[],
): CoachReviewResult {
  const facts = result.diagnosis.memoryUpdateCandidate.facts.filter((fact) =>
    allowedFactTypes.includes(fact.factType),
  );
  return {
    ...result,
    diagnosis: {
      ...result.diagnosis,
      memoryUpdateCandidate: {
        facts,
        summary:
          facts.length > 0
            ? result.diagnosis.memoryUpdateCandidate.summary
            : `No ${allowedFactTypes.join("/")} candidate survived the evidence-polarity gate.`,
      },
    },
  };
}

function mergeMemorySkippedDegradation(
  degraded: CoachReviewResult["degraded"],
  reason: string,
): CoachReviewResult["degraded"] {
  if (!degraded) return { reason, memorySkipped: true };
  return {
    ...degraded,
    reason: `${degraded.reason} | ${reason}`,
    memorySkipped: true,
  };
}
