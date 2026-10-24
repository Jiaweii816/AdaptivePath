import { describe, expect, it, vi } from "vitest";
import { buildCoachChatSystemPrompt } from "@/server/agents/coach-agent/build-coach-prompt";
import { collectPlannedStrategyTags } from "@/server/agents/coach-agent/chat-reply";
import type { CoachChatInput } from "@/server/agents/coach-agent/coach-agent.types";
import type { CoachMemoryAssembly } from "@/server/memory";
import type { MemoryCandidate } from "@/server/memory/retrieval/candidate-core.types";
import {
  buildSessionPlan,
  ensureSessionPlan,
} from "@/server/memory/working/build-session-plan";
import { sessionPlanSchema } from "@/server/memory/memory.types";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

describe("buildSessionPlan", () => {
  it("stores at most two selected cues with their earned/self-reported basis", () => {
    const plan = buildSessionPlan(memoryAssembly(), new Date("2026-07-16T12:00:00Z"));

    expect(sessionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.focusCues).toEqual([
      {
        candidateRef: "earned-candidate",
        cue: "Kept the possible answer when tightening a lower-bound interval.",
        sourceLabel: "Search Insert review",
        learnerSignalBasis: "earned_evidence",
      },
      {
        candidateRef: "profile-candidate",
        cue: "The learner described array traversal as a strength.",
        sourceLabel: "Onboarding profile",
        learnerSignalBasis: "self_reported",
      },
    ]);
    expect(plan.openingMove.text).toContain(
      "Kept the possible answer when tightening a lower-bound interval.",
    );
    expect(plan.strategies).toEqual([
      {
        tag: expect.stringMatching(/^strategy_[a-f0-9]{12}$/),
        text: "Ask for the loop invariant before suggesting a code change.",
        status: "validated",
        candidateRef: "strategy-candidate",
      },
    ]);
  });
});

describe("ensureSessionPlan", () => {
  it("persists once and reuses a plan with the same candidate fingerprint", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const prisma = { chatSession: { update } } as unknown as Parameters<
      typeof ensureSessionPlan
    >[0];
    const assembly = memoryAssembly();
    const first = await ensureSessionPlan(prisma, {
      chatSession: { id: "session-1", sessionPlanJson: null },
      memoryAssembly: assembly,
    });

    expect(update).toHaveBeenCalledTimes(1);
    const reused = await ensureSessionPlan(prisma, {
      chatSession: {
        id: "session-1",
        sessionPlanJson: JSON.stringify(first),
      },
      memoryAssembly: assembly,
    });

    expect(reused).toEqual(first);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("session plan prompt boundary", () => {
  it("does not dump candidate refs or strategy tags into the Coach prompt", () => {
    const assembly = memoryAssembly();
    const plan = buildSessionPlan(assembly);
    const prompt = buildCoachChatSystemPrompt(
      chatPromptInput({ memory: assembly.brief, sessionPlan: plan }),
    );

    expect(prompt).toContain("[COACH MEMORY BRIEF");
    expect(prompt).toContain(
      "Kept the possible answer when tightening a lower-bound interval.",
    );
    expect(prompt).toContain("basis: earned_evidence");
    expect(prompt).toContain("basis: self_reported");
    expect(prompt).not.toContain("earned-candidate");
    expect(prompt).not.toContain("profile-candidate");
    expect(prompt).not.toContain("strategy-candidate");
    expect(prompt).not.toContain(plan.strategies[0]!.tag);
  });

  it("collectPlannedStrategyTags unions observed and planned strategies, deduped", () => {
    const plan = buildSessionPlan(memoryAssembly());
    const plannedTag = plan.strategies[0]!.tag;

    expect(
      collectPlannedStrategyTags({
        teachingStrategies: [{ tag: plannedTag }],
        sessionPlan: plan,
      }),
    ).toEqual([plannedTag]);
    expect(
      collectPlannedStrategyTags({
        teachingStrategies: [{ tag: "counterexample_first" }],
        sessionPlan: plan,
      }),
    ).toEqual(["counterexample_first", plannedTag]);
  });
});

function memoryAssembly(): CoachMemoryAssembly {
  const strategy = "Ask for the loop invariant before suggesting a code change.";
  return {
    queryPlan: {} as CoachMemoryAssembly["queryPlan"],
    candidates: [
      {
        id: "strategy-candidate",
        role: "learning_preference",
        teachingText: strategy,
      } as MemoryCandidate,
    ],
    candidateFingerprint: "fingerprint-20260716",
    brief: coachMemoryBrief({
      teachableMemories: [
        teachableMemory({
          cue: "Kept the possible answer when tightening a lower-bound interval.",
          sourceLabel: "Search Insert review",
          learnerSignalBasis: "earned_evidence",
        }),
        teachableMemory({
          cue: "The learner described array traversal as a strength.",
          sourceLabel: "Onboarding profile",
          learnerSignalBasis: "self_reported",
          evidenceRefs: [],
        }),
      ],
      teachingStrategy: strategy,
    }),
    decisions: [
      { candidateId: "earned-candidate", selected: true, reason: "relevant" },
      { candidateId: "profile-candidate", selected: true, reason: "relevant" },
      { candidateId: "unused-candidate", selected: false, reason: "not selected" },
    ],
  };
}

function chatPromptInput(overrides: Partial<CoachChatInput> = {}): CoachChatInput {
  return {
    problem: {
      slug: "search-insert-position",
      title: "Search Insert Position",
      leetcodeNumber: 35,
      tags: ["array", "binary-search"],
      methodName: "searchInsert",
    },
    user: {
      displayName: "try",
      strongPatterns: [],
      weakPatterns: [],
      outputPreferences: [],
    },
    memory: coachMemoryBrief(),
    messages: [{ role: "user", content: "给我一点提示，不要完整代码。" }],
    responseLanguage: "zh",
    ...overrides,
  };
}
