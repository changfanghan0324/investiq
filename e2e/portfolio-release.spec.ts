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

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
});

test("invalid ticker input returns an accessible validation message", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Search by ticker, such as AAPL").fill("not a ticker!");
  await page.getByRole("button", { name: "Research company" }).click();
  await expect(page.locator("#research-error")).toContainText("Enter a valid US ticker");
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
  test(`public-mode controls: ${mode.name}`, async ({ page }) => {
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
