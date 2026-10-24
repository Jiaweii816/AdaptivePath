import type { CategoryDenial } from "./evidence/intent-evidence.types";
import type { BasisSource, TurnRequest } from "./turn-understanding-v2.types";

const HISTORY_BASIS: readonly BasisSource[] = ["past_problems", "past_mistakes"];

/** Strips denied components before pure context/tool projections consume requests. */
export function applyDenialsToRequests(
  requests: readonly TurnRequest[],
  denials: readonly CategoryDenial[],
): TurnRequest[] {
  if (denials.length === 0) return [...requests];
  const deniedBasis = new Set(
    denials.filter((denial) => denial.category === "basis").map((denial) => denial.value),
  );
  const deniedDeliverables = new Set(
    denials.filter((denial) => denial.category === "deliverable").map((denial) => denial.value),
  );
  return requests.reduce<TurnRequest[]>((filtered, request) => {
    if (request.kind !== "respond") return [...filtered, request];
    if (deniedDeliverables.has(request.deliverable)) return filtered;
    const basis = request.basis.filter((source) => !deniedBasis.has(source));
    if (request.deliverable === "recall" && !basis.some((source) => HISTORY_BASIS.includes(source))) {
      return filtered;
    }
    return [...filtered, { ...request, basis }];
  }, []);
}
