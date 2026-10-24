/**
 * Presentation-only geometry for the curated Campaign Roadmap.
 *
 * This is deliberately keyed by the stable curriculum display identity, not
 * by a mutable campaign order or database primary key. It does not create,
 * remove, or classify dependencies: consumers must still render only edges
 * supplied by the Campaign roadmap view.
 */

export type RoadmapCurriculumNodeId =
  | "N1"
  | "N2"
  | "N3"
  | "N4"
  | "N5"
  | "N6"
  | "N7"
  | "N8"
  | "N9"
  | "N10"
  | "N11"
  | "N12"
  | "N13"
  | "N14"
  | "N15"
  | "N16"
  | "N17"
  | "N18"
  | "N19"
  | "N20";

export type RoadmapTransferableNodeId = Exclude<
  RoadmapCurriculumNodeId,
  "N3" | "N5" | "N6"
>;

export type RoadmapOptionalNodeId = Extract<
  RoadmapCurriculumNodeId,
  "N3" | "N5" | "N6"
>;

export type RoadmapAnchor = "top" | "right" | "bottom" | "left";

export type RoadmapPoint = Readonly<{
  x: number;
  y: number;
}>;

export type RoadmapSemanticPosition = Readonly<{
  /** Stable reading order for a narrow/mobile presentation. */
  mobileOrder: number;
  /** Visual lane only; it has no mastery, unlock, or dependency meaning. */
  lane: "foundation" | "core" | "merge" | "tree" | "final";
  x: number;
  y: number;
}>;

export type RoadmapSemanticEdgeSpec = Readonly<{
  from: RoadmapAnchor;
  fromNodeId: RoadmapTransferableNodeId;
  /** Presentation weight for a real edge, never an additional dependency. */
  importance: "primary" | "supporting";
  lane: "core" | "merge" | "tree";
  to: RoadmapAnchor;
  toNodeId: RoadmapTransferableNodeId;
  /** Fixed orthogonal waypoints that keep the SVG path outside node cards. */
  via?: readonly RoadmapPoint[];
}>;

/**
 * The map is intentionally a fixed desktop composition rather than a
 * force-directed graph. Consumers can scale this canvas responsively, but
 * must preserve these proportions at desktop sizes.
 */
export const ROADMAP_SEMANTIC_CANVAS = {
  height: 1050,
  nodeCardHeight: 124,
  nodeCardWidth: 142,
  width: 1000,
} as const;

/**
 * N3, N5, and N6 are intentionally absent: they belong in the separate
 * Blind Spot Slots panel and must not pollute the transferable route canvas.
 */
export const ROADMAP_SEMANTIC_POSITIONS: Readonly<
  Record<RoadmapTransferableNodeId, RoadmapSemanticPosition>
> = {
  // Fixed visual composition from the Roadmap reference. These coordinates
  // are presentation-only and deliberately do not follow adjacency order.
  N1: { lane: "foundation", mobileOrder: 1, x: 500, y: 84 },
  N7: { lane: "core", mobileOrder: 3, x: 130, y: 242 },
  N8: { lane: "core", mobileOrder: 4, x: 310, y: 242 },
  N10: { lane: "core", mobileOrder: 5, x: 510, y: 242 },
  N11: { lane: "core", mobileOrder: 6, x: 700, y: 242 },
  N9: { lane: "core", mobileOrder: 8, x: 310, y: 410 },
  N18: { lane: "core", mobileOrder: 7, x: 880, y: 410 },
  N2: { lane: "foundation", mobileOrder: 2, x: 80, y: 420 },
  N14: { lane: "core", mobileOrder: 10, x: 670, y: 420 },
  N19: { lane: "merge", mobileOrder: 16, x: 240, y: 599 },
  N20: { lane: "final", mobileOrder: 17, x: 240, y: 777 },
  N4: { lane: "core", mobileOrder: 9, x: 520, y: 588 },
  N12: { lane: "tree", mobileOrder: 11, x: 720, y: 599 },
  N13: { lane: "tree", mobileOrder: 12, x: 570, y: 788 },
  N15: { lane: "tree", mobileOrder: 13, x: 720, y: 788 },
  N16: { lane: "tree", mobileOrder: 14, x: 870, y: 788 },
  N17: { lane: "tree", mobileOrder: 15, x: 720, y: 955 },
};

/** Stable desktop/mobile reading order; this is not the campaign selection order. */
export const ROADMAP_SEMANTIC_DISPLAY_ORDER = [
  "N1",
  "N2",
  "N7",
  "N8",
  "N10",
  "N11",
  "N18",
  "N9",
  "N4",
  "N14",
  "N12",
  "N13",
  "N15",
  "N16",
  "N17",
  "N19",
  "N20",
] as const satisfies readonly RoadmapTransferableNodeId[];

/**
 * Routes for the current real curriculum edges. A renderer should look up a
 * spec by `fromNodeId>toNodeId`; when the backend adds a new real edge, it
 * may use a conservative default route until this visual map is intentionally
 * extended. No edge is inferred from this list.
 */
