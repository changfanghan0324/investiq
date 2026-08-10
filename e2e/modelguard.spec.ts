import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home communicates the local-only ModelGuard workflow", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await expect(page).toHaveTitle(/ModelGuard/);
  await expect(page.getByRole("heading", { name: "Check a financial model before someone else does." })).toBeVisible();
  await expect(page.getByText("Processed locally. Not uploaded. No AI. No financial-data API.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a model" })).toHaveAttribute("href", "/workspace");
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("workspace accepts a sample workbook without network calls", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Model audit workspace" })).toBeVisible();
  await expect(page.getByText("XLSX only")).toBeVisible();
  await page.locator("#workbook-file").setInputFiles("public/samples/modelguard-error-model.xlsx");
  await expect(page.getByRole("heading", { name: "Issue explorer" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("FORMULA_MISSING_CELL")).toBeVisible();
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("active routes are bilingual, keyboard reachable, and axe-clean", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop accessibility contract");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.getByRole("heading", { name: "在别人检查之前，先检查你的财务模型。" })).toBeVisible();
  await page.getByLabel(/Text size|字体大小/).selectOption("100");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-font-scale").trim())).toBe("1.45");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("retired InvestIQ URLs redirect to the local ModelGuard surfaces", async ({ page }) => {
  await page.goto("/market");
  await expect(page).toHaveURL(/\/workspace/);
  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/workspace/);
  await page.goto("/tools/dca");
  await expect(page).toHaveURL(/\/templates/);
});
