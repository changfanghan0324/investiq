import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home communicates the local-only ModelGuard workflow", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await expect(page).toHaveTitle(/ModelGuard/);
  await expect(page.getByRole("heading", { name: "Check a financial model before someone else does." })).toBeVisible();
  await expect(page.getByText("Processed locally. Not uploaded. No AI. No financial-data API.")).toBeVisible();
  await expect(page.getByText("0 uploads")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a model" })).toHaveAttribute("href", "/workspace");
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("Try sample model runs the bundled clean audit without a file picker", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await page.getByRole("link", { name: "Try the sample model" }).click();
  await expect(page).toHaveURL(/\/workspace\?sample=clean$/);
  await expect(page.getByText("Sample model", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Synthetic fictional company")).toBeVisible();
  await expect(page.getByText("Ready for review").first()).toBeVisible({ timeout: 20_000 });
  const summary = page.locator('[class*="summaryGrid"]');
  await expect(summary.locator("strong").nth(0)).toHaveText("0");
  await expect(summary.locator("strong").nth(1)).toHaveText("0");
  await expect(summary.locator("div").filter({ hasText: "Checks passed" }).locator("strong")).toHaveText("51");
  await expect(page.locator("#workbook-file")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Ready for review").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Upload your own model" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator("#workbook-file")).toHaveCount(1);
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("unknown sample IDs fail safely without loading an arbitrary path", async ({ page }) => {
  await page.goto("/workspace?sample=not-a-real-sample");
  await expect(page.getByText("This sample is not available.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload your own model" })).toBeVisible();
  await expect(page.locator("#workbook-file")).toHaveCount(0);
});

test("homepage error sample runs locally and displays its expected rule family", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  await page.getByRole("link", { name: "Run the error sample" }).click();
  await expect(page).toHaveURL(/\/workspace\?sample=error$/);
  await expect(page.getByText("MG-STR-004").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Expected findings", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs review").first()).toBeVisible();
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("clean sample is ready for review without network calls", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Model audit workspace" })).toBeVisible();
  await expect(page.getByText("XLSX only")).toBeVisible();
  await page.locator("#workbook-file").setInputFiles("public/samples/modelguard-clean-model.xlsx");
  await expect(page.getByRole("heading", { name: "Issue explorer" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Ready for review")).toBeVisible();
  const summary = page.locator('[class*="summaryGrid"]');
  await expect(summary.locator("strong").nth(0)).toHaveText("0");
  await expect(summary.locator("strong").nth(1)).toHaveText("0");
  expect(requests.filter((url) => /\/api\/|sec\.gov|query1\.finance|analytics/i.test(url))).toEqual([]);
});

test("error sample exposes finance rule IDs and local exports", async ({ page }) => {
  await page.goto("/workspace");
  await page.locator("#workbook-file").setInputFiles("public/samples/modelguard-error-model.xlsx");
  await expect(page.getByRole("heading", { name: "Issue explorer" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("MG-STR-004").first()).toBeVisible();
  await expect(page.getByText("MG-ACC-001").first()).toBeVisible();
  await expect(page.getByText("MG-DCF-007").first()).toBeVisible();
  await expect(page.getByText("MG-SCN-001").first()).toBeVisible();
  await page.getByRole("button", { name: "DCF" }).click();
  await expect(page.getByText("MG-DCF-007").first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "MG-ACC-001" })).toHaveCount(0);
  await page.getByRole("button", { name: "All" }).click();
  for (const label of ["Export JSON", "Export CSV", "Export PDF"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: label }).click();
    await expect((await download).suggestedFilename()).toMatch(/modelguard-error-model_\d{4}-\d{2}-\d{2}\.(json|csv|pdf)$/i);
    await expect(page.getByRole("link", { name: "Download again" })).toBeVisible();
  }
  await expect(page.getByText("Why it matters").first()).toBeVisible();
  await expect(page.getByText("Remediation").first()).toBeVisible();
  await expect(page.getByText("Recheck").first()).toBeVisible();
  await expect(page.getByText("Limitations and review boundaries")).toBeVisible();
  await page.getByRole("button", { name: "Clear this session" }).click();
  await expect(page.getByRole("heading", { name: "Issue explorer" })).toBeHidden();
});

test("one-click version sample shows the documented comparison result", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Try version comparison sample" }).click();
  await expect(page.getByText(/New findings:\s*1/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Resolved findings:\s*3/)).toBeVisible();
  await expect(page.getByText(/Persisting findings:\s*0/)).toBeVisible();
  await expect(page.getByText(/Changed findings:\s*0/)).toBeVisible();
});

test("version compare classifies findings and exports cell changes", async ({ page }) => {
  await page.goto("/workspace");
  await page.locator("#before-version").setInputFiles("public/samples/modelguard-version-1.xlsx");
  await page.locator("#after-version").setInputFiles("public/samples/modelguard-version-2.xlsx");
  await expect(page.getByRole("button", { name: "Version compare" })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: "Version compare" }).click();
  await expect(page.getByText(/New findings:\s*1/)).toBeVisible();
  await expect(page.getByText(/Resolved findings:\s*3/)).toBeVisible();
  await expect(page.getByText(/Persisting findings:\s*0/)).toBeVisible();
  await expect(page.getByText("MG-SCN-004")).toBeVisible();
  await expect(page.getByText("Changes:")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).last().click();
  await expect((await download).suggestedFilename()).toBe("modelguard-version-findings.csv");
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

test("templates expose actual downloadable samples and methodology exposes the rule catalog", async ({ page }) => {
  await page.goto("/templates");
  await expect(page.getByRole("heading", { name: "Clean Model" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download workbook" }).first()).toHaveAttribute("download", "");
  await expect(page.getByText("Balance Sheet Error")).toBeVisible();
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Rule catalog" })).toBeVisible();
  await expect(page.getByText("MG-ACC-001")).toBeVisible();
  await expect(page.getByText("Potential false positive").first()).toBeVisible();
  await expect(page.getByText("Evidence contract / pseudocode").first()).toBeVisible();
});

test("unsupported and blank workbooks fail with actionable local messages", async ({ page }) => {
  await page.goto("/workspace");
  await page.locator("#workbook-file").setInputFiles("public/samples/modelguard-not-a-workbook.txt");
  await expect(page.getByText("Only .xlsx workbooks are supported.")).toBeVisible();
  await page.locator("#workbook-file").setInputFiles({ name: "unreadable.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not an xlsx zip") });
  await expect(page.getByText("This workbook could not be accepted.")).toBeVisible();
  await page.locator("#workbook-file").setInputFiles({ name: "too-large.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(page.getByText("larger than the 20 MB local limit")).toBeVisible();
  await page.locator("#workbook-file").setInputFiles("public/samples/modelguard-blank-workbook.xlsx");
  await expect(page.getByText(/workbook is blank/i)).toBeVisible({ timeout: 20_000 });
});
