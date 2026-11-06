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
  const feedback = page.getByTestId("submit-feedback");
  await expect(feedback).toContainText(concept);
  await expect(feedback).toContainText("reference used");

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

test("onboarding from whole-book topics seeds a visible profile",async({page})=>{
  await page.goto("/adaptivepath/onboarding");
  await expect(page.getByRole("heading",{name:"Your Biology learning starting point"})).toBeVisible();
  await page.getByText("Genetics",{exact:false}).first().click();
  await page.getByRole("combobox",{name:"Preferred teaching style"}).selectOption("step_by_step");
  const answers=["A","B","C","B","D"];
  for(let i=0;i<5;i++){
    const fieldset=page.locator("fieldset").nth(i);
    await fieldset.getByRole("radio",{name:new RegExp("^"+answers[i]+"\\.")}).check();
  }
  await page.getByRole("button",{name:"Save initial context"}).click();
  await expect(page.getByRole("heading",{name:"Initial learning context saved"})).toBeVisible();
  await page.getByRole("link",{name:"Open learner profile"}).click();
  await expect(page.getByRole("heading",{name:"Initial Learning Background"})).toBeVisible();
  await expect(page.getByText("Teaching preference:")).toBeVisible();
  await expect(page.getByText("not a mastery score")).toBeVisible();
  mkdirSync("test-results",{recursive:true});
  await page.screenshot({path:"test-results/adaptivepath-onboarding-profile.png",fullPage:true});
});
