import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("recruiter flow starts with company research and exposes data truth", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Investment Research/);
  await expect(page.getByRole("heading", { name: "Company research built from SEC filings." })).toBeVisible();
  await expect(page.getByLabel("Ticker")).toBeVisible();
  await expect(page.getByText("Real SEC filings", { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic data—not actual AAPL, MSFT, SPY/)).toBeVisible();
  await expect(page.getByText("Left unavailable and never replaced with zero")).toBeVisible();
  await expect(page.getByText(/Fang Han Chang/).first()).toBeVisible();

  await page.getByRole("link", { name: "View the AAPL example" }).click();
  await expect(page).toHaveURL(/\/case-study\/aapl$/);
  await expect(page.getByRole("heading", { name: "AAPL research case study" })).toBeVisible();
});

test("homepage primary flow is keyboard reachable and has no serious axe violations", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
  expect(results.incomplete.filter((check) => check.id === "aria-prohibited-attr")).toEqual([]);
});

test("quiet workspace contracts keep first-use controls progressive", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ status: "unavailable", services: { priceAnalysis: "unavailable", dca: "unavailable", assistant: "ready", database: "configured" } }),
  }));

  await page.goto("/");
  await expect(page.locator("main em")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Research company" })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.goto("/compare");
  await expect(page.getByText("Advanced settings")).toBeVisible();
  await expect(page.locator("details").first()).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Start date")).toHaveCount(0);
  await page.getByRole("button", { name: "Custom" }).click();
  await expect(page.getByLabel("Start date")).toBeVisible();

  await page.goto("/portfolio");
  await expect(page.getByLabel("Holding 1 ticker")).toHaveValue("AAPL");
  await expect(page.getByLabel("Holding 2 ticker")).toHaveValue("MSFT");
  await expect(page.getByText("Explore alternative historical weight examples")).toHaveCount(0);

  await page.goto("/tools/dca");
  await expect(page.locator('[id$="-ticker"]')).toHaveCount(1);
  await expect(page.getByText("Advanced assumptions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo" })).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("AI Analyst");
  await expect(page.locator('[class*="ambient"]')).toHaveCount(0);
});

test("AAPL case keeps analyst ownership, accessibility, localization, and scale contracts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single desktop contract check");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/case-study/aapl");

  await expect(page.getByRole("heading", { name: "AAPL research case study" })).toBeVisible();
  await expect(page.getByText("Analyst scenario", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$62.723B", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/marketable securities.*\$96\.486B/i).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("$333.43");
  await expect(page.locator("body")).not.toContainText("unverified placeholder");

  const scenarioRegion = page.locator('[role="region"][tabindex="0"][aria-label="Bear, base, and bull assumption sets"]');
  const sensitivityRegion = page.locator('[role="region"][tabindex="0"][aria-label="Base-set discount-rate sensitivity"]');
  await expect(scenarioRegion).toHaveAttribute("tabindex", "0");
  await expect(sensitivityRegion).toHaveAttribute("tabindex", "0");
  await sensitivityRegion.focus();
  await expect(sensitivityRegion).toBeFocused();

  await page.getByLabel("Text size").selectOption("100");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-font-scale").trim())).toBe("1.45");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "AAPL 研究案例" })).toBeVisible();
  await expect(page.getByText("US$62.723B", { exact: true }).first()).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
  expect(results.incomplete.filter((check) => check.id === "aria-prohibited-attr")).toEqual([]);
});

test("invalid ticker input returns an accessible validation message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ticker").fill("not a ticker!");
  await page.getByRole("button", { name: "Research company" }).click();
  await expect(page.locator("#research-error")).toContainText("Enter a valid US ticker");
});

test("analysis workspaces expose unavailable live data as synthetic mode", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      status: "unavailable",
      services: {
        priceAnalysis: "unavailable",
        dca: "unavailable",
        assistant: "ready",
        database: "configured",
      },
    }),
  }));

  await page.goto("/compare");
  await expect(page.getByRole("region", { name: "Synthetic public-demo data" })).toBeVisible();
  await expect(page.getByText("Data source: Synthetic public-demo series · Not actual market history")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run synthetic demo", exact: true })).toBeEnabled();

  await page.goto("/portfolio");
  await expect(page.getByRole("region", { name: "Synthetic public-demo data" })).toBeVisible();
  await expect(page.getByText("Data source: Synthetic public-demo series · Not actual market history")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run synthetic demo", exact: true })).toBeEnabled();
});

test("320px contract has no horizontal overflow on primary release routes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "320px-only contract check");

  for (const route of [
    "/",
    "/about",
    "/case-study/aapl",
    "/compare",
    "/portfolio",
    "/market",
    "/tools",
    "/tools/dca",
    "/company/AAPL",
  ]) {
    await page.goto(route);
    await expect.poll(
      () => page.evaluate(() => (
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      )),
      { message: `${route} should settle without horizontal overflow`, timeout: 5_000 },
    ).toBe(0);
  }
});

