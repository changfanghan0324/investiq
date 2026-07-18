// Purpose: Creates conservative, baseline, and optimistic future simulations from historical data.

import { runBacktest } from '@/domain/backtest-engine';
import type {
  BacktestInput,
  DividendEvent,
  MarketData,
  PriceBar,
  ProjectionReport,
  ProjectionScenarioId,
} from '@/types/backtest';
import { addDays, daysBetween, isWeekday, nextWeekday } from '@/utils/date';

interface ScenarioDefinition {
  id: ProjectionScenarioId;
  label: string;
  annualRate: number;
}

export function buildProjectionReport(
  input: BacktestInput,
  marketData: MarketData,
  lastHistoricalDate: string,
): ProjectionReport | undefined {
  if (input.endDate <= lastHistoricalDate) return undefined;

  const samplePrices = marketData.prices.filter(
    (bar) => !bar.projected && bar.date >= '1990-01-01' && bar.date <= lastHistoricalDate,
  );
  if (samplePrices.length < 2) return undefined;

  const annualReturns = completedAnnualReturns(samplePrices, lastHistoricalDate);
  if (annualReturns.length < 3) {
    return {
      sampleStartDate: samplePrices[0].date,
      sampleEndDate: lastHistoricalDate,
      completedYears: annualReturns.length,
      warning: 'Fewer than three complete historical years are available, so future simulations are disabled.',
      scenarios: [],
    };
  }

  const years = Math.max(daysBetween(samplePrices[0].date, samplePrices.at(-1)!.date) / 365.25, 1);
  const cagr = Math.pow(samplePrices.at(-1)!.close / samplePrices[0].close, 1 / years) - 1;
  const dividendYield = medianAnnualDividendYield(samplePrices, marketData.dividends, lastHistoricalDate);
  const definitions: ScenarioDefinition[] = [
    { id: 'conservative', label: 'Conservative', annualRate: percentile(annualReturns, 0.25) },
    { id: 'baseline', label: 'Baseline', annualRate: cagr },
    { id: 'optimistic', label: 'Optimistic', annualRate: percentile(annualReturns, 0.75) },
  ];

  const scenarios = definitions.map((definition) => {
    const projectedData = extendMarketData(
      marketData,
      lastHistoricalDate,
      input.endDate,
      definition.annualRate,
      dividendYield,
    );
    return {
      ...definition,
      annualDividendYield: dividendYield,
      result: runBacktest(input, projectedData),
    };
  });

  return {
    sampleStartDate: samplePrices[0].date,
    sampleEndDate: lastHistoricalDate,
    completedYears: annualReturns.length,
    warning: annualReturns.length < 5 ? 'Only three to four complete years are available, so the simulation sample is limited.' : undefined,
    scenarios,
  };
}

function extendMarketData(
  marketData: MarketData,
  lastDate: string,
  endDate: string,
  annualRate: number,
  annualDividendYield: number,
): MarketData {
  const prices = marketData.prices.filter((bar) => bar.date <= lastDate);
  const projectedPrices: PriceBar[] = [];
  const boundedRate = Math.max(-0.95, annualRate);
  const dailyRate = Math.pow(1 + boundedRate, 1 / 252) - 1;
  const premiumSamples = prices.slice(-252).map((bar) => Math.max(0, bar.high / bar.close - 1));
  const intradayPremium = Math.max(0.002, median(premiumSamples));
  let close = prices.at(-1)!.close;
  let cursor = addDays(lastDate, 1);

  while (cursor <= endDate) {
    if (isWeekday(cursor)) {
      close *= 1 + dailyRate;
      projectedPrices.push({
        date: cursor,
        open: close / (1 + dailyRate / 2),
        high: close * (1 + intradayPremium),
        low: close * (1 - intradayPremium * 0.8),
        close,
        projected: true,
      });
    }
    cursor = addDays(cursor, 1);
  }

  const allPrices = [...prices, ...projectedPrices];
  const projectedDividends = buildProjectedDividends(
    allPrices,
    lastDate,
    endDate,
    annualDividendYield,
  );
  return {
    ...marketData,
    prices: allPrices,
    dividends: [...marketData.dividends.filter((event) => event.payDate <= lastDate), ...projectedDividends],
  };
}

function buildProjectedDividends(
  prices: PriceBar[],
  lastDate: string,
  endDate: string,
  annualYield: number,
): DividendEvent[] {
  if (annualYield <= 0) return [];
  const events: DividendEvent[] = [];
  const startYear = Number(lastDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));

  for (let year = startYear; year <= endYear; year += 1) {
    for (const month of ['03', '06', '09', '12']) {
      const payDate = nextWeekday(`${year}-${month}-15`);
      if (payDate <= lastDate || payDate > endDate) continue;
      const payBar = prices.find((bar) => bar.date >= payDate);
      if (!payBar || payBar.date > endDate) continue;
      const exDate = nextWeekday(addDays(payDate, -14));
      const amount = (payBar.close * annualYield) / 4;
      events.push({
        id: `projected-${payDate}`,
        exDate,
        payDate,
        cashAmount: amount,
        splitAdjustedCashAmount: amount,
        distributionType: 'recurring',
        frequency: 4,
        projected: true,
      });
    }
  }
  return events;
}

function completedAnnualReturns(prices: PriceBar[], lastDate: string): number[] {
  const incompleteYear = Number(lastDate.slice(0, 4));
  const byYear = new Map<number, PriceBar[]>();
  for (const bar of prices) {
    const year = Number(bar.date.slice(0, 4));
    if (year >= incompleteYear) continue;
    byYear.set(year, [...(byYear.get(year) ?? []), bar]);
  }
  return [...byYear.values()]
    .filter((bars) => bars.length >= 100)
    .map((bars) => bars.at(-1)!.close / bars[0].close - 1)
    .sort((a, b) => a - b);
}

function medianAnnualDividendYield(
  prices: PriceBar[],
  dividends: DividendEvent[],
  lastDate: string,
): number {
  const incompleteYear = Number(lastDate.slice(0, 4));
  const yields: number[] = [];
  const firstYear = Number(prices[0].date.slice(0, 4));
  for (let year = firstYear; year < incompleteYear; year += 1) {
    const yearPrices = prices.filter((bar) => bar.date.startsWith(`${year}-`));
    if (yearPrices.length < 100) continue;
    const dividendPerShare = dividends
      .filter((event) => event.payDate.startsWith(`${year}-`) && event.frequency > 0)
      .reduce((sum, event) => sum + event.splitAdjustedCashAmount, 0);
    const averagePrice = yearPrices.reduce((sum, bar) => sum + bar.close, 0) / yearPrices.length;
    yields.push(averagePrice > 0 ? dividendPerShare / averagePrice : 0);
  }
  return median(yields);
}

function percentile(sortedValues: number[], value: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * value;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}
