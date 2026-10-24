import type { CampaignRoadmapNodeView } from "@/server/campaign";
import {
  ROADMAP_SEMANTIC_CANVAS,
  ROADMAP_SEMANTIC_DISPLAY_ORDER,
  ROADMAP_SEMANTIC_POSITIONS,
} from "./roadmap-semantic-layout";

/**
 * Compatibility facade for the Campaign map renderer and its tests.
 *
 * The semantic layout is keyed exclusively by curriculum display identity
 * (N1 … N20), never by a campaign order, database primary key, or adjacency
 * traversal. Keeping this small facade lets the visual graph evolve without
 * making presentation geometry part of campaign business state.
 */
export const ROADMAP_CANVAS = ROADMAP_SEMANTIC_CANVAS;
export const ROADMAP_DISPLAY_ORDER = ROADMAP_SEMANTIC_DISPLAY_ORDER;

const displayRank = new Map<string, number>(
  ROADMAP_DISPLAY_ORDER.map((nodeId, index) => [nodeId, index + 1]),
);

export type GrowthMapPosition = Readonly<{
  index: number;
  mobileOrder: number;
  node: CampaignRoadmapNodeView;
  x: number;
  y: number;
}>;

function fallbackCoordinates(index: number) {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return { x: 130 + column * 220, y: 150 + row * 170 };
}

/**
 * Produces deterministic, view-only positions. It neither persists data nor
 * participates in selection, mastery, recovery, replan, or dependency rules.
 */
export function buildGrowthMapLayout(
  nodes: readonly CampaignRoadmapNodeView[],
): readonly GrowthMapPosition[] {
  const seen = new Set<string>();
  return nodes.map((node, index) => {
    if (seen.has(node.nodeId)) {
      throw new Error(`Duplicate Growth Map node: ${node.nodeId}`);
    }
    seen.add(node.nodeId);
    const coordinates = ROADMAP_SEMANTIC_POSITIONS[
      node.nodeId as keyof typeof ROADMAP_SEMANTIC_POSITIONS
    ] ?? fallbackCoordinates(index);
    return {
      node,
      index,
      mobileOrder: displayRank.get(node.nodeId) ?? index + 1,
      x: coordinates.x,
      y: coordinates.y,
    };
  });
}
