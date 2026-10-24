import {
  REPAIR_REASONS,
  type LearnerNodeStateProjection,
  type MasteryReductionInput,
  type MasteryReductionOutput,
  type SettlementProjection,
} from "../domain/contracts";

function sortedSettlements(
  settlements: readonly SettlementProjection[],
): SettlementProjection[] {
  return [...settlements].sort(
    (left, right) =>
      left.settledAt.getTime() - right.settledAt.getTime() ||
      left.settlementId.localeCompare(right.settlementId),
  );
}

function latestIds(settlements: readonly SettlementProjection[]): string[] {
  return settlements.slice(-20).map((settlement) => settlement.settlementId);
}

/**
 * A repeated positive for the same slug keeps, but does not extend, the current
 * distinct-problem streak. Any negative clears it. This makes A+, A+, B+
 * deterministically master on B without deleting or hiding either A settlement.
 */
export function reduceLearnerNodeState(
  input: MasteryReductionInput,
): MasteryReductionOutput {
  const settlements = sortedSettlements(input.settlements);
  const initialHealth = input.currentState.masteryHealth;
  let state: LearnerNodeStateProjection = {
    ...input.currentState,
    latestSettlementIds: latestIds(settlements),
  };
  let becameMastered = false;

  if (state.masteryState === "learning") {
    const distinctPositiveSlugs = new Set<string>();
    for (const settlement of settlements) {
      if (!settlement.positiveForMastery && !settlement.negativeOutcome) {
        continue;
      }
      if (!settlement.positiveForMastery) {
        distinctPositiveSlugs.clear();
        continue;
      }
      distinctPositiveSlugs.add(settlement.problemSlug);
      if (distinctPositiveSlugs.size >= 2) {
        state = {
          ...state,
          masteryState: "mastered",
          masteryHealth: "stable",
          masteredAt: settlement.settledAt,
          masteredBySettlementId: settlement.settlementId,
          latestPositiveStreak: distinctPositiveSlugs.size,
        };
        becameMastered = true;
        break;
      }
    }
    if (!becameMastered) {
      state = {
        ...state,
        latestPositiveStreak: distinctPositiveSlugs.size,
      };
    }
  }

  if (state.masteryState === "mastered") {
    const masteredIndex = state.masteredBySettlementId
      ? settlements.findIndex(
          (settlement) => settlement.settlementId === state.masteredBySettlementId,
        )
      : -1;
    const postMastery = settlements.slice(masteredIndex + 1);
    const latest = postMastery.at(-1);
    if (latest) {
      if (latest.positiveForMastery) {
        state = { ...state, masteryHealth: "stable" };
      } else if (latest.negativeOutcome) {
        const outcomeSettlements = postMastery.filter(
          (settlement) => settlement.positiveForMastery || settlement.negativeOutcome,
        );
        const previous = outcomeSettlements.at(-2);
        const consecutiveNegative =
          Boolean(previous) &&
          previous!.negativeOutcome &&
          latest.negativeOutcome;
        state = {
          ...state,
          masteryHealth:
            latest.slotRole === "target" || consecutiveNegative
              ? "needs_reinforcement"
              : "watch",
        };
      }
    }
  }

  const masteredNeedsRepair =
    state.masteryState === "mastered" &&
    state.masteryHealth === "needs_reinforcement" &&
    initialHealth !== "needs_reinforcement";

  return {
    state,
    becameMastered,
    healthChanged: initialHealth !== state.masteryHealth,
    shouldEnqueueRepair: masteredNeedsRepair,
    repairReason: masteredNeedsRepair
      ? REPAIR_REASONS.MASTERY_NEEDS_REINFORCEMENT
      : null,
  };
}
