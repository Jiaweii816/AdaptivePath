import type { TurnRequest } from "../turn-understanding-v2.types";

/** Stable, order-insensitive textual request form for labelled evaluations. */
export function requestSignature(request: TurnRequest): string {
  if (request.kind === "execute") return `execute:${request.target}`;
  if (request.kind === "persist") return `persist:${request.collection}`;
  const basis = [...request.basis].sort().join("|");
  return [
    "respond",
    request.deliverable,
    request.target,
    basis,
    request.delivery.depth,
    request.delivery.form,
  ].join(":");
}
