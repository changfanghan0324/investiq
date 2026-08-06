import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { FSLY_IDENTITY, fslyCompanyFacts } from '@/domain/fixtures/fundamentals-fixtures';
import { buildFundamentals } from '@/domain/fundamentals';

const fsly = buildFundamentals(fslyCompanyFacts(), FSLY_IDENTITY);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/fundamentals**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fsly),
  }));
});

test('FSLY partial coverage stays usable and requires loss-making assumptions', async ({ page }, testInfo) => {
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

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  if (process.env.INVESTIQ_CAPTURE_AUDIT === '1') {
    const suffix = testInfo.project.name === 'mobile-320' ? 'mobile' : 'desktop';
    await page.screenshot({ path: `docs/audit/fundamentals-coverage/after/fsly-valuation-${suffix}.png`, fullPage: true });
  }
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
