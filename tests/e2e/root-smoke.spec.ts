import { expect, test } from "@playwright/test";

test("root page routes into the PatternCoach product UI", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("PatternCoach AI");
  await expect(page).toHaveURL(/\/campaign\/today$/);
  await expect(page.getByRole("heading", { name: "尚未建立学习战役" })).toBeVisible();
  await expect(page.getByRole("link", { name: "创建学习战役" })).toBeVisible();
});