export const ROADMAP_SEMANTIC_EDGE_SPECS: readonly RoadmapSemanticEdgeSpec[] = [
  // N1 enters one shared branch rail rather than a five-line spider.
  {
    from: "bottom",
    fromNodeId: "N1",
    importance: "primary",
    lane: "core",
    to: "top",
    toNodeId: "N7",
    via: [{ x: 500, y: 170 }, { x: 130, y: 170 }],
  },
  {
    from: "bottom",
    fromNodeId: "N1",
    importance: "primary",
    lane: "core",
    to: "top",
    toNodeId: "N8",
    via: [{ x: 500, y: 170 }, { x: 310, y: 170 }],
  },
  {
    from: "bottom",
    fromNodeId: "N1",
    importance: "primary",
    lane: "core",
    to: "top",
    toNodeId: "N10",
    via: [{ x: 500, y: 170 }, { x: 510, y: 170 }],
  },
  {
    from: "bottom",
    fromNodeId: "N1",
    importance: "supporting",
    lane: "core",
    to: "top",
    toNodeId: "N11",
    via: [{ x: 500, y: 170 }, { x: 700, y: 170 }],
  },
  {
    from: "bottom",
    fromNodeId: "N1",
    importance: "supporting",
    lane: "core",
    to: "top",
    toNodeId: "N18",
    via: [{ x: 500, y: 170 }, { x: 880, y: 170 }, { x: 880, y: 336 }],
  },

  // Hash, two-pointer, stack, and linked-list paths converge where the real curriculum says they do.
  {
    from: "right",
    fromNodeId: "N2",
    importance: "supporting",
    lane: "core",
    to: "left",
    toNodeId: "N9",
    via: [{ x: 195, y: 420 }, { x: 195, y: 410 }],
  },
  {
    from: "bottom",
    fromNodeId: "N2",
    importance: "supporting",
    lane: "core",
    to: "left",
    toNodeId: "N14",
    via: [{ x: 80, y: 492 }, { x: 580, y: 492 }, { x: 580, y: 420 }],
  },
  {
    from: "bottom",
    fromNodeId: "N8",
    importance: "primary",
    lane: "core",
    to: "top",
    toNodeId: "N9",
  },
  {
    from: "top",
    fromNodeId: "N4",
    importance: "supporting",
    lane: "core",
    toNodeId: "N14",
    to: "bottom",
    via: [{ x: 520, y: 510 }, { x: 670, y: 510 }],
  },
  {
    from: "bottom",
    fromNodeId: "N11",
    importance: "supporting",
    lane: "core",
    to: "top",
    toNodeId: "N14",
    via: [{ x: 700, y: 330 }, { x: 670, y: 330 }],
  },

  // Real DP prerequisites enter one quiet convergence rail before N19.
  {
    from: "bottom",
    fromNodeId: "N7",
    importance: "primary",
    lane: "merge",
    to: "top",
    toNodeId: "N19",
    via: [{ x: 130, y: 330 }, { x: 180, y: 330 }, { x: 180, y: 515 }, { x: 240, y: 515 }],
  },
  { from: "bottom", fromNodeId: "N9", importance: "primary", lane: "merge", to: "top", toNodeId: "N19", via: [{ x: 310, y: 515 }, { x: 240, y: 515 }] },
  { from: "bottom", fromNodeId: "N10", importance: "primary", lane: "merge", to: "top", toNodeId: "N19", via: [{ x: 510, y: 515 }, { x: 240, y: 515 }] },
  { from: "bottom", fromNodeId: "N11", importance: "primary", lane: "merge", to: "top", toNodeId: "N19", via: [{ x: 700, y: 330 }, { x: 770, y: 330 }, { x: 770, y: 515 }, { x: 240, y: 515 }] },
  { from: "bottom", fromNodeId: "N18", importance: "primary", lane: "merge", to: "top", toNodeId: "N19", via: [{ x: 880, y: 515 }, { x: 240, y: 515 }] },
  {
    from: "bottom",
    fromNodeId: "N19",
    importance: "primary",
    lane: "merge",
    to: "top",
    toNodeId: "N20",
  },

  // Tree branch: a separate, readable skill tree rather than an incidental crossing.
  {
    from: "bottom",
    fromNodeId: "N12",
    importance: "supporting",
    lane: "tree",
    to: "top",
    toNodeId: "N13",
    via: [{ x: 720, y: 720 }, { x: 570, y: 720 }],
  },
  {
    from: "bottom",
    fromNodeId: "N12",
    importance: "supporting",
    lane: "tree",
    to: "top",
    toNodeId: "N15",
    via: [{ x: 720, y: 720 }],
  },
  {
    from: "bottom",
    fromNodeId: "N12",
    importance: "supporting",
    lane: "tree",
    to: "top",
    toNodeId: "N16",
    via: [{ x: 720, y: 720 }, { x: 870, y: 720 }],
  },
  {
    from: "bottom",
    fromNodeId: "N15",
    importance: "supporting",
    lane: "tree",
    to: "top",
    toNodeId: "N17",
  },
];

export const ROADMAP_SEMANTIC_EDGE_BY_KEY: ReadonlyMap<string, RoadmapSemanticEdgeSpec> = new Map(
  ROADMAP_SEMANTIC_EDGE_SPECS.map((edge) => [`${edge.fromNodeId}>${edge.toNodeId}`, edge] as const),
);
