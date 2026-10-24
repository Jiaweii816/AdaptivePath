import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";

import { deriveToolEligibilityV2 } from "./tool-eligibility-v2";
import type { TurnRequest } from "./turn-understanding-v2.types";

/**
 * Projects request dependencies onto tool scheduling. Requests in the same
 * dependency layer retain source-span order, then their original array order.
 */
export function toolOrderFromTopology(
  requests: readonly TurnRequest[],
): Map<ChatToolName, number> {
  const ranks = topologicalRanks(requests);
  const ordered = requests
    .map((request, index) => ({
      request,
      index,
      offset: requestOffset(request, index),
    }))
    .sort((left, right) => left.offset - right.offset || left.index - right.index);
  const stride = ordered.length + 1;
  const order = new Map<ChatToolName, number>();

  ordered.forEach(({ request }, index) => {
    const score = (ranks.get(request.id) ?? 0) * stride + index;
    for (const tool of toolsForRequest(request)) setEarlierOrder(order, tool, score);
  });
  return order;
}

function toolsForRequest(request: TurnRequest): ChatToolName[] {
  return deriveToolEligibilityV2({
    requests: [request],
    effectDenials: [],
    categoryDenials: [],
  }).filter((tool) => tool !== "recall_learning_experience");
}

function setEarlierOrder(
  order: Map<ChatToolName, number>,
  tool: ChatToolName,
  score: number,
) {
  const existing = order.get(tool);
  if (existing === undefined || score < existing) order.set(tool, score);
}

function requestOffset(request: TurnRequest, index: number) {
  const offset = request.evidence.reduce(
    (first, evidence) => Math.min(first, evidence.start),
    Number.POSITIVE_INFINITY,
  );
  return offset === Number.POSITIVE_INFINITY ? index : offset;
}

function topologicalRanks(
  requests: readonly TurnRequest[],
): Map<string, number> {
  const byId = new Map(requests.map((request) => [request.id, request]));
  const ranks = new Map<string, number>();
  for (const request of requests) rankRequest(request.id, byId, ranks, new Set());
  return ranks;
}

function rankRequest(
  id: string,
  byId: ReadonlyMap<string, TurnRequest>,
  ranks: Map<string, number>,
  visiting: ReadonlySet<string>,
): number {
  const cached = ranks.get(id);
  if (cached !== undefined) return cached;
  const request = byId.get(id);
  if (!request || visiting.has(id)) return 0;
  const next = new Set([...visiting, id]);
  const rank = request.dependsOn.reduce(
    (highest, dependency) =>
      Math.max(highest, rankRequest(dependency, byId, ranks, next) + 1),
    0,
  );
  ranks.set(id, rank);
  return rank;
}
