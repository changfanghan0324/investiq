import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const root = "https://investiq-eight-xi.vercel.app";
const output = "docs/screenshots/modelguard";
const samples = "public/samples";

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

await page.goto(`${root}/`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${output}/home.png`, fullPage: true });

await page.goto(`${root}/workspace`, { waitUntil: "networkidle" });
await page.locator("#workbook-file").setInputFiles(`${samples}/modelguard-error-model.xlsx`);
await page.getByRole("heading", { name: "Issue explorer" }).waitFor({ timeout: 20_000 });
await page.screenshot({ path: `${output}/error-audit.png` });

const accountingFinding = page.locator("article").filter({ hasText: "MG-ACC-001" }).first();
await accountingFinding.locator("details summary").click();
await accountingFinding.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${output}/finding-detail.png` });

await page.goto(`${root}/workspace`, { waitUntil: "networkidle" });
await page.locator("#before-version").setInputFiles(`${samples}/modelguard-version-1.xlsx`);
await page.locator("#after-version").setInputFiles(`${samples}/modelguard-version-2.xlsx`);
await page.getByRole("button", { name: "Version compare" }).click();
await page.getByText("New findings: 1").waitFor({ timeout: 20_000 });
await page.screenshot({ path: `${output}/version-comparison.png`, fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(`${root}/`, { waitUntil: "networkidle" });
await mobile.screenshot({ path: `${output}/mobile.png`, fullPage: true });

await mobile.close();
await page.close();
await browser.close();
