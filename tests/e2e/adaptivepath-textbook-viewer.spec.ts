import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { BIOLOGY_QUESTIONS } from "../../src/features/adaptivepath/content";

// Mock only session state: PDF.js and the original PDF are served by real routes.
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
  const imageRequests: string[] = [];
  page.on("request", req => { if (/\/api\/adaptivepath\/textbook\/\d+$/.test(req.url())) imageRequests.push(req.url()); });
  await page.goto("/adaptivepath");
  await expect(page.getByTestId("textbook-reader")).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal reference (assisted)" }).click();
  const pdf = page.getByTestId("textbook-pdf-page");
  await expect(pdf).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await pdf.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
  const reader = page.getByTestId("textbook-reader");
  const problem = page.getByRole("region", { name: "Problem Panel" });
  const readerBounds = (await reader.boundingBox())!;
  const panelBounds = (await problem.boundingBox())!;
  expect(readerBounds.x).toBeGreaterThanOrEqual(panelBounds.x);
  expect(readerBounds.x + readerBounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width);
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand textbook reader" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Think, select, and explain" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adaptive guidance" })).toBeVisible();
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
  const result = await request.get("/api/adaptivepath/textbook/document");
  expect(result.status()).toBe(200);
  expect(result.headers()["content-type"]).toBe("application/pdf");
  expect(createHash("sha256").update(await result.body()).digest("hex")).toBe("4beec1826a156c86ab1e45e8dbb015e031991708d125ad78fe80d4519d42dc04");
  expect(imageRequests).toEqual([]);
  expect((await request.get("/api/adaptivepath/textbook/13")).status()).toBe(404);
  expect((await request.get("/api/adaptivepath/textbook/0")).status()).toBe(404);
});

test("guided practice opens its reference automatically", async ({ page }) => {
  await page.goto("/adaptivepath");
  await page.getByRole("textbox", { name: "Message to tutor" }).fill("Help me practice");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  await expect(page.getByRole("img", { name: /printed page 316/ })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({ path: "test-results/adaptivepath-textbook-pdf-inline.png" });
  // Exercise an original figure-heavy PDF page as well as the text references.
  await page.getByRole("combobox", { name: "Textbook page" }).selectOption("7");
  await expect(page.getByTestId("textbook-pdf-page")).toHaveAttribute("data-page", "7");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({ path: "test-results/adaptivepath-textbook-pdf-figures.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("status")).toHaveCount(0);
  const bounds = (await page.getByTestId("textbook-reader").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
