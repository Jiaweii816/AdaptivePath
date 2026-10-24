"use client";

import Image from "next/image";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle,
  Flame,
  LockKeyhole,
  MapPinned,
  Minus,
  Play,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignRoadmapNodeView } from "@/server/campaign";
import { campaignDecorativeAssets } from "./campaign-decorative-assets";
import { CampaignNodeDrawer } from "./campaign-node-drawer";
import {
  buildGrowthMapLayout,
  ROADMAP_CANVAS,
  type GrowthMapPosition,
} from "./growth-map-layout";
import {
  ROADMAP_SEMANTIC_EDGE_BY_KEY,
  type RoadmapAnchor,
  type RoadmapSemanticEdgeSpec,
  type RoadmapPoint,
} from "./roadmap-semantic-layout";

type Dependency = Readonly<{ fromNodeId: string; toNodeId: string }>;
type PathMode = "all" | "main";
type EdgeKind = "recommended" | "required";
type Anchor = RoadmapAnchor;

type GraphEdge = Readonly<{
  from: GrowthMapPosition;
  kind: EdgeKind;
  to: GrowthMapPosition;
}>;

type Point = RoadmapPoint;
type Route = Pick<RoadmapSemanticEdgeSpec, "from" | "to" | "via">;

const MAIN_ROUTE_EDGES = new Set([
  "N1>N7",
  "N1>N8",
  "N8>N9",
  "N1>N10",
  "N1>N11",
  "N1>N18",
  "N7>N19",
  "N9>N19",
  "N10>N19",
  "N11>N19",
  "N18>N19",
  "N19>N20",
]);

const CANVAS_SCALE_CEILING = 1;

function edgeKey(fromNodeId: string, toNodeId: string) {
  return `${fromNodeId}>${toNodeId}`;
}

function nodeTone(node: CampaignRoadmapNodeView) {
  if (node.status === "not_included") return "optional" as const;
  if (node.status === "locked" || node.locked) return "locked" as const;
  if (node.current) return "current" as const;
  if (node.status === "mastered_needs_reinforcement" || node.pendingRepairCount > 0) return "recovery" as const;
  if (node.status === "mastered_stable" || node.status === "mastered_watch") return "mastered" as const;
  return "available" as const;
}

function nodeStatusText(node: CampaignRoadmapNodeView) {
  if (node.current) return node.pendingRepairCount > 0 ? "In progress · recovery" : "In progress";
  if (node.status === "locked" || node.locked) return "Locked";
  if (node.status === "not_included") return "Not on main route";
  if (node.status === "mastered_needs_reinforcement" || node.pendingRepairCount > 0) return "Recovery needed";
  if (node.status === "mastered_watch") return "Mastered · watch";
  if (node.status === "mastered_stable") return "Mastered";
  return englishSystemText(node.statusLabel, "Available");
}

function NodeIcon({ node }: { node: CampaignRoadmapNodeView }) {
  const className = "h-3.5 w-3.5";
  const tone = nodeTone(node);
  if (tone === "optional") return <Minus className={className} aria-hidden="true" />;
  if (tone === "locked") return <LockKeyhole className={className} aria-hidden="true" />;
  if (tone === "mastered") return <Check className={className} aria-hidden="true" />;
  if (tone === "recovery") return <Wrench className={className} aria-hidden="true" />;
  if (tone === "current") return <Play className={className} aria-hidden="true" fill="currentColor" />;
  return <Circle className={className} aria-hidden="true" />;
}

function nodeProgress(node: CampaignRoadmapNodeView) {
  if (node.masteryProgressRequired <= 0) return 0;
  return Math.min(100, Math.max(0, (node.masteryProgressCurrent / node.masteryProgressRequired) * 100));
}

function ProgressRing({ color, value }: { color: string; value: number }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  return (
    <svg aria-label={`${Math.round(value)}% mastery progress`} className="campaign-roadmap-node__ring" viewBox="0 0 32 32" role="img">
      <circle cx="16" cy="16" fill="none" r={radius} stroke="currentColor" strokeOpacity="0.12" strokeWidth="2.5" />
      <circle cx="16" cy="16" fill="none" r={radius} stroke={color} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" strokeWidth="2.5" transform="rotate(-90 16 16)" />
    </svg>
  );
}

