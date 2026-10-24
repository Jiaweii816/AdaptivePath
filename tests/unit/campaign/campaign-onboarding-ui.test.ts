import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CampaignOnboardingForm } from "@/features/campaign/campaign-onboarding-form";
import { CampaignStateCard } from "@/features/campaign/campaign-state-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("Campaign M5A onboarding UI", () => {
  it("turns the empty Campaign state into an onboarding entry", () => {
    const html = renderToStaticMarkup(createElement(CampaignStateCard, { kind: "empty" }));
    expect(html).toContain("No Campaign has been created");
    expect(html).toContain("Create Campaign");
    expect(html).toContain('/campaign/onboarding');
  });

  it("renders labeled direct-question-count fields and no retired planning concepts", () => {
    const html = renderToStaticMarkup(createElement(CampaignOnboardingForm, {
      conflict: false,
      nodes: [{
        nodeId: "N1",
        name: "原地数组与写指针",
        mechanism: "维护读写边界",
        requiredPrerequisites: [],
      }],
    }));
    expect(html).toContain("Preparation end date");
    expect(html).toContain("Daily task budget");
    expect(html).toContain("Python");
    expect(html).toContain("Time zone");
    expect(html).toContain("原地数组与写指针");
    expect(html).toContain("Create Campaign");
    expect(html).not.toContain("Target company");
    expect(html).not.toContain("Hours / week");
    expect(html).not.toContain("General FAANG");
  });
});
