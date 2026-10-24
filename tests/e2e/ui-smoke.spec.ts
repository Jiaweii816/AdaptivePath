import { expect, test } from "@playwright/test";

test("ui smoke route renders shared component examples", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/ui-smoke");

  await expect(page.getByRole("heading", { name: "UI Smoke" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review My Code" })).toBeVisible();
  await expect(page.getByLabel("Problem")).toHaveValue("Search Insert Position");
  await expect(page.getByRole("tab", { name: "Run" })).toBeVisible();
  await expect(page.getByText("passed_visible_tests")).toBeVisible();

  await page.getByRole("button", { name: "Iris904" }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open Dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
