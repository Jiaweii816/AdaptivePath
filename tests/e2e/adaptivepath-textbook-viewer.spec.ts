import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type RawQuestion = { id: string; question_type: string; difficulty: string; primary_concept_id: string | null; concept_ids: string[];
  objective: string; question: string; options: { id: string; text: string }[]; chunk_ids: string[]; assumptions: string[] };
const QUESTIONS_DIR = join(process.cwd(), "src/features/adaptivepath/data/biology-12-2/questions");

/** Same answer-free shape as toClientQuestion; Playwright's ESM loader cannot import the JSON bank directly. */
function clientQuestion(id: string) {
  const all = ["concepts-01-03.json", "concepts-04-06.json"].flatMap(
    file => JSON.parse(readFileSync(join(QUESTIONS_DIR, file), "utf8")) as RawQuestion[],
  );
  const q = all.find(item => item.id === id)!;
  return { id: q.id, questionType: q.question_type, difficulty: q.difficulty, primaryConceptId: q.primary_concept_id, conceptIds: q.concept_ids,
    objective: q.objective, prompt: q.question, options: q.options, chunkIds: q.chunk_ids, assumptions: q.assumptions };
}

// Two chunks on PDF page 1, then one chunk on PDF page 2.
const FIRST = "b2e-12-2-q-c01-easy-02";
const SECOND = "b2e-12-2-q-c03-easy-01";

// Mock only the practice API: PDF.js and the original PDF are served by real routes.
test.beforeEach(async ({ page }) => {
  let currentId = FIRST;
  const used: string[] = [];
  await page.route(url => url.pathname === "/api/adaptivepath", async route => {
    const payload = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (payload.action === "reference") used.push(currentId);
    const submitted = payload.action === "submit";
    if (submitted) currentId = SECOND;
    const question = clientQuestion(currentId);
    await route.fulfill({ json: {
      question,
      pick: { kind: "question", questionId: question.id, conceptId: question.primaryConceptId, difficulty: question.difficulty, reason: "frontier_concept", exhaustedConceptIds: [] },
      activity: { tutorUsed: false, referenceUsed: used.includes(currentId), messages: [] },
      judgments: [],
      modelReady: false,
      ...(submitted ? { feedback: { correct: true, correctAnswer: "A", explanation: "Because.", changes: [] } } : {}),
    } });
  });
});

test("reference reader locates passages, scales boxes, turns pages and resets for the next question", async ({ page, request }) => {
  const imageRequests: string[] = [];
  page.on("request", req => { if (/\/api\/adaptivepath\/textbook\/\d+$/.test(req.url())) imageRequests.push(req.url()); });
  await page.goto("/adaptivepath");
  await expect(page.getByTestId("textbook-reader")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Textbook Reference Panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show textbook reference (counts as reference use)" }).click();
  const pdf = page.getByTestId("textbook-pdf-page");
  await expect(pdf).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await pdf.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(0);
  const reader = page.getByTestId("textbook-reader");
  const problem = page.getByRole("region", { name: "Textbook Reference Panel" });
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
  await page.getByRole("button", { name: "Hide reference" }).click();
  await expect(page.getByText("Reference used for this question")).toBeVisible();
  await expect(page.getByRole("region", { name: "Textbook Reference Panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show textbook reference" }).click();
  await expect(page.getByTestId("textbook-reader")).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByLabel("Explain your reasoning (Claim · Evidence · Reasoning)").fill("Both RR and Rr have the dominant round phenotype.");
  await page.getByRole("button", { name: "Submit Answer" }).click();
  await expect(page.getByTestId("textbook-reader")).toHaveCount(0);
  await page.getByRole("button", { name: "Show textbook reference (counts as reference use)" }).click();
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

test("reference reader renders figure pages and fits a phone viewport", async ({ page }) => {
  await page.goto("/adaptivepath");
  await page.getByRole("button", { name: "Show textbook reference (counts as reference use)" }).click();
  await expect(page.getByRole("img", { name: /printed page 316/ })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.screenshot({ path: "test-results/adaptivepath-textbook-pdf-inline.png" });
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
