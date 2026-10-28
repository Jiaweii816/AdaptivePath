import { expect, test } from "@playwright/test";
import { BIOLOGY_QUESTIONS } from "../../src/features/adaptivepath/content";

// Mock only session state: page images are served by the real filesystem-backed route.
test.beforeEach(async ({ page }) => {
  let current = BIOLOGY_QUESTIONS.find(q => q.id === "D1")!;
  const used: string[] = [];
  await page.route(url => url.pathname === "/api/adaptivepath", async route => {
    const payload = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (payload.action === "reference") used.push(current.id);
    if (payload.action === "submit") current = BIOLOGY_QUESTIONS.find(q => q.id === "D2")!;
    if (payload.action === "chat") current = BIOLOGY_QUESTIONS.find(q => q.id === "G1")!;
    await route.fulfill({ json: { sessionId: "00000000-0000-4000-8000-000000000001", attempts: [], messages: [], profile: {}, question: current, completed: false, questionCount: 33, modelReady: false, referenceUsed: used } });
  });
});

test("reference reader locates passages, scales boxes, turns pages and resets for the next question", async ({ page, request }) => {
  await page.goto("/adaptivepath");
  await expect(page.getByTestId("textbook-reader")).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal reference (assisted)" }).click();
  const image = page.getByRole("img", { name: /printed page 316/ });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1224);
  await expect(page.getByTestId("textbook-highlight")).toHaveCount(2);
  const highlight = page.getByTestId("textbook-highlight").first();
  const before = (await highlight.boundingBox())!;
  await page.getByRole("button", { name: "Zoom in textbook" }).click();
  await expect(page.getByRole("button", { name: "Fit textbook to width" })).toHaveText("150%");
  const after = (await highlight.boundingBox())!;
  expect(after.width / before.width).toBeCloseTo(1.5, 1);
  const expectedLeft = await highlight.evaluate(element => parseFloat((element as HTMLElement).style.left));
  expect(expectedLeft).toBeCloseTo(144 / 1224 * 100, 1);
  await page.getByRole("button", { name: "Next textbook page" }).click();
  await expect(page.getByRole("img", { name: /printed page 317/ })).toBeVisible();
  await expect(page.getByTestId("textbook-highlight")).toHaveCount(0);
  await page.getByRole("button", { name: "Locate reference 2 on page 316" }).click();
  await expect(page.getByTestId("textbook-highlight")).toHaveCount(2);
  await page.getByRole("button", { name: "Expand textbook reader" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.getByRole("img").boundingBox())!.width).toBeGreaterThan(700);
  await page.screenshot({ path: "test-results/adaptivepath-textbook-reader-expanded.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Hide reference" }).click();
  await page.getByRole("button", { name: "Show reference" }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  await page.getByRole("radio", { name: "No, they could be RR or Rr" }).check();
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill("Both RR and Rr have the dominant round phenotype.");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByTestId("textbook-reader")).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal reference (assisted)" }).click();
  await expect(page.getByRole("img", { name: /printed page 317/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit textbook to width" })).toHaveText("100%");
  await expect(page.getByTestId("textbook-highlight")).toHaveCount(1);
  const result = await request.get("/api/adaptivepath/textbook/1");
  expect(result.status()).toBe(200);
  expect(result.headers()["content-type"]).toBe("image/png");
  expect((await request.get("/api/adaptivepath/textbook/13")).status()).toBe(404);
  expect((await request.get("/api/adaptivepath/textbook/0")).status()).toBe(404);
});

test("guided practice opens its reference automatically", async ({ page }) => {
  await page.goto("/adaptivepath");
  await page.getByRole("textbox", { name: "Message to tutor" }).fill("Help me practice");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  await expect(page.getByRole("img", { name: /printed page 316/ })).toBeVisible();
  await page.screenshot({ path: "test-results/adaptivepath-textbook-reader-inline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand textbook reader" }).click();
  const bounds = (await page.getByRole("dialog").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
});
