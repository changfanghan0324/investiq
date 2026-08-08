import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { AAPL_IDENTITY, FSLY_IDENTITY, aaplDirectRevenueFixture, fslyCompanyFacts } from '@/domain/fixtures/fundamentals-fixtures';
import { buildFundamentals } from '@/domain/fundamentals';

const fsly = buildFundamentals(fslyCompanyFacts(), FSLY_IDENTITY);
const aapl = buildFundamentals(aaplDirectRevenueFixture(), AAPL_IDENTITY);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/fundamentals**', (route) => {
    const ticker = new URL(route.request().url()).searchParams.get('ticker');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ticker === 'AAPL' ? aapl : fsly) });
  });
});

test('FSLY partial coverage stays usable and requires loss-making assumptions', async ({ page }) => {
  await page.goto('/company/FSLY/valuation');

  await expect(page.getByRole('heading', { name: 'Valuation setup' })).toBeVisible();
  await expect(page.getByText(/^\$624M/)).toBeVisible();
  await expect(page.getByText(/^-19\.1%/)).toBeVisible();
  await expect(page.getByText('Direct SEC fact').first()).toBeVisible();
  await expect(page.getByText(/Limited history: fewer than three/)).toBeVisible();
  await expect(page.getByText(/Latest margin is non-positive/)).toBeVisible();
  await expect(page.getByText('Revenue, operating margin, and diluted-share anchors are required before this DCF can run.')).toHaveCount(0);

  const margin = page.getByLabel('Operating margin');
  const da = page.getByLabel('D&A / revenue');
  const run = page.getByRole('button', { name: 'Run scenario valuation' });
  await expect(margin).toHaveValue('');
  await expect(da).toHaveValue('');
  await expect(run).toBeDisabled();

  await page.getByText('Open SEC evidence receipts').click();
  await expect(page.getByText(/RevenueFromContractWithCustomerIncludingAssessedTax/).first()).toBeVisible();

  await margin.fill('-10');
  await da.fill('5');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByText('Base assumptions')).toBeVisible();
  await expect(page.getByText(/scenario analysis, not a price target or forecast/i)).toBeVisible();
  const method = page.getByLabel('Valuation multiple');
  await expect(method).toHaveValue('ev-revenue');
  await expect(method.locator('option[value="pe"]')).toHaveAttribute('disabled', '');
  await expect(page.getByText(/P\/E unavailable: aligned diluted EPS is zero or negative/)).toBeVisible();

  await page.goto('/company/FSLY/financials');
  await expect(page.getByText('FY2021 · Older evidence — latest company year is FY2025')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

});

test('partial-coverage UI is bilingual, scalable, keyboard reachable, and axe-clean', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'desktop accessibility contract');
  await page.goto('/company/FSLY/valuation');
  await page.getByLabel('Text size').selectOption('100');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale').trim())).toBe('1.45');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.getByLabel('Language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '估值设置' })).toBeVisible();
  await expect(page.getByText('支持部分数据覆盖')).toBeVisible();
  await expect(page.getByText(/最新利润率为非正值/)).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
});

test('company price-risk context is explicitly synthetic when licensed history is unavailable', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'unavailable', services: { priceAnalysis: 'unavailable', dca: 'unavailable', assistant: 'unavailable', database: 'not-configured' } }),
  }));

  await page.goto('/company/AAPL');
  await page.locator('details > summary').first().click();
  await expect(page.getByRole('heading', { name: 'Synthetic Price Series and risk example' })).toBeVisible();
  await expect(page.getByTestId('market-data-provenance')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Public Demo Market Data' }).getByRole('paragraph')).toContainText('This page uses synthetic market series for demonstration.');
  await expect(page.locator('body')).not.toContainText('Current Price');
  await expect(page.locator('body')).not.toContainText('Historical Performance');
});

test('captures the fundamentals coverage audit set', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium' || process.env.INVESTIQ_CAPTURE_AUDIT !== '1', 'capture-only audit');
  const captures = [
    { route: '/company/FSLY', name: 'fsly-summary' },
    { route: '/company/FSLY/financials', name: 'fsly-financials' },
    { route: '/company/FSLY/valuation', name: 'fsly-valuation' },
    { route: '/company/AAPL/valuation', name: 'aapl-valuation' },
  ];
  for (const viewport of [{ width: 1440, height: 1000, suffix: 'desktop' }, { width: 390, height: 844, suffix: 'mobile' }]) {
    await page.setViewportSize(viewport);
    for (const capture of captures) {
      await page.goto(capture.route);
      await page.waitForTimeout(800);
      await expect(page.locator('#main-content')).not.toContainText('temporarily unavailable');
      await page.screenshot({ path: `docs/audit/fundamentals-coverage/after/${capture.name}-${viewport.suffix}.png`, fullPage: false });
    }
  }
});
