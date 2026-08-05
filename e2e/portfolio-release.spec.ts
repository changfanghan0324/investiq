import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("recruiter flow exposes evidence modes and the stable case study", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Investment Research/);
  await expect(page.getByRole("heading", { name: "Investment research you can audit." })).toBeVisible();
  await expect(page.getByText("SEC fundamentals — real filed evidence")).toBeVisible();
  await expect(page.getByText("Market examples — deterministic demonstrations")).toBeVisible();
  await expect(page.getByText("Unavailable data — never invented")).toBeVisible();

  await page.getByRole("link", { name: "Explore the AAPL case study" }).click();
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
  await page.getByPlaceholder("Search by ticker, such as AAPL").fill("not a ticker!");
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
  await expect(page.getByText("Synthetic demo mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run synthetic demo", exact: true })).toBeEnabled();

  await page.goto("/portfolio");
  await expect(page.getByText("Synthetic demo mode")).toBeVisible();
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
  await page.getByRole("button", { name: /Load.*demo/i }).first().click();
  await expect(page.getByRole("heading", { name: "Portfolio performance" })).toBeVisible();
  await page.waitForTimeout(400);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
  expect(results.incomplete.filter((check) => check.id === "aria-prohibited-attr")).toEqual([]);
});

test("mobile DCA waits for readiness before offering the demo fallback", async ({ page }, testInfo) => {
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
  await expect(page.getByRole("button", { name: "Load demo", exact: true })).toBeEnabled();
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
    const liveButton = page.getByRole("button", { name: mode.live ? "Run live backtest" : "Live data unavailable" });
    const demoButton = page.getByRole("button", { name: "Load synthetic demo" });
    const aiButton = page.getByRole("button", { name: "AI Analyst" });

    await expect(demoButton).toBeEnabled();
    await expect(liveButton).toBeEnabled({ enabled: mode.live });
    await expect(aiButton).toBeEnabled({ enabled: mode.ai });
  });
}
