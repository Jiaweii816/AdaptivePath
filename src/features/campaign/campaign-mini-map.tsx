import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Circle,
  Flag,
  Info,
  LockKeyhole,
  Sparkles,
  Wrench,
} from "lucide-react";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignRoutePreviewView, CampaignTodayView } from "@/server/campaign";
import { campaignDecorativeAssets } from "./campaign-decorative-assets";

type MiniNode = NonNullable<CampaignRoutePreviewView["previousNode"]>;
type RouteStepKind = "previous" | "current" | "next" | "later";

type RouteStep = Readonly<{
  kind: RouteStepKind;
  node: MiniNode;
  label: string;
  index: number;
}>;

type MapPoint = Readonly<{ x: number; y: number }>;

const statusFallbacks: Record<MiniNode["status"], string> = {
  not_included: "Not on main path",
  locked: "Locked",
  available: "Available",
  learning: "In progress",
  mastered_stable: "Mastered",
  mastered_watch: "Mastered · watch",
  mastered_needs_reinforcement: "Recovery needed",
};

function statusForStep(step: RouteStep) {
  return step.kind === "current"
    ? "In progress"
    : step.kind === "previous"
      ? "Mastered"
    : englishSystemText(step.node.statusLabel, statusFallbacks[step.node.status]);
}

function routeTone(step: RouteStep) {
  if (step.kind === "current") return "current";
  if (step.kind === "previous" || step.node.status === "mastered_stable") return "mastered";
  if (step.node.status === "mastered_needs_reinforcement") return "recovery";
  if (step.node.status === "locked") return "locked";
  return "available";
}

function StatusIcon({ tone }: { tone: ReturnType<typeof routeTone> | "recovery" }) {
  const className = "h-3.5 w-3.5";
  if (tone === "mastered") return <Check className={className} aria-hidden="true" />;
  if (tone === "current") return <Flag className={className} aria-hidden="true" />;
  if (tone === "recovery") return <Wrench className={className} aria-hidden="true" />;
  if (tone === "locked") return <LockKeyhole className={className} aria-hidden="true" />;
  return <Circle className={className} aria-hidden="true" />;
}

function nodePositions(steps: readonly RouteStep[]): readonly MapPoint[] {
  if (steps[0]?.kind === "current") {
    if (steps.length === 1) return [{ x: 48, y: 37 }];
    if (steps.length === 2) return [{ x: 39, y: 36 }, { x: 73, y: 39 }];
    return [{ x: 34, y: 36 }, { x: 63, y: 39 }, { x: 87, y: 39 }];
  }
  if (steps.length === 1) return [{ x: 50, y: 39 }];
  if (steps.length === 2) return [{ x: 25, y: 39 }, { x: 62, y: 36 }];
  if (steps.length === 3) return [{ x: 13, y: 39 }, { x: 43, y: 36 }, { x: 75, y: 39 }];
  return [{ x: 10, y: 39 }, { x: 37, y: 36 }, { x: 64, y: 39 }, { x: 87, y: 39 }];
}

function pathBetween(from: MapPoint, to: MapPoint) {
  const startX = from.x + 6.4;
  const startY = from.y + 12;
  const endX = to.x - 6.4;
  const endY = to.y + 12;
  const middle = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${middle - 4} ${startY}, ${middle + 4} ${endY}, ${endX} ${endY}`;
}

function branchPath(from: MapPoint, to: MapPoint) {
  const startX = from.x + 1.5;
  const startY = from.y + 18;
  const endX = to.x;
  const endY = to.y - 8;
  return `M ${startX} ${startY} C ${startX} ${startY + 9}, ${endX} ${endY - 10}, ${endX} ${endY}`;
}

function RouteEdgeLayer({
  positions,
  recovery,
  steps,
}: {
  positions: readonly MapPoint[];
  recovery: CampaignTodayView["repairPool"];
  steps: readonly RouteStep[];
}) {
  const branchPoint: MapPoint = { x: Math.min(69, Math.max(52, (positions[2]?.x ?? positions[1]?.x ?? 61) - 3)), y: 95 };
  return (
    <svg aria-hidden="true" className="campaign-route-preview__edges" preserveAspectRatio="none" viewBox="0 0 100 100">
      <defs>
        <marker id="campaign-route-arrow-complete" markerHeight="5" markerWidth="5" orient="auto" refX="4.3" refY="2.5">
          <path d="M 0 0 L 5 2.5 L 0 5 z" fill="#16836f" />
        </marker>
        <marker id="campaign-route-arrow-future" markerHeight="5" markerWidth="5" orient="auto" refX="4.3" refY="2.5">
          <path d="M 0 0 L 5 2.5 L 0 5 z" fill="#6f9dcc" />
        </marker>
      </defs>
      {steps.slice(0, -1).map((step, index) => {
        const next = steps[index + 1];
        const future = routeTone(next) === "available" || routeTone(next) === "locked";
        const locked = routeTone(next) === "locked";
        return (
          <path
            d={pathBetween(positions[index], positions[index + 1])}
            fill="none"
            key={`${step.index}-${next.index}`}
            markerEnd={`url(#campaign-route-arrow-${future ? "future" : "complete"})`}
            stroke={future ? "#6f9dcc" : "#16836f"}
            strokeDasharray={future || locked ? "1.8 1.8" : undefined}
            strokeLinecap="round"
            strokeWidth={future ? "0.42" : "0.56"}
          />
        );
      })}
      {recovery && steps.length > 1 ? (
        <path
          d={branchPath(positions[1], branchPoint)}
          fill="none"
          stroke="#d88a37"
          strokeDasharray="1.6 1.8"
          strokeLinecap="round"
          strokeWidth="0.42"
        />
      ) : null}
    </svg>
  );
}

