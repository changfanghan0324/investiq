// Purpose: Coordinates real/demo loading, historical calculation, and optional future scenarios.

import { createDemoMarketData } from '@/data/demo-market-data';
import { runBacktest } from '@/domain/backtest-engine';
import { buildProjectionReport } from '@/domain/projection-engine';
import { loadMarketData } from '@/services/market-data-api';
import type { BacktestInput, BacktestReport } from '@/types/backtest';
import { todayDateString } from '@/utils/date';

export async function createReport(options: {
  input: BacktestInput;
  demo: boolean;
  demoSeed?: number;
}): Promise<BacktestReport> {
  const today = todayDateString();
  const historicalEnd = options.input.endDate < today ? options.input.endDate : today;
  const marketData = options.demo
    ? createDemoMarketData(options.input.ticker, options.demoSeed)
    : await loadMarketData({
        ticker: options.input.ticker,
        from: options.input.endDate > today ? '1990-01-01' : options.input.startDate,
        to: historicalEnd,
        requiredStart: options.input.startDate,
      });

  const lastRealPrice = marketData.prices.filter((bar) => bar.date <= historicalEnd).at(-1);
  if (!lastRealPrice) throw new Error('No market price is available on or before the end date.');

  const normalizedInput = options.input;
  const isFutureRequest = normalizedInput.endDate > today;
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
  const projection = isFutureRequest
    ? buildProjectionReport(normalizedInput, marketData, lastRealPrice.date)
    : undefined;

  return {
    input: normalizedInput,
    marketData,
    historical,
    projection,
  };
}
