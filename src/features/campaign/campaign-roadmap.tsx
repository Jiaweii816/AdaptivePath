import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  Compass,
  Flag,
  Flame,
  Info,
  MapPinned,
  Play,
  ShieldCheck,
  Trophy,
  Wrench,
} from "lucide-react";
import { englishSystemText } from "@/lib/system-copy";
import type { CampaignRoadmapNodeView, CampaignRoadmapState, CampaignRoadmapView } from "@/server/campaign";
import { campaignDecorativeAssets } from "./campaign-decorative-assets";
import { CampaignGrowthMap, GrowthMapLegend } from "./campaign-growth-map";
import { CampaignStateCard } from "./campaign-state-card";
import { ROADMAP_SEMANTIC_DISPLAY_ORDER } from "./roadmap-semantic-layout";

const roadmapRank = new Map<string, number>(ROADMAP_SEMANTIC_DISPLAY_ORDER.map((nodeId, index) => [nodeId, index]));

export function CampaignRoadmap({ view }: { view: CampaignRoadmapState }) {
  if (view.kind !== "campaign") return <CampaignStateCard kind={view.kind} />;
  const currentNode = view.nodes.find((node) => node.current) ?? null;
  const pendingRepairCount = view.nodes.reduce((sum, node) => sum + node.pendingRepairCount, 0);
  return (
    <main className="campaign-page campaign-roadmap-page">
      <div className="campaign-content-frame campaign-roadmap-frame">
        <RoadmapHeader currentNode={currentNode} pendingRepairCount={pendingRepairCount} view={view} />
        <div className="campaign-roadmap-layout">
          <CampaignSummary currentNode={currentNode} pendingRepairCount={pendingRepairCount} view={view} />
          <section aria-labelledby="route-heading" className="campaign-roadmap-main">
            <h2 className="sr-only" id="route-heading">Route progression</h2>
            <CampaignGrowthMap nodes={view.nodes} requiredDependencies={view.requiredDependencies} />
            <GrowthMapLegend />
            <BlindSpotSlots pools={view.nonTransferablePool} />
          </section>
          <CurrentNodeInspector currentNode={currentNode} nodes={view.nodes} />
        </div>
      </div>
    </main>
  );
}

function RoadmapHeader({
  currentNode,
  pendingRepairCount,
  view,
}: {
  currentNode: CampaignRoadmapNodeView | null;
  pendingRepairCount: number;
  view: CampaignRoadmapView;
}) {
  return (
    <header className="campaign-roadmap-header">
      <Link className="campaign-roadmap-header__back" href="/campaign/today"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Campaign Today</Link>
      <div className="campaign-roadmap-header__content">
        <div className="campaign-roadmap-header__identity">
          <p className="campaign-eyebrow"><span className="campaign-eyebrow__seal"><Compass className="h-3 w-3" aria-hidden="true" /></span>{englishSystemText(view.campaignLabel, "Hot-150 Campaign")}</p>
          <h1 className="campaign-display">Campaign Roadmap</h1>
          <p>Advance through {view.totalTransferableCount} transferable learning nodes. Master fundamentals, unlock advanced concepts.</p>
        </div>
        <div className="campaign-roadmap-header__metrics" aria-label="Campaign roadmap status">
          <RoadmapMetric icon={ShieldCheck} label="Phase" tone="mint" value={englishSystemText(view.phaseLabel, "Coverage")} />
          <RoadmapMetric icon={Trophy} label="Mastered" tone="gold" value={`${view.masteredTransferableCount} / ${view.totalTransferableCount}`} />
          <RoadmapMetric icon={CalendarDays} label="Days left" tone="mint" value={String(Math.max(0, view.remainingDays))} />
          <RoadmapMetric icon={Wrench} label="Recovery" tone="orange" value={String(pendingRepairCount)} />
        </div>
      </div>
      {currentNode ? <span className="sr-only">Current roadmap node: {currentNode.nodeId}</span> : null}
    </header>
  );
}

function RoadmapMetric({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  tone: "mint" | "gold" | "orange";
  value: string;
}) {
  return <div className={`campaign-stat-chip campaign-stat-chip--${tone}`}><span className="campaign-stat-chip__icon"><Icon className="h-4 w-4" aria-hidden="true" /></span><span><span className="campaign-stat-chip__label">{label}</span><strong>{value}</strong></span></div>;
}

