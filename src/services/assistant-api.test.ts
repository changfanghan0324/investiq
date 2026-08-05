import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import { getBrokerPreset } from '@/constants/broker-presets';
import { createDemoMarketData } from '@/data/demo-market-data';
import { runBacktest } from '@/domain/backtest-engine';
import { buildAssistantSummary } from '@/services/assistant-api';
import type { BacktestInput, PortfolioInput } from '@/types/backtest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/services/create-report');
});

describe('assistant data-mode contract', () => {
  it('labels a demo report as synthetic market data instead of real historical performance', async () => {
    vi.doMock('@/services/create-report', () => ({
      createReport: async ({ input, demoSeed }: { input: BacktestInput; demoSeed?: number }) => {
        const marketData = createDemoMarketData(input.ticker, demoSeed);
        return { input, marketData, historical: runBacktest(input, marketData) };
      },
    }));
    const { createPortfolioReport } = await import('@/services/create-portfolio-report');
    const input: PortfolioInput = {
      positions: [{
        id: 'one', ticker: 'AAPL',
        investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'months' },
      }],
      startDate: '2024-01-02', endDate: '2024-12-31', taxMode: 'pre-tax',
      dividendTaxRate: 0, liquidateAtEnd: false, capitalGainsTaxRate: 0,
      fees: getBrokerPreset('custom'),
    };
    const report = await createPortfolioReport({ input, demo: true });

    const summary = buildAssistantSummary(report, 'historical');

    assert.equal(summary.dataMode, 'synthetic-market');
    assert.match(summary.mode, /^synthetic public-demo series/);
    assert.doesNotMatch(summary.mode, /^historical backtest$/);
  });
});
