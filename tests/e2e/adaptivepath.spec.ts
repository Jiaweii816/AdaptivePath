import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Runs against the disposable try profile (npm run dev:try). Earlier runs may
// have advanced the learner, so the test reads the current concept instead of
// assuming the first question.
test("practice flow records conditions and updates the profile", async ({ page }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByRole("heading", { name: "Think, select, and explain" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adaptive guidance" })).toBeVisible();
  const concept = (await page.getByTestId("current-concept-name").textContent())!.trim();
  await expect(page.getByTestId("current-difficulty")).toHaveText(/easy|medium|hard/);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/adaptivepath-workspace.png", fullPage: true });

  await page.getByRole("button", { name: "Reveal reference (counts as reference use)" }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Reference used for this question")).toBeVisible();

  await page.getByRole("radio").first().check();
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill(
    "Genes sit on chromosomes and each parent passes one allele to the offspring.",
  );
  await page.getByRole("button", { name: "Submit Answer" }).click();
  // The backend already picked the next item, but the UI must keep the
  // submitted question visible until the learner explicitly advances.
  await expect(page.getByTestId("current-concept-name")).toHaveText(concept);
  await expect(page.getByTestId("submitted-question-notice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Answer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next Question" })).toBeVisible();
  const feedback = page.getByTestId("submit-feedback");
  await expect(feedback).toContainText(concept);
  await expect(feedback).toContainText("reference used");
  await page.getByRole("button", { name: "Next Question" }).click();
  await expect(page.getByTestId("submitted-question-notice")).toHaveCount(0);
  await expect(page.getByTestId("submit-feedback")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit Answer" })).toBeVisible();

  await page.goto("/adaptivepath/profile");
  await expect(page.getByRole("heading", { name: "Learner Profile" })).toBeVisible();
  await expect(page.getByText("Tutor note: pending LLM generation")).toBeVisible();
  const card = page.getByTestId("concept-card").filter({ hasText: concept });
  await card.getByRole("button", { name: "Show ledger" }).click();
  await expect(card.getByTestId("ledger-row").last()).toContainText("reference used");
  await page.screenshot({ path: "test-results/adaptivepath-profile.png", fullPage: true });
});

test("submits with an option and empty reasoning", async ({ page }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByRole("heading", { name: "Think, select, and explain" })).toBeVisible();
  await page.getByRole("radio").first().check();
  await expect(page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)")).toHaveValue("");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByTestId("submit-feedback")).toBeVisible();
});

test("tutor panel no longer mentions mastery level", async ({ page }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByRole("heading", { name: "Adaptive guidance" })).toBeVisible();
  await expect(page.getByText(/mastery level/i)).toHaveCount(0);
});

test("profile shows the local-database notice", async ({ page }) => {
  await page.goto("/adaptivepath/profile");
  await expect(page.getByText("Your learning record is stored only in the local database.")).toBeVisible();
});

test("textbook browser filters by concept and page", async ({ page }) => {
  await page.goto("/adaptivepath/textbook");
  await expect(page.getByRole("heading", { name: "Biology 2e · Section 12.2" })).toBeVisible();
  expect(await page.locator("article").count()).toBeGreaterThan(35);
  await page.getByRole("combobox", { name: "Filter textbook concept" }).selectOption("b2e-12-2-concept-07");
  await expect(page.locator("article").getByText("MN", { exact: false }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Filter textbook concept" }).selectOption("all");
  await page.getByRole("combobox", { name: "Filter printed page" }).selectOption("327");
  await expect(page.locator("article").getByText("Huntington", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/adaptivepath-textbook.png", fullPage: true });
});

test("suggested prompts stack, append into the tutor box and attach the focused reference", async ({ page }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByRole("heading", { name: "Adaptive guidance" })).toBeVisible();
  const pills = page.getByTestId("suggested-prompts").getByRole("button");
  const box = page.getByLabel("Message to tutor");
  await expect(pills.last()).toHaveText("Give me a hint to start");
  const [first, second] = [await pills.nth(0).boundingBox(), await pills.nth(1).boundingBox()];
  expect(second!.y).toBeGreaterThan(first!.y);

  await box.fill("My idea.");
  await pills.last().click();
  await expect(box).toHaveValue("My idea. Give me a hint to start");
  await expect(box).toBeFocused();

  await page.getByRole("radio").first().check();
  await expect(pills.last()).toHaveText("What should I check before I commit?");
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill("Each parent passes one allele.");
  await expect(pills.first()).toHaveText("Check my reasoning");

  await page.getByRole("button", { name: /Reveal reference|Show reference/ }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  const live = await page.getByText("Live tutor configured").isVisible();
  if (!live) {
    await expect(pills).toHaveCount(2);
    return;
  }
  await expect(pills).toHaveCount(3);
  await expect(pills.last()).toHaveText(/^Explain Reference 1 \(p\. \d+\)$/);
  const reference2 = page.getByRole("button", { name: /^Locate reference 2 / });
  if (await reference2.count()) {
    await reference2.click();
    await expect(pills.last()).toHaveText(/^Explain Reference 2 \(p\. \d+\)$/);
    await page.getByRole("button", { name: /^Locate reference 1 / }).click();
  }
  await pills.last().click();
  await expect(page.getByTestId("prompt-attachment")).toContainText("Reference 1 · p.");
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/adaptivepath-suggested-prompts.png", fullPage: true });
  await page.getByRole("button", { name: "Remove attached reference" }).click();
  await expect(page.getByTestId("prompt-attachment")).toHaveCount(0);
});
