export type TurnUnderstandingMode =
  | "legacy"
  | "v2_shadow"
  | "v2_consume";

/** V2 is the normal path; legacy is an explicit, database-free rollback. */
export function getTurnUnderstandingMode(): TurnUnderstandingMode {
  const configured = process.env.TURN_UNDERSTANDING_MODE?.trim();
  if (configured === "legacy" || configured === "v2_shadow") {
    return configured;
  }
  return "v2_consume";
}

export function consumesTurnUnderstandingV2(mode: TurnUnderstandingMode) {
  return mode === "v2_consume";
}
