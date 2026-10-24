import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CampaignStrategistPanel } from "@/features/campaign/campaign-strategist-panel";
import type { CampaignPlanningReviewView, CampaignStrategistProductView } from "@/server/campaign";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const planning: CampaignPlanningReviewView = {
  status: "pending_review",
  pendingPatch: {
    patchId: "internal-patch-id",
    status: "pending",
    triggerLabel: "User route adjustment",
    rationale: "Prioritize one-dimensional DP and use exposure for two-dimensional DP within the three-day horizon.",
    createdAt: "2026-08-06T12:00:00.000Z",
    baseVersion: 1,
    activeVersion: 1,
    isStale: false,
    operations: [
      {
        operationId: "op-001",
        operationType: "set_node_priority",
        title: "Route priority",
        readableDescription: "Raise the route priority for “One-dimensional DP”.",
        affectedNodeIds: ["N19"],
        beforeValue: "72",
        afterValue: "100",
        warnings: [],
        selectable: true,
        selectedByDefault: true,
      },
      {
        operationId: "op-002",
        operationType: "move_node",
        title: "Route order",
        readableDescription: "Move “One-dimensional DP” before “Sorting scan and greedy decisions”.",
        affectedNodeIds: ["N19", "N7"],
        beforeValue: "Position 19",
        afterValue: "Before Sorting scan and greedy decisions",
        warnings: [],
        selectable: true,
        selectedByDefault: true,
      },
      {
        operationId: "op-003",
        operationType: "set_goal_depth",
        title: "Target depth",
        readableDescription: "Change the target depth for “Two-dimensional DP” to Exposure.",
        affectedNodeIds: ["N20"],
        beforeValue: "Mastery",
        afterValue: "Exposure",
        warnings: [],
        selectable: true,
        selectedByDefault: true,
      },
    ],
    warnings: [],
    impactSummary: { affectedNodeCount: 2, changesMixedWindowDays: false, currentDailyTaskUnaffected: true },
    dailyBudgetSuggestion: null,
    dateBudgetSuggestions: [{
      campaignDate: "2026-08-07",
      currentBudget: 5,
      maxQuestions: 3,
      rationale: "Respect the explicit three-question cap.",
      expiresAt: null,
      stale: false,
    }],
    externalDataAsOf: null,
    externalDataValidUntil: null,
    externalDataStale: false,
    rejectedCandidateReasons: [],
    canAccept: true,
    canPartiallyAccept: true,
    canReject: true,
  },
};

function branch(branchName: "optimistic" | "observed_supported" | "conservative", reachability: "reachable" | "partially_reachable" | "unreachable") {
  return {
    branch: branchName,
    violations: branchName === "conservative" ? ["Not enough eligible problems are available"] : [],
    unknowns: branchName === "observed_supported" ? ["Recent evidence is insufficient"] : [],
    projectedDates: ["2026-08-07", "2026-08-08"],
    earliestReachable: [{ nodeName: "One-dimensional DP", earliestEligibleDate: "2026-08-07", firstSelectedDate: branchName === "conservative" ? null : "2026-08-07" }],
    dayProjections: [{
      campaignDate: "2026-08-07",
      budget: 3,
      phase: "learning",
      selectedNodeNames: ["One-dimensional DP"],
      risks: branchName === "conservative" ? ["Not enough eligible problems are available"] : [],
      unknowns: branchName === "observed_supported" ? ["Recent evidence is insufficient"] : [],
    }],
    horizonReachability: reachability,
  } as const;
}

const strategist: CampaignStrategistProductView = {
  status: "ready",
  routeRisk: { level: "attention", label: "Future route needs attention", detail: "A route proposal is awaiting review." },
  calendarConfigured: false,
  latestRun: {
    runId: "internal-run-id",
    runMode: "proposal",
    status: "waiting_approval",
    statusLabel: "Proposal awaiting review",
    resultKind: "proposal_pending",
    requestSummary: "Prioritize N19 and use exposure for N20 if mastery is not reachable.",
    publicSummary: "A bounded route proposal is ready.",
    progress: [
      { key: "context", label: "Read route and recent evidence", state: "complete" },
      { key: "brief", label: "Build planning objective", state: "complete" },
      { key: "simulation", label: "Simulate candidates", state: "complete" },
      { key: "revision", label: "Revision not needed", state: "not_needed" },
      { key: "clarification", label: "Clarification not needed", state: "not_needed" },
      { key: "proposal", label: "Proposal created for review", state: "complete" },
    ],
    clarification: null,
    candidates: [{
      candidateId: "internal-candidate-id",
      summary: "Prioritize one-dimensional DP and use the requested depth fallback.",
      accepted: true,
      patchLegal: true,
      nodeChanges: ["One-dimensional DP: priority set to 100", "One-dimensional DP: learning order changed"],
      goalDepthChanges: [{ nodeName: "Two-dimensional DP", goalDepth: "exposure" }],
      targetByDateChanges: [],
      dateBudgetSuggestions: [{ campaignDate: "2026-08-07", maxQuestions: 3, rationale: "Respect the explicit cap." }],
      branches: [
        branch("optimistic", "reachable"),
        branch("observed_supported", "partially_reachable"),
        branch("conservative", "unreachable"),
      ],
    }],
    rejectedCandidates: [],
    selectedCandidateId: "internal-candidate-id",
    externalDataAsOf: null,
    externalDataValidUntil: null,
    externalDataStale: false,
    errorCode: null,
    errorMessage: null,
    todayUnaffected: true,
  },
};

describe("M4D3 Strategist proposal review UI", () => {
  it("renders the pending proposal, true diffs, approval controls, and structured simulation paths", () => {
    const html = renderToStaticMarkup(
      <CampaignStrategistPanel
        campaignDate="2026-08-06"
        initialStrategist={strategist}
        onPatchDecision={vi.fn()}
        planning={planning}
      />,
    );

    expect(html).toContain("Your proposal is ready for a decision");
    expect(html).toContain("Your planning request");
    expect(html).not.toContain("Prioritize N19 and use exposure for N20 if mastery is not reachable.");
    expect(html).toContain("Reuse previous request");
    expect(html).toContain("Review proposal");
    expect(html).not.toContain("Generate proposal");
    expect(html).not.toContain("Try again");
    expect(html).toContain("Approval status");
    expect(html).toContain("Awaiting review");
    expect(html).toContain("Patch legality");
    expect(html).toContain("Valid");
    expect(html).toContain("Before:");
    expect(html).toContain("After:");
    expect(html).toContain("One-dimensional DP");
    expect(html).toContain("Two-dimensional DP");
    expect(html).toContain("Current/default: 5");
    expect(html).toContain("Suggested: 3");
    expect(html).toContain("Pending suggestion — not applied");
    expect(html).toContain("Today&#x27;s materialized DailyTask is unchanged.");
    expect(html).toContain("Accept all");
    expect(html).toContain("Review individually / Partial accept");
    expect(html).toContain("Reject");
    expect(html).toContain("Optimistic path");
    expect(html).toContain("Recent-evidence path");
    expect(html).toContain("Conservative path");
    expect(html).toContain("Partially reached");
    expect(html).toContain("Earliest reachable");
    expect(html).toContain("Constraint / dependency risks");
    expect(html).toContain("Supply / cooldown issues");
    expect(html).toContain("Unknowns");
    expect(html).toContain("lg:grid-cols-3");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Revision not needed");
    expect(html).toContain("Clarification not needed");
    expect(html).not.toContain("internal-patch-id");
    expect(html).not.toContain("internal-run-id");
    expect(html).not.toContain("internal-candidate-id");
  });
});
