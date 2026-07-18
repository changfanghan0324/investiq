// Purpose: Combines independently audited holding results into portfolio-level metrics and drawdown.

import type {
  BacktestResult,
  DrawdownResult,
  PortfolioAggregateResult,
  PortfolioPoint,
} from '@/types/backtest';
import { daysBetween } from '@/utils/date';

export function aggregateBacktestResults(results: BacktestResult[]): PortfolioAggregateResult | undefined {
  if (results.length === 0) return undefined;

  const startDate = results.map((result) => result.startDate).sort()[0];
  const endDate = results.map((result) => result.endDate).sort().at(-1)!;
  const transactions = results
    .flatMap((result) => result.transactions.map((transaction) => ({ ...transaction, ticker: result.ticker })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const portfolio = aggregatePortfolioPoints(results);
  const totalContributions = sum(results, 'totalContributions');
  const finalAmount = sum(results, 'finalAmount');
  const totalProfit = finalAmount - totalContributions;

  return {
    startDate,
    endDate,
    holdingsCount: results.length,
    stockValue: sum(results, 'stockValue'),
    cash: sum(results, 'cash'),
    finalAmount,
    totalContributions,
    purchaseCost: sum(results, 'purchaseCost'),
    priceReturn: sum(results, 'priceReturn'),
    grossDividends: sum(results, 'grossDividends'),
    dividendTax: sum(results, 'dividendTax'),
    capitalGainsTax: sum(results, 'capitalGainsTax'),
    totalFees: sum(results, 'totalFees'),
    totalProfit,
    totalReturnPercent: totalContributions > 0 ? (totalProfit / totalContributions) * 100 : 0,
    durationDays: daysBetween(startDate, endDate),
    contributionCount: sum(results, 'contributionCount'),
    dividendCount: sum(results, 'dividendCount'),
    maxDrawdown: calculateMaxDrawdown(portfolio),
    transactions,
    portfolio,
    splitCount: sum(results, 'splitCount'),
    tickerChangeCount: sum(results, 'tickerChangeCount'),
    crossCheckDifference: sum(results, 'crossCheckDifference'),
    projected: results.some((result) => result.projected),
  };
}

function aggregatePortfolioPoints(results: BacktestResult[]): PortfolioPoint[] {
  const dates = [...new Set(results.flatMap((result) => result.portfolio.map((point) => point.date)))].sort();
  const indexes = results.map(() => 0);

  let units = 0;
  let unitValueLockedAtZero = false;
  return dates.map((date) => {
    let value = 0;
    let preFlowValue = 0;
    let externalFlow = 0;
    let cash = 0;
    results.forEach((result, resultIndex) => {
      const points = result.portfolio;
      while (indexes[resultIndex] + 1 < points.length && points[indexes[resultIndex] + 1].date <= date) {
        indexes[resultIndex] += 1;
      }
      const point = points[indexes[resultIndex]];
      if (point && point.date <= date) {
        value += point.value;
        preFlowValue += point.date === date ? point.preFlowValue : point.value;
        externalFlow += point.date === date ? point.externalFlow : 0;
        cash += point.cash;
      }
    });

    const preFlowUnitValue = units > 0 ? preFlowValue / units : 1;
    if (units > 0 && (!Number.isFinite(preFlowUnitValue) || preFlowUnitValue <= 0)) {
      unitValueLockedAtZero = true;
    }
    if (externalFlow > 0) {
      if (units === 0) {
        units = externalFlow;
      } else if (preFlowUnitValue > 0 && Number.isFinite(preFlowUnitValue)) {
        units += externalFlow / preFlowUnitValue;
      } else {
        // Keep post-loss contributions numerically stable without erasing a -100% TWR.
        units = externalFlow;
      }
    }
    const rawUnitValue = units > 0 ? value / units : 1;
    if (units > 0 && (!Number.isFinite(rawUnitValue) || rawUnitValue <= 0)) {
      unitValueLockedAtZero = true;
    }
    const unitValue = unitValueLockedAtZero ? 0 : rawUnitValue;
    return { date, value, unitValue, preFlowValue, externalFlow, shares: 0, cash };
  });
}

function calculateMaxDrawdown(points: PortfolioPoint[]): DrawdownResult {
  const firstInvestedIndex = points.findIndex((point) => point.externalFlow > 0 || point.value > 0);
  if (firstInvestedIndex < 0) return { percent: 0 };
  const invested = points.slice(firstInvestedIndex);

  let peakValue = 1;
  let peakDate = invested[0].date;
  let worst = 0;
  let worstPeak = 1;
  let worstPeakDate = peakDate;
  let troughDate = peakDate;

  for (const point of invested) {
    if (point.unitValue > peakValue) {
      peakValue = point.unitValue;
      peakDate = point.date;
    }
    const drawdown = (point.unitValue - peakValue) / Math.max(peakValue, 0.000001);
    if (drawdown < worst) {
      worst = drawdown;
      worstPeak = peakValue;
      worstPeakDate = peakDate;
      troughDate = point.date;
    }
  }

  return {
    percent: worst * 100,
    peakDate: worstPeakDate,
    troughDate,
    recoveryDate: invested.find((point) => point.date > troughDate && point.unitValue >= worstPeak)?.date,
  };
}

function sum<K extends keyof BacktestResult>(results: BacktestResult[], key: K): number {
  return results.reduce((total, result) => total + Number(result[key]), 0);
}
