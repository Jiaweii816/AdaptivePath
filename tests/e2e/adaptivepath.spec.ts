import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("AdaptivePath three columns, profile, and evidence-driven D1 branching", async ({ page }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByRole("heading", { name: "AdaptivePath" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Think, select, and explain" })).toBeVisible();
  await expect(page.getByText("Textbook Reference", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adaptive guidance" })).toBeVisible();
  await expect(page.getByText("Two round-seed plants look the same.", { exact: false })).toBeVisible();

  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/adaptivepath-workspace.png", fullPage: true });

  // Textbook excerpts can be expanded, collapsed and reopened. Access is
  // still recorded as assisted after closing or refreshing the page.
  await page.getByRole("button", { name: "Reveal reference (assisted)" }).click();
  await expect(page.getByText("An organism’s underlying genetic makeup", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Hide reference" }).click();
  await expect(page.getByText("the attempt remains assisted", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show reference" }).click();
  await expect(page.getByText("An organism’s underlying genetic makeup", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Show reference" })).toBeVisible();
  await expect(page.getByText("the attempt remains assisted", { exact: false })).toBeVisible();

  // Incorrect reasoning should trigger the misconception confirmation question.
  await page.getByRole("radio", { name: "Yes, both must be RR" }).check();
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill(
    "Both plants must be RR because the dominant allele makes the recessive allele disappear.",
  );
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("The dominant allele wins", { exact: false })).toBeVisible();

  // Standalone Biology evidence ledger, reusing the original PatternCoach
  // profile layout and presentational components.
  await page.getByRole("link", { name: "Learner Profile" }).click();
  await expect(page).toHaveURL(/\/adaptivepath\/profile$/);
  await expect(page.getByRole("heading", { name: "Dynamic Learner Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validated learner state" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Misconception evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence episodes" })).toBeVisible();
  await expect(page.getByText("Genotype & phenotype", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Stable requires two distinct successful independent transfer", { exact: false })).toBeVisible();
  await expect(page.getByText("Round phenotype always means RR", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/adaptivepath-profile.png", fullPage: true });
  await page.getByText("D1: Two round-seed plants look the same.", { exact: false }).click();
  await expect(page.getByText("Both plants must be RR because the dominant allele", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Back to Biology Workbench" }).click();
  await expect(page).toHaveURL(/\/adaptivepath$/);
  await expect(page.getByText("The dominant allele wins", { exact: false })).toBeVisible();

  // A fresh session with correct reasoning should go to D2, not D4.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("Two round-seed plants look the same.", { exact: false })).toBeVisible();
  await page.getByRole("radio", { name: "No, they could be RR or Rr" }).check();
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill(
    "The two round plants could be RR or Rr. Both have a round phenotype because the dominant R allele is expressed. The recessive r allele can still be inherited.",
  );
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByText("For Rr × rr, list the possible gametes", { exact: false })).toBeVisible();
});