function anchorPoint(position: GrowthMapPosition, anchor: Anchor): Point {
  const halfWidth = position.node.current ? 78 : ROADMAP_CANVAS.nodeCardWidth / 2;
  const halfHeight = position.node.current ? 71 : ROADMAP_CANVAS.nodeCardHeight / 2;
  if (anchor === "top") return { x: position.x, y: position.y - halfHeight };
  if (anchor === "right") return { x: position.x + halfWidth, y: position.y };
  if (anchor === "bottom") return { x: position.x, y: position.y + halfHeight };
  return { x: position.x - halfWidth, y: position.y };
}

function pathForEdge(edge: GraphEdge) {
  const key = edgeKey(edge.from.node.nodeId, edge.to.node.nodeId);
  const route: Route = ROADMAP_SEMANTIC_EDGE_BY_KEY.get(key) ?? { from: "bottom", to: "top" };
  const points = [anchorPoint(edge.from, route.from), ...(route.via ?? []), anchorPoint(edge.to, route.to)];
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
}

function buildActualDependencies(
  layout: readonly GrowthMapPosition[],
  requiredDependencies: readonly Dependency[],
): readonly GraphEdge[] {
  const byId = new Map(layout.map((position) => [position.node.nodeId, position]));
  const edgeKinds = new Map<string, EdgeKind>();
  const add = (fromNodeId: string, toNodeId: string, kind: EdgeKind) => {
    if (!byId.has(fromNodeId) || !byId.has(toNodeId)) return;
    const key = edgeKey(fromNodeId, toNodeId);
    if (kind === "required" || !edgeKinds.has(key)) edgeKinds.set(key, kind);
  };

  for (const position of layout) {
    for (const prerequisite of position.node.recommendedPrerequisites) add(prerequisite.nodeId, position.node.nodeId, "recommended");
    for (const prerequisite of position.node.requiredPrerequisites) add(prerequisite.nodeId, position.node.nodeId, "required");
  }
  for (const dependency of requiredDependencies) add(dependency.fromNodeId, dependency.toNodeId, "required");

  return [...edgeKinds.entries()].flatMap(([key, kind]) => {
    const [fromNodeId, toNodeId] = key.split(">");
    const from = byId.get(fromNodeId);
    const to = byId.get(toNodeId);
    return from && to ? [{ from, kind, to }] : [];
  });
}

function edgeStyle(edge: GraphEdge) {
  const fromTone = nodeTone(edge.from.node);
  const toTone = nodeTone(edge.to.node);
  const main = MAIN_ROUTE_EDGES.has(edgeKey(edge.from.node.nodeId, edge.to.node.nodeId));
  if (toTone === "locked") {
    return { dash: "7 9", marker: "roadmap-arrow-locked", opacity: 0.55, stroke: "#9aa8b7", width: main ? 2.1 : 1.6 };
  }
  if (fromTone === "mastered" || toTone === "mastered" || edge.to.node.current) {
    return { dash: undefined, marker: "roadmap-arrow-complete", opacity: 0.72, stroke: "#158a75", width: main ? 2.5 : 2 };
  }
  return { dash: "9 8", marker: "roadmap-arrow-future", opacity: edge.kind === "required" ? 0.64 : 0.52, stroke: "#8ba3ba", width: main ? 2.05 : 1.65 };
}

function DecorativeBackground() {
  return (
    <div aria-hidden="true" className="campaign-roadmap-map__landscape">
      <Image alt="" className="object-contain object-bottom" fill loading="eager" sizes="(min-width: 1280px) 1050px, 100vw" src={campaignDecorativeAssets.roadmapLandscape} unoptimized />
    </div>
  );
}