function RouteNode({ point, step }: { point: MapPoint; step: RouteStep }) {
  const tone = routeTone(step);
  const style = { left: `${point.x}%`, top: `${point.y}%` } as CSSProperties;
  return (
    <article className={`campaign-route-node campaign-route-node--${tone}`} style={style}>
      <span className="campaign-route-node__marker"><StatusIcon tone={tone} /></span>
      <div className="campaign-route-node__topline">
        <span className="campaign-route-node__number">{step.index + 1}</span>
        {tone === "mastered" ? <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-label="Mastered" /> : null}
      </div>
      <p className="campaign-route-node__title">{englishSystemText(step.node.nodeName, "Learning node")}</p>
      <p className="campaign-route-node__status">{statusForStep(step)}</p>
      {tone === "current" ? <span className="campaign-route-node__pulse" aria-hidden="true" /> : null}
    </article>
  );
}

function RecoveryBranch({ recovery, point }: { recovery: NonNullable<CampaignTodayView["repairPool"]>; point: MapPoint }) {
  const style = { left: `${point.x}%`, top: `${point.y}%` } as CSSProperties;
  return (
    <article className="campaign-route-node campaign-route-node--recovery" style={style}>
      <span className="campaign-route-node__marker"><Wrench className="h-3.5 w-3.5" aria-hidden="true" /></span>
      <p className="campaign-route-node__branch-id">Recovery</p>
      <p className="campaign-route-node__title">{englishSystemText(recovery.highestPriorityNode.nodeName, "Recovery node")}</p>
      <p className="campaign-route-node__status">Recovery needed</p>
    </article>
  );
}

function RouteLegend() {
  const items = [
    ["mastered", "Mastered"],
    ["current", "Current"],
    ["available", "Available"],
    ["recovery", "Recovery"],
    ["locked", "Locked"],
  ] as const;
  return (
    <div className="campaign-route-legend" aria-label="Route status legend">
      {items.map(([tone, label]) => <span className="campaign-route-legend__item" key={tone}><i className={`campaign-route-legend__dot campaign-route-legend__dot--${tone}`} aria-hidden="true" />{label}</span>)}
    </div>
  );
}

export function CampaignMiniMap({
  masteredCount,
  phaseLabel,
  preview,
  repairPool = null,
  totalCount,
}: {
  masteredCount: number;
  phaseLabel: string;
  preview: CampaignRoutePreviewView;
  repairPool?: CampaignTodayView["repairPool"];
  totalCount: number;
}) {
  const steps: RouteStep[] = [
    ...(preview.previousNode ? [{ kind: "previous" as const, node: preview.previousNode, label: "Previous", index: 0 }] : []),
    ...(preview.currentNode ? [{ kind: "current" as const, node: preview.currentNode, label: "Current", index: 1 }] : []),
    ...preview.nextNodes.slice(0, 2).map((node, index) => ({
      kind: index === 0 ? "next" as const : "later" as const,
      node,
      label: index === 0 ? "Next" : "Later",
      index: index + 2,
    })),
  ].map((step, index) => ({ ...step, index }));
  const positions = nodePositions(steps);
  const branchPoint: MapPoint = { x: Math.min(69, Math.max(52, (positions[2]?.x ?? positions[1]?.x ?? 61) - 3)), y: 95 };

  return (
    <section aria-labelledby="mini-map-heading" className="campaign-route-preview">
      <div className="campaign-route-preview__header">
        <div>
          <p className="campaign-eyebrow">Learning Journey</p>
          <h2 className="campaign-section-title" id="mini-map-heading">Route Preview <Info className="campaign-title-info" aria-label="A compact preview of your current learning journey" /></h2>
        </div>
        <RouteLegend />
      </div>
      {steps.length ? (
        <div className="campaign-route-preview__canvas">
          <div aria-hidden="true" className="campaign-route-preview__landscape">
            <Image alt="" className="object-contain object-bottom" fill loading="eager" sizes="(min-width: 1280px) 760px, 100vw" src={campaignDecorativeAssets.roadmapLandscape} unoptimized />
          </div>
          <RouteEdgeLayer positions={positions} recovery={repairPool} steps={steps} />
          <div className="campaign-route-preview__nodes">
            {steps.map((step, index) => <RouteNode key={`${step.kind}-${step.node.nodeName}`} point={positions[index]} step={step} />)}
            {repairPool && steps.length > 1 ? <RecoveryBranch point={branchPoint} recovery={repairPool} /> : null}
          </div>
        </div>
      ) : (
        <div className="campaign-route-preview__empty">
          <Flag className="h-4 w-4" aria-hidden="true" />
          <div><p className="font-semibold">No main-route learning node is active</p><p>During {englishSystemText(phaseLabel, "this phase")}, Today does not select a node in the browser.</p></div>
        </div>
      )}
      <footer className="campaign-route-preview__footer">
        <Link href="/campaign/roadmap">View full roadmap <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        <span>{masteredCount > 0 ? `${masteredCount} mastered · ` : ""}{totalCount} nodes total</span>
      </footer>
    </section>
  );
}
