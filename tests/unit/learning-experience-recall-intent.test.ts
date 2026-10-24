import { afterEach, describe, expect, it } from "vitest";
import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { deriveToolEligibilityV2 } from "@/server/agents/coach-agent/turn-understanding-v2/tool-eligibility-v2";
import { isLearningExperienceRecallPilotEnabled } from "@/server/memory/learning-experience-recall/pilot-mode";

const ORIGINAL_PILOT = process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;

afterEach(() => {
  if (ORIGINAL_PILOT === undefined) {
    delete process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT;
  } else {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = ORIGINAL_PILOT;
  }
});

describe("learning-experience recall Pilot intent gate", () => {
  it("defaults on in every runtime and stays explicitly reversible", () => {
    expect(
      isLearningExperienceRecallPilotEnabled({ NODE_ENV: "test" }),
    ).toBe(true);
    expect(
      isLearningExperienceRecallPilotEnabled({ NODE_ENV: "production" }),
    ).toBe(true);
    expect(
      isLearningExperienceRecallPilotEnabled({
        NODE_ENV: "production",
        COACH_LEARNING_EXPERIENCE_RECALL_PILOT: "0",
      }),
    ).toBe(false);
  });

  it("exposes recall only when a Basis asks for history", () => {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "1";
    const concept = compileTurnUnderstandingV2(
      "Why does this binary-search boundary work?",
      {
        workspace: { hasCurrentCode: true, hasAssistantCandidate: false },
      },
    );
    expect(deriveToolEligibilityV2(concept)).not.toContain(
      "recall_learning_experience",
    );

    const explicitHistory = compileTurnUnderstandingV2(
      "我以前是不是也犯过这种二分边界错误？",
      { workspace: { hasCurrentCode: false, hasAssistantCandidate: false } },
    );
    expect(deriveToolEligibilityV2(explicitHistory)).toContain(
      "recall_learning_experience",
    );
  });

  it("coexists with explicit history tools", () => {
    process.env.COACH_LEARNING_EXPERIENCE_RECALL_PILOT = "1";
    const explicitHistory = compileTurnUnderstandingV2(
      "我以前是不是也犯过这种二分边界错误？",
      { workspace: { hasCurrentCode: true, hasAssistantCandidate: false } },
    );
    const tools = deriveToolEligibilityV2(explicitHistory);

    expect(tools).toContain("past_mistake_recall");
    expect(tools).toContain("recall_learning_experience");
  });

  it("closes every history tool when the learner denies history lookup", () => {
    const understanding = compileTurnUnderstandingV2(
      "不要查我以前犯过的错，直接解释当前边界",
      { workspace: { hasCurrentCode: true, hasAssistantCandidate: false } },
    );

    const tools = deriveToolEligibilityV2(understanding);
    expect(tools).not.toContain("past_mistake_recall");
    expect(tools).not.toContain("recall_learning_experience");
  });
});
