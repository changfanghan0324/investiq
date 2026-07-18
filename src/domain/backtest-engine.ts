// Purpose: Pure backtest engine; all money, dividend, fee, and drawdown rules live here.

import { calculateOrderFee, floorShares, roundMoney, sharesForCash } from '@/domain/fees';
import { buildExecutionSchedule, nextAvailableTradingDate } from '@/domain/schedule';
import type {
  BacktestInput,
  BacktestResult,
  DateString,
  DividendEvent,
  DrawdownResult,
  MarketData,
  PortfolioPoint,
  Transaction,
} from '@/types/backtest';
import { daysBetween } from '@/utils/date';

const CROSS_CHECK_TOLERANCE = 0.03;

export class BacktestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BacktestError';
  }
}

export function runBacktest(input: BacktestInput, marketData: MarketData): BacktestResult {
  validateInput(input, marketData);

  const prices = marketData.prices
    .filter((bar) => bar.date >= input.startDate && bar.date <= input.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (prices.length === 0) {
    throw new BacktestError('No valid trading session is available in the selected period.');
  }

  const tradingDates = prices.map((bar) => bar.date);
  const schedule = buildExecutionSchedule(tradingDates, {
    startDate: input.startDate,
    endDate: input.endDate,
    intervalValue: input.investment.intervalValue,
    intervalUnit: input.investment.intervalUnit,
  });
  const contributionCounts = countDates(schedule);
  const dividendTimeline = prepareDividendTimeline(marketData.dividends, tradingDates, input);

  let shares = 0;
  let contributionCash = 0;
  let dividendCash = 0;
  let totalContributions = 0;
  let purchaseCost = 0;
  let totalFees = 0;
  let grossDividends = 0;
  let dividendTax = 0;
  let units = 0;
  let unitValueLockedAtZero = false;
  let contributionCount = 0;
  let dividendCount = 0;

  const dividendEntitlements = new Map<string, number>();
  const transactions: Transaction[] = [];
  const portfolio: PortfolioPoint[] = [];

  for (const bar of prices) {
    for (const dividend of dividendTimeline.exDates.get(bar.date) ?? []) {
      dividendEntitlements.set(dividend.id, shares);
    }

    for (const dividend of dividendTimeline.payDates.get(bar.date) ?? []) {
      const eligibleShares = dividendEntitlements.get(dividend.id) ?? 0;
      if (eligibleShares <= 0) continue;

      const gross = eligibleShares * dividend.splitAdjustedCashAmount;
      const tax = input.taxMode === 'after-tax' ? gross * (input.dividendTaxRate / 100) : 0;
      dividendCash += gross - tax;
      grossDividends += gross;
      dividendTax += tax;

      const order = sharesForCash(dividendCash, bar.high, input.fees.dividendReinvestment);
      dividendCash = Math.max(0, dividendCash - order.cost - order.fee);
      shares += order.shares;
      purchaseCost += order.cost;
      totalFees += order.fee;
      dividendCount += 1;

      transactions.push({
        date: bar.date,
        type: 'dividend-reinvestment',
        shares: order.shares,
        price: bar.high,
        grossCash: gross,
        fee: order.fee,
        tax,
        note: dividend.projected ? 'Simulated dividend reinvestment' : 'Ordinary cash dividend reinvested on payment date',
      });
    }

    const preFlowCash = contributionCash + dividendCash;
    // Contributions execute at the daily high, so existing holdings must be valued
    // at that same instant when new units are issued. Mixing a close-valued pre-flow
    // NAV with high-priced purchases would manufacture performance and drawdown.
    const preFlowValue = shares * bar.high + preFlowCash;
    const preFlowUnitValue = getPreFlowUnitValue(preFlowValue);
    let externalFlowToday = 0;
    const contributionsToday = contributionCounts.get(bar.date) ?? 0;
    for (let occurrence = 0; occurrence < contributionsToday; occurrence += 1) {
      if (input.investment.mode === 'amount') {
        const externalFlow = input.investment.value;
        externalFlowToday += externalFlow;
        contributionCash += externalFlow;
        totalContributions += externalFlow;

        const order = sharesForCash(contributionCash, bar.high, input.fees.buy);
        contributionCash = Math.max(0, contributionCash - order.cost - order.fee);
        shares += order.shares;
        purchaseCost += order.cost;
        totalFees += order.fee;
        contributionCount += 1;

        transactions.push({
          date: bar.date,
          type: 'contribution-buy',
          shares: order.shares,
          price: bar.high,
          grossCash: externalFlow,
          fee: order.fee,
          tax: 0,
          note: bar.projected ? 'Purchased at simulated daily high' : 'Purchased at trading-day high',
        });
      } else {
        const orderShares = floorShares(input.investment.value);
        const orderValue = roundMoney(orderShares * bar.high);
        const fee = calculateOrderFee(input.fees.buy, orderShares, orderValue);
        const externalFlow = orderValue + fee;
        externalFlowToday += externalFlow;
        totalContributions += externalFlow;
        shares += orderShares;
        purchaseCost += orderValue;
        totalFees += fee;
        contributionCount += 1;

        transactions.push({
          date: bar.date,
          type: 'contribution-buy',
          shares: orderShares,
          price: bar.high,
          grossCash: externalFlow,
          fee,
          tax: 0,
          note: bar.projected ? 'Fixed shares purchased at simulated daily high' : 'Fixed shares purchased at trading-day high',
        });
      }
    }

    addPortfolioUnits(externalFlowToday, preFlowUnitValue);
    const cash = contributionCash + dividendCash;
    const value = shares * bar.close + cash;
    const rawUnitValue = units > 0 ? value / units : 1;
    if (units > 0 && (!Number.isFinite(rawUnitValue) || rawUnitValue <= 0)) {
      unitValueLockedAtZero = true;
    }
    const unitValue = unitValueLockedAtZero ? 0 : rawUnitValue;
    portfolio.push({
      date: bar.date,
      value,
      unitValue,
      preFlowValue,
      externalFlow: externalFlowToday,
      shares,
      cash,
    });
  }

  const lastBar = prices.at(-1)!;
  const marketValueBeforeSale = shares * lastBar.close;
  let finalCash = contributionCash + dividendCash;
  let finalShares = shares;
  let sellFee = 0;
  let capitalGainsTax = 0;

  if (input.liquidateAtEnd && shares > 0) {
    sellFee = calculateOrderFee(input.fees.sell, shares, marketValueBeforeSale);
    const taxableGain = Math.max(0, marketValueBeforeSale - purchaseCost);
    capitalGainsTax = input.taxMode === 'after-tax'
      ? taxableGain * (input.capitalGainsTaxRate / 100)
      : 0;
    finalCash += marketValueBeforeSale - sellFee - capitalGainsTax;
    finalShares = 0;
    totalFees += sellFee;
    transactions.push({
      date: lastBar.date,
      type: 'liquidation',
      shares,
      price: lastBar.close,
      grossCash: marketValueBeforeSale,
      fee: sellFee,
      tax: capitalGainsTax,
      note: lastBar.projected ? 'All shares sold at simulated close' : 'All shares sold at end-date close',
    });
  }

  const stockValue = marketValueBeforeSale;
  const finalAmount = input.liquidateAtEnd ? finalCash : stockValue + finalCash;
  const priceReturn = stockValue - purchaseCost;
  const totalProfitByParts = priceReturn + grossDividends - dividendTax - capitalGainsTax - totalFees;
  const totalProfitByBalance = finalAmount - totalContributions;
  const crossCheckDifference = totalProfitByParts - totalProfitByBalance;

  if (Math.abs(crossCheckDifference) > CROSS_CHECK_TOLERANCE) {
    throw new BacktestError('The return audit cross-check failed, so calculation stopped before displaying unreliable values.');
  }

  return {
    ticker: input.ticker,
    companyName: marketData.name,
    startDate: prices[0].date,
    endDate: lastBar.date,
    finalPrice: lastBar.close,
    finalShares,
    stockValue,
    cash: finalCash,
    finalAmount,
    totalContributions,
    purchaseCost,
    priceReturn,
    grossDividends,
    dividendTax,
    capitalGainsTax,
    totalFees,
    totalProfit: totalProfitByBalance,
    totalReturnPercent: totalContributions > 0 ? (totalProfitByBalance / totalContributions) * 100 : 0,
    durationDays: daysBetween(prices[0].date, lastBar.date),
    contributionCount,
    dividendCount,
    maxDrawdown: calculateMaxDrawdown(portfolio),
    transactions,
    portfolio,
    splitCount: marketData.splits.filter(
      (event) => event.executionDate >= prices[0].date && event.executionDate <= lastBar.date,
    ).length,
    tickerChangeCount: marketData.tickerChanges.filter(
      (event) => event.date >= prices[0].date && event.date <= lastBar.date,
    ).length,
    crossCheckDifference,
    projected: prices.some((bar) => bar.projected),
  };

  function getPreFlowUnitValue(preFlowValue: number): number {
    if (units === 0) return 1;
    const value = preFlowValue / units;
    if (!Number.isFinite(value) || value <= 0) {
      unitValueLockedAtZero = true;
      return 0;
    }
    return value;
  }

  function addPortfolioUnits(externalFlow: number, issuePrice: number) {
    if (externalFlow <= 0) return;
    if (units === 0) {
      units = externalFlow;
      return;
    }
    if (issuePrice > 0 && Number.isFinite(issuePrice)) {
      units += externalFlow / issuePrice;
      return;
    }

    // A zero NAV represents a complete loss, after which cumulative TWR remains -100%.
    // Rebase the operational unit count so later contributions stay finite while the
    // reported unit value remains locked at zero.
    units = externalFlow;
  }
}

function validateInput(input: BacktestInput, marketData: MarketData) {
  if (input.startDate > input.endDate) throw new BacktestError('The start date cannot be later than the end date.');
  if (input.investment.value <= 0) throw new BacktestError('The order amount or share count must be greater than zero.');
  if (input.investment.intervalValue < 1) throw new BacktestError('The recurring interval must be at least one.');

  const unsupportedDividend = marketData.dividends.find((event) => {
    const type = event.distributionType.toLowerCase();
    return event.frequency === 0 || type.includes('special') || type.includes('non_recurring');
  });
  const unsupportedSplit = marketData.splits.find((event) => event.adjustmentType === 'stock_dividend');
  if (unsupportedDividend || unsupportedSplit) {
    throw new BacktestError('This security contains an unsupported corporate action. Calculation stopped to avoid an unreliable result.');
  }

  if (marketData.prices.some((bar) => ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))) {
    throw new BacktestError('The market-price history is incomplete and cannot be calculated reliably.');
  }
}

