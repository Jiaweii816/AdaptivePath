import { binarySearchLearningExperienceCards } from "@/server/memory/learning-experience-recall/binary-search-pilot-cards";
import { binarySearchPilotCoverageManifest } from "@/server/memory/learning-experience-recall/binary-search-pilot-coverage-manifest";

const totals = Object.values(
  binarySearchPilotCoverageManifest.reviewConservation.reviewsByProblem,
).reduce((sum, count) => sum + count, 0);

if (
  totals !== binarySearchPilotCoverageManifest.sourceRowCounts.reviewAttempts
) {
  throw new Error(`Review conservation failed: ${totals} != 65`);
}

const runTotal =
  totals +
  binarySearchPilotCoverageManifest.reviewConservation.extraRunEvidence
    .runEvidenceIds.length -
  1;
if (
  runTotal !== binarySearchPilotCoverageManifest.sourceRowCounts.runEvidence
) {
  throw new Error(`Run conservation failed: ${runTotal} != 66`);
}

const answerEligible = binarySearchLearningExperienceCards.filter(
  (card) => card.answerEligible,
);
const evalOnly = binarySearchLearningExperienceCards.filter(
  (card) => card.evalOnly,
);
if (answerEligible.length !== 1 || evalOnly.length !== 11) {
  throw new Error(
    `Eligibility totals failed: ${answerEligible.length} answerEligible, ${evalOnly.length} evalOnly`,
  );
}
if (
  binarySearchLearningExperienceCards.some(
    (card) => card.answerEligible === card.evalOnly,
  )
) {
  throw new Error("Each card must have exactly one eligibility flag.");
}

console.log(
  JSON.stringify({
    reviews: totals,
    runs: runTotal,
    cards: binarySearchLearningExperienceCards.length,
    answerEligible: answerEligible.length,
    evalOnly: evalOnly.length,
  }),
);