function CampaignSummary({
  currentNode,
  pendingRepairCount,
  view,
}: {
  currentNode: CampaignRoadmapNodeView | null;
  pendingRepairCount: number;
  view: CampaignRoadmapView;
}) {
  const streak = currentNode?.latestPositiveStreak ?? 0;
  const masteryRatio = view.totalTransferableCount > 0 ? (view.masteredTransferableCount / view.totalTransferableCount) * 100 : 0;
  return (
    <aside aria-labelledby="campaign-summary-heading" className="campaign-roadmap-summary">
      <header><h2 id="campaign-summary-heading"><Compass className="h-3.5 w-3.5" aria-hidden="true" />Campaign summary</h2></header>
      <dl className="campaign-roadmap-summary__facts">
        <SummaryRow icon={Flag} label="Campaign phase" value={englishSystemText(view.phaseLabel, "In progress")} />
        <SummaryRow icon={CalendarDays} label="Days remaining" value={`${Math.max(0, view.remainingDays)} days`} />
        <SummaryRow icon={Trophy} label="Mastered nodes" value={`${view.masteredTransferableCount} / ${view.totalTransferableCount}`} />
        <SummaryRow icon={Flag} label="Current node" value={currentNode ? `${currentNode.nodeId} · ${englishSystemText(currentNode.nodeName, "Learning node")}` : "No active node"} />
        <SummaryRow icon={Wrench} label="Recovery needed" tone={pendingRepairCount > 0 ? "amber" : undefined} value={`${pendingRepairCount} nodes`} />
        <SummaryRow icon={CalendarDays} label="End date" value={view.endDate} />
      </dl>
      <div className="campaign-roadmap-summary__streak">
        <MasteryRing percent={Math.max(masteryRatio, streak > 0 ? 25 : 0)} value={streak} />
        <div><strong><Flame className="h-3.5 w-3.5" aria-hidden="true" />Positive streak</strong><p>{streak} recent positive settlements</p></div>
      </div>
      <p className="campaign-roadmap-summary__encouragement"><strong>Keep the momentum going!</strong>Small, evidence-backed steps compound into mastery.</p>
    </aside>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  tone?: "amber";
  value: string;
}) {
  return <div><Icon className={tone === "amber" ? "text-[#df761d]" : "text-[#087b70]"} aria-hidden="true" /><dt>{label}</dt><dd className={tone === "amber" ? "is-amber" : ""}>{value}</dd></div>;
}