function SvgEdgeLayer({ edges, mode }: { edges: readonly GraphEdge[]; mode: PathMode }) {
  const visibleEdges = mode === "main"
    ? edges.filter((edge) => MAIN_ROUTE_EDGES.has(edgeKey(edge.from.node.nodeId, edge.to.node.nodeId)))
    : edges;
  return (
    <svg aria-hidden="true" className="campaign-roadmap-map__edges" preserveAspectRatio="none" viewBox={`0 0 ${ROADMAP_CANVAS.width} ${ROADMAP_CANVAS.height}`}>
      <defs>
        <marker id="roadmap-arrow-complete" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#158a75" /></marker>
        <marker id="roadmap-arrow-future" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#8ba3ba" /></marker>
        <marker id="roadmap-arrow-locked" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="#9aa8b7" /></marker>
      </defs>
      {visibleEdges.map((edge) => {
        const style = edgeStyle(edge);
        const key = `${edge.kind}-${edgeKey(edge.from.node.nodeId, edge.to.node.nodeId)}`;
        return <path data-edge={edgeKey(edge.from.node.nodeId, edge.to.node.nodeId)} data-edge-kind={edge.kind} d={pathForEdge(edge)} fill="none" key={key} markerEnd={`url(#${style.marker})`} opacity={style.opacity} stroke={style.stroke} strokeDasharray={style.dash} strokeLinecap="round" strokeLinejoin="round" strokeWidth={style.width} />;
      })}
    </svg>
  );
}