function prepareDividendTimeline(
  dividends: DividendEvent[],
  tradingDates: DateString[],
  input: BacktestInput,
) {
  const exDates = new Map<DateString, DividendEvent[]>();
  const payDates = new Map<DateString, DividendEvent[]>();

  for (const event of dividends) {
    if (event.exDate > input.endDate || event.payDate < input.startDate) continue;
    const exExecution = nextAvailableTradingDate(tradingDates, event.exDate);
    const payExecution = nextAvailableTradingDate(tradingDates, event.payDate);
    if (exExecution) pushMap(exDates, exExecution, event);
    if (payExecution && payExecution <= input.endDate) pushMap(payDates, payExecution, event);
  }
  return { exDates, payDates };
}

function countDates(dates: DateString[]): Map<DateString, number> {
  const result = new Map<DateString, number>();
  for (const date of dates) result.set(date, (result.get(date) ?? 0) + 1);
  return result;
}

function pushMap<T>(map: Map<DateString, T[]>, date: DateString, item: T) {
  map.set(date, [...(map.get(date) ?? []), item]);
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
    const drawdown = (point.unitValue - peakValue) / peakValue;
    if (drawdown < worst) {
      worst = drawdown;
      worstPeak = peakValue;
      worstPeakDate = peakDate;
      troughDate = point.date;
    }
  }

  const recovery = invested.find(
    (point) => point.date > troughDate && point.unitValue >= worstPeak,
  )?.date;

  return {
    percent: worst * 100,
    peakDate: worstPeakDate,
    troughDate,
    recoveryDate: recovery,
  };
}