function MasteryRing({ percent, value }: { percent: number; value: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  return (
    <div className="campaign-roadmap-summary__ring">
      <svg aria-hidden="true" viewBox="0 0 82 82"><circle cx="41" cy="41" fill="none" r={radius} stroke="#d8e3e0" strokeDasharray="4 4" strokeWidth="4" /><circle cx="41" cy="41" fill="none" r={radius} stroke="#63aea3" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" strokeWidth="4" /></svg>
      <span><Flame className="h-4 w-4" aria-hidden="true" /><strong>{value}</strong><small>day streak</small></span>
    </div>
  );
}

function CurrentNodeInspector({
  currentNode,
  nodes,
}: {
  currentNode: CampaignRoadmapNodeView | null;
  nodes: readonly CampaignRoadmapNodeView[];
}) {
  const upNext = findUpNext(currentNode, nodes);
  return (
    <aside aria-labelledby="current-node-heading" className="campaign-roadmap-inspector">
      <header>
        <p className="campaign-eyebrow"><span>{currentNode?.nodeId ?? "—"}</span>Current node</p>
        <h2 id="current-node-heading">{englishSystemText(currentNode?.nodeName, "No main route node is active")}</h2>
        <p className={currentNode?.pendingRepairCount ? "is-recovery" : "is-current"}>{currentNode ? currentNode.pendingRepairCount > 0 ? "In progress · recovery needed" : "In progress" : "Route status unavailable"}</p>
        {currentNode ? <p className="campaign-roadmap-inspector__invariant">{englishSystemText(currentNode.coreInvariant, "This node builds a transferable interview skill.")}</p> : null}
      </header>
      {currentNode ? <>
        <dl className="campaign-roadmap-inspector__metrics">
          <InspectorMetric label="Solved" value={`${currentNode.completedProblems}/${currentNode.totalProblems}`} />
          <InspectorMetric label="Progress" value={`${currentNode.masteryProgressCurrent}/${currentNode.masteryProgressRequired}`} />
          <InspectorMetric label="Streak" value={String(currentNode.latestPositiveStreak)} />
        </dl>
        <dl className="campaign-roadmap-inspector__status">
          <InspectorStatus label="Overall" tone={currentNode.pendingRepairCount > 0 ? "amber" : "teal"} value={currentNode.status === "mastered_stable" ? "Mastered" : currentNode.pendingRepairCount > 0 ? "Recovery" : "In progress"} />
          <InspectorStatus label="Next review" value={currentNode.pendingRepairCount > 0 ? "Recovery queue" : "When scheduled"} />
          <InspectorStatus label="Recovery" tone={currentNode.pendingRepairCount > 0 ? "amber" : undefined} value={`${currentNode.pendingRepairCount} items`} />
        </dl>
      </> : null}
      <section aria-labelledby="up-next-heading" className="campaign-roadmap-inspector__next"><h3 id="up-next-heading">Up next</h3><div>{upNext.map((node) => <a href={`#node-${node.nodeId}`} key={node.nodeId}><span><b>{node.nodeId}</b>{englishSystemText(node.nodeName, "Learning node")}</span><small>{nodeStatus(node)}</small></a>)}</div></section>
      <footer>
        <Link href="/campaign/today"><Play className="h-3.5 w-3.5" aria-hidden="true" fill="currentColor" />Continue learning</Link>
        {currentNode ? <a href={`#node-${currentNode.nodeId}`}><MapPinned className="h-3.5 w-3.5" aria-hidden="true" />Locate node</a> : null}
      </footer>
    </aside>
  );
}

function findUpNext(currentNode: CampaignRoadmapNodeView | null, nodes: readonly CampaignRoadmapNodeView[]) {
  if (!currentNode) return [...nodes].sort(byRoadmapRank).slice(0, 3);
  const direct = nodes.filter((node) => [
    ...node.recommendedPrerequisites.map((prerequisite) => prerequisite.nodeId),
    ...node.requiredPrerequisites.map((prerequisite) => prerequisite.nodeId),
  ].includes(currentNode.nodeId));
  const remaining = [...nodes].sort(byRoadmapRank).filter((node) => node.nodeId !== currentNode.nodeId && !direct.some((candidate) => candidate.nodeId === node.nodeId));
  return [...direct.sort(byRoadmapRank), ...remaining].slice(0, 3);
}

function byRoadmapRank(a: CampaignRoadmapNodeView, b: CampaignRoadmapNodeView) {
  return (roadmapRank.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (roadmapRank.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER);
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function InspectorStatus({ label, tone, value }: { label: string; tone?: "teal" | "amber"; value: string }) {
  return <div><dt>{label}</dt><dd className={tone ? `is-${tone}` : ""}>{value}</dd></div>;
}

function nodeStatus(node: CampaignRoadmapNodeView) {
  if (node.current) return "In progress";
  if (node.pendingRepairCount > 0) return "Recovery needed";
  if (node.locked) return "Locked";
  return englishSystemText(node.statusLabel, "Available");
}

function BlindSpotSlots({ pools }: { pools: CampaignRoadmapView["nonTransferablePool"] }) {
  return (
    <section aria-labelledby="blind-spot-heading" className="campaign-roadmap-blindspots">
      <div className="campaign-roadmap-blindspots__content">
        <div className="campaign-roadmap-blindspots__heading"><h2 id="blind-spot-heading">Blind Spot Slots (Optional)</h2><span aria-label="Optional topics do not advance main-route mastery"><Info className="h-3 w-3" aria-hidden="true" /></span></div>
        <div className="campaign-roadmap-blindspots__body">
          <div className="campaign-roadmap-blindspots__slots">
            {pools.map((pool) => <article key={pool.nodeId}><div><b>{pool.nodeId}</b><span>NT</span></div><h3>{englishSystemText(pool.nodeName, "Optional topic")}</h3><p>Attempted {pool.attemptedProblemCount}/{pool.problemCount} · Optional</p></article>)}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="campaign-roadmap-blindspots__compass"><Image alt="" className="object-contain" fill loading="eager" sizes="190px" src={campaignDecorativeAssets.roadmapCompass} unoptimized /></div>
    </section>
  );
}
