// Purpose: Coordinates real/demo loading and historical calculation.

import { createDemoMarketData } from '@/data/demo-market-data';
import { runBacktest } from '@/domain/backtest-engine';
import { loadMarketData } from '@/services/market-data-api';
import type { BacktestInput, BacktestReport } from '@/types/backtest';
import { todayDateString } from '@/utils/date';

export async function createReport(options: {
  input: BacktestInput;
  demo: boolean;
  demoSeed?: number;
}): Promise<BacktestReport> {
  const today = todayDateString();
  if (options.input.endDate > today) {
    throw new Error('Future simulations are temporarily unavailable while the projection methodology is under review. Choose today or an earlier date.');
  }
  const historicalEnd = options.input.endDate < today ? options.input.endDate : today;
  const marketData = options.demo
    ? createDemoMarketData(options.input.ticker, options.demoSeed)
    : await loadMarketData({
        ticker: options.input.ticker,
        from: options.input.endDate > today ? '1990-01-01' : options.input.startDate,
        to: historicalEnd,
        requiredStart: options.input.startDate,
        // DCA requires strict, cross-checked income and corporate-action coverage.
        mode: 'dca',
      });

  const lastRealPrice = marketData.prices.filter((bar) => bar.date <= historicalEnd).at(-1);
  if (!lastRealPrice) throw new Error('No market price is available on or before the end date.');

  const normalizedInput = options.input;
  const isFutureRequest = false;
  const historical =
    normalizedInput.startDate <= lastRealPrice.date
      ? runBacktest(
          {
            ...normalizedInput,
            endDate: lastRealPrice.date,
            liquidateAtEnd: isFutureRequest ? false : normalizedInput.liquidateAtEnd,
          },
          marketData,
        )
      : undefined;
  return {
    input: normalizedInput,
    marketData,
    historical,
    projection: undefined,
  };
}
