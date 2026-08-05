import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';

const baseURL = process.env.INVESTIQ_SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:3111';
const output = resolve(process.cwd(), 'docs/assets');

const unavailable = JSON.stringify({
  status: 'unavailable',
  services: {
    priceAnalysis: 'unavailable',
    dca: 'unavailable',
    assistant: 'ready',
    database: 'configured',
  },
});

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

async function capture(page: Page, path: string, fullPage = false) {
  await settle(page);
  await page.screenshot({ path: resolve(output, path), fullPage, animations: 'disabled' });
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const page = await desktop.newPage();
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: unavailable }));

  await page.goto(`${baseURL}/`);
  await capture(page, 'home-desktop.png');

  await page.goto(`${baseURL}/case-study/aapl`);
  await capture(page, 'aapl-case-study.png');

  await page.goto(`${baseURL}/company/AAPL/financials`);
  await capture(page, 'aapl-financials.png', true);

  await page.goto(`${baseURL}/company/AAPL/valuation`);
  await capture(page, 'aapl-valuation.png', true);

  await page.goto(`${baseURL}/portfolio`);
  await page.getByRole('button', { name: 'Run synthetic demo' }).click();
  await page.getByRole('heading', { name: 'Portfolio result' }).waitFor({ timeout: 15_000 }).catch(() => undefined);
  await capture(page, 'portfolio-demo.png', true);

  await page.goto(`${baseURL}/tools/dca`);
  await page.getByRole('button', { name: /Load.*demo/i }).first().click();
  await page.getByRole('heading', { name: 'Portfolio performance' }).waitFor();
  await capture(page, 'dca-demo.png', true);

  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: 'dark' });
  const mobilePage = await mobile.newPage();
  await mobilePage.route('**/api/health', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: unavailable }));
  await mobilePage.goto(`${baseURL}/`);
  await mobilePage.getByLabel('Language').selectOption('zh-CN');
  await capture(mobilePage, 'home-mobile.png');
  await mobile.close();
} finally {
  await browser.close();
}