function RoadmapNodeLayer({
  layout,
  onHover,
  onOpen,
}: {
  layout: readonly GrowthMapPosition[];
  onHover: (position: GrowthMapPosition | null) => void;
  onOpen: (node: CampaignRoadmapNodeView) => void;
}) {
  return (
    <div className="campaign-roadmap-map__nodes">
      {layout.map((position) => {
        const { node } = position;
        const tone = nodeTone(node);
        const status = nodeStatusText(node);
        const ring = tone === "mastered" ? "#168a75" : tone === "current" ? "#087b70" : tone === "recovery" ? "#e8792d" : tone === "locked" ? "#8c99a6" : "#71a6dc";
        return (
          <div className={`campaign-roadmap-node campaign-roadmap-node--${tone}`} id={`node-${node.nodeId}`} key={node.nodeId} style={{ left: position.x, top: position.y }}>
            <button
              aria-label={`${node.nodeId}, ${englishSystemText(node.nodeName, "Learning node")}, ${status}${node.lockedReason ? `, ${englishSystemText(node.lockedReason, "prerequisites required")}` : ""}`}
              className={`campaign-roadmap-node__card campaign-roadmap-node__card--${tone}`}
              onBlur={() => onHover(null)}
              onClick={() => onOpen(node)}
              onFocus={() => onHover(position)}
              onMouseEnter={() => onHover(position)}
              onMouseLeave={() => onHover(null)}
              type="button"
            >
              <span className="campaign-roadmap-node__marker"><NodeIcon node={node} /></span>
              <span className="campaign-roadmap-node__topline">
                <span className="campaign-roadmap-node__number">{node.nodeId}</span>
                <ProgressRing color={ring} value={nodeProgress(node)} />
              </span>
              <span className="campaign-roadmap-node__title">{englishSystemText(node.nodeName, "Learning node")}</span>
              <span className={`campaign-roadmap-node__status${node.pendingRepairCount > 0 ? " is-recovery" : ""}`}>{status}</span>
              <span className="campaign-roadmap-node__meta"><span>Practice {node.attemptedProblemCount}/{node.totalProblems}</span><span><Flame className="h-3 w-3" aria-hidden="true" />{node.latestPositiveStreak}</span></span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FinalMilestoneDecoration({ position }: { position: GrowthMapPosition | null }) {
  if (!position) return null;
  return (
    <div aria-hidden="true" className="campaign-roadmap-map__finish" style={{ left: position.x, top: position.y + ROADMAP_CANVAS.nodeCardHeight / 2 + 8 }}>
      <Image alt="" className="object-contain" fill sizes="190px" src={campaignDecorativeAssets.finishMountain} unoptimized />
    </div>
  );
}

function RoadmapTooltipLayer({ position }: { position: GrowthMapPosition | null }) {
  if (!position) return null;
  return <div aria-hidden="true" className="campaign-roadmap-map__tooltip" style={{ left: position.x, top: Math.max(13, position.y - ROADMAP_CANVAS.nodeCardHeight / 2 - 37) }}>{position.node.nodeId} · {nodeStatusText(position.node)}</div>;
}

export function RoadmapCanvas({
  nodes,
  requiredDependencies = [],
}: {
  nodes: readonly CampaignRoadmapNodeView[];
  requiredDependencies?: readonly Dependency[];
}) {
  const [selectedNode, setSelectedNode] = useState<CampaignRoadmapNodeView | null>(null);
  const [hoveredPosition, setHoveredPosition] = useState<GrowthMapPosition | null>(null);
  const [pathMode, setPathMode] = useState<PathMode>("all");
  const [canvasScale, setCanvasScale] = useState(CANVAS_SCALE_CEILING);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => buildGrowthMapLayout(nodes), [nodes]);
  const edges = useMemo(() => buildActualDependencies(layout, requiredDependencies), [layout, requiredDependencies]);
  const finalPosition = layout.find((position) => position.node.nodeId === "N20") ?? null;

  // Scale before the first painted client frame. A post-paint effect briefly
  // rendered the fixed 1050px canvas at 1x inside the desktop viewport,
  // allowing the right branch to clip before ResizeObserver corrected it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateScale = () => {
      const available = Math.max(1, scroller.clientWidth - 4);
      setCanvasScale(Math.min(CANVAS_SCALE_CEILING, Math.max(0.56, available / ROADMAP_CANVAS.width)));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  function fitToView() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ left: Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2), top: 0, behavior: "smooth" });
  }

  return (
    <>
      <section aria-label="Interactive Campaign dependency graph" className="campaign-roadmap-map">
        <header className="campaign-roadmap-map__controls">
          <div className="campaign-roadmap-map__segmented" role="group" aria-label="Dependency paths to display">
            <button aria-pressed={pathMode === "all"} className={pathMode === "all" ? "is-active" : ""} onClick={() => setPathMode("all")} type="button">All paths</button>
            <button aria-pressed={pathMode === "main"} className={pathMode === "main" ? "is-active" : ""} onClick={() => setPathMode("main")} type="button">Main route only</button>
          </div>
          <button className="campaign-roadmap-map__fit" onClick={fitToView} type="button"><MapPinned className="h-3.5 w-3.5" aria-hidden="true" />Fit to view</button>
        </header>
        <p className="campaign-roadmap-map__caption">Solid routes are completed or active dependencies. Dashed routes are available or locked future dependencies.</p>
        <div className="campaign-roadmap-map__viewport" ref={scrollerRef}>
          <div className="campaign-roadmap-map__sizer" style={{ height: ROADMAP_CANVAS.height * canvasScale, width: ROADMAP_CANVAS.width * canvasScale }}>
            <div className="campaign-roadmap-map__canvas" data-testid="growth-map" style={{ height: ROADMAP_CANVAS.height, transform: `scale(${canvasScale})`, width: ROADMAP_CANVAS.width }}>
              <DecorativeBackground />
              <FinalMilestoneDecoration position={finalPosition} />
              <SvgEdgeLayer edges={edges} mode={pathMode} />
              <RoadmapNodeLayer layout={layout} onHover={setHoveredPosition} onOpen={setSelectedNode} />
              <RoadmapTooltipLayer position={hoveredPosition} />
            </div>
          </div>
        </div>
      </section>
      <CampaignNodeDrawer node={selectedNode} onOpenChange={(open) => { if (!open) setSelectedNode(null); }} open={Boolean(selectedNode)} />
    </>
  );
}

export function CampaignGrowthMap({
  nodes,
  requiredDependencies,
}: {
  nodes: readonly CampaignRoadmapNodeView[];
  requiredDependencies?: readonly Dependency[];
}) {
  return <RoadmapCanvas nodes={nodes} requiredDependencies={requiredDependencies} />;
}

export function GrowthMapLegend() {
  const items = [
    [Check, "Mastered", "mastered"],
    [Play, "Current", "current"],
    [Circle, "Available", "available"],
    [LockKeyhole, "Locked", "locked"],
    [Wrench, "Recovery", "recovery"],
    [ShieldCheck, "Required gate", "gate"],
  ] as const;
  return (
    <section aria-labelledby="map-legend-heading" className="campaign-roadmap-legend">
      <h2 id="map-legend-heading">Legend</h2>
      {items.map(([Icon, label, tone]) => <span className={`campaign-roadmap-legend__item campaign-roadmap-legend__item--${tone}`} key={label}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</span>)}
    </section>
  );
}