test("DCA result workspace has no prohibited ARIA attributes", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      status: "unavailable",
      services: {
        priceAnalysis: "unavailable",
        dca: "unavailable",
        assistant: "ready",
        database: "configured",
      },
    }),
  }));

  await page.goto("/tools/dca");
  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio performance" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Synthetic public-demo data" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Report scenario" }).getByRole("button", { name: "Synthetic series" })).toBeVisible();
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
  expect(results.incomplete.filter((check) => check.id === "aria-prohibited-attr")).toEqual([]);
});

test("language, text scale, and print surfaces retain provenance without overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single desktop print contract check");
  test.setTimeout(60_000);
  await page.route("**/api/fundamentals**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ message: "Company fundamentals are temporarily unavailable." }),
  }));
  await page.goto("/");
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText(/合成数据——并非 AAPL/)).toBeVisible();

  await page.locator("header select").nth(1).selectOption("100");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  for (const route of ["/case-study/aapl", "/company/AAPL/memo", "/company/AAPL/report", "/tools/dca"]) {
    await page.goto(route);
    await page.emulateMedia({ media: "print" });
    await expect.poll(
      () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      { message: `${route} print layout should not overflow`, timeout: 5_000 },
    ).toBeLessThanOrEqual(1);
    await page.emulateMedia({ media: "screen" });
  }
});

test("390, 768, and 1440px layouts remain usable at 145% text", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single responsive matrix contract check");
  test.setTimeout(60_000);
  await page.route("**/api/health", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ status: "unavailable", services: { priceAnalysis: "unavailable", dca: "unavailable", assistant: "ready", database: "configured" } }),
  }));

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/case-study/aapl", "/portfolio", "/tools/dca"]) {
      await page.goto(route);
      await page.locator("header select").nth(1).selectOption("100");
      await expect.poll(
        () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        { message: `${route} at ${width}px / 145% should not overflow`, timeout: 5_000 },
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("blocked browser storage does not block the public research flow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single storage-failure contract check");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("storage blocked"); } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Company research built from SEC filings." })).toBeVisible();
  await expect(page.getByText(/Synthetic data—not actual AAPL/)).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("synthetic CSV and PDF downloads retain public-demo provenance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "single export contract check");
  await page.route("**/api/health", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ status: "unavailable", services: { priceAnalysis: "unavailable", dca: "unavailable", assistant: "ready", database: "configured" } }),
  }));

  await page.goto("/compare");
  await page.getByRole("button", { name: "Run synthetic demo" }).click();
  await expect(page.getByRole("button", { name: "Download CSV" })).toBeVisible();
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await csvEvent;
  expect(readFileSync(await csv.path(), "utf8")).toContain("Data source,Synthetic public-demo series\r\n,Not actual market history");

  await page.goto("/tools/dca");
  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.getByRole("heading", { name: "Portfolio performance" })).toBeVisible();
  const pdfEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const pdf = await pdfEvent;
  expect(pdf.suggestedFilename()).toMatch(/^investiq-dca-synthetic-/);
});

test("mobile DCA resolves to one mode-aware primary action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320", "mobile action-bar contract check");

  let releaseHealth: (() => void) | undefined;
  const healthGate = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  await page.route("**/api/health", async (route) => {
    await healthGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        services: {
          priceAnalysis: "unavailable",
          dca: "unavailable",
          assistant: "ready",
          database: "configured",
        },
      }),
    });
  });

  await page.goto("/tools/dca");
  await expect(page.getByRole("button", { name: "Checking services", exact: true })).toBeDisabled();
  releaseHealth?.();
  await expect(page.getByRole("button", { name: "Run demo", exact: true })).toBeEnabled();
});

const publicModes = [
  { name: "all services ready", status: 200, dca: "ready", assistant: "ready", database: "configured", live: true, ai: true },
  { name: "DCA unavailable", status: 200, dca: "unavailable", assistant: "ready", database: "configured", live: false, ai: true },
  { name: "assistant unavailable", status: 200, dca: "ready", assistant: "unavailable", database: "configured", live: true, ai: false },
  { name: "market and assistant unavailable", status: 503, dca: "unavailable", assistant: "unavailable", database: "configured", live: false, ai: false },
  { name: "database not configured", status: 200, dca: "ready", assistant: "ready", database: "not-configured", live: true, ai: true },
  { name: "price analysis unavailable independently", status: 503, dca: "ready", assistant: "ready", database: "configured", live: true, ai: true },
  { name: "intentional JSON 503", status: 503, dca: "unavailable", assistant: "ready", database: "not-configured", live: false, ai: true },
] as const;

for (const mode of publicModes) {
  test(`public-mode controls: ${mode.name}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "desktop control-matrix contract check");
    await page.route("**/api/health", (route) => route.fulfill({
      status: mode.status,
      contentType: "application/json",
      body: JSON.stringify({
        status: mode.status === 503 ? "unavailable" : "ready",
        services: {
          priceAnalysis: mode.name === "price analysis unavailable independently" ? "unavailable" : "ready",
          dca: mode.dca,
          assistant: mode.assistant,
          database: mode.database,
        },
      }),
    }));

    await page.goto("/tools/dca");
    const primaryButton = page.getByRole("button", { name: mode.live ? "Run live backtest" : "Run demo" });
    await expect(primaryButton).toBeEnabled();
    await expect(page.locator(".runButton, [class*='runButton']")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Explain results" })).toHaveCount(0);
  });
}
