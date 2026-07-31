// Purpose: Combines independently audited holding results into portfolio-level metrics,
// nets capital gains and losses across holdings, and measures cash-flow-neutral drawdown.

import { BacktestError } from '@/domain/backtest-engine';
import { aggregateFeeComponents, roundCalcMoney } from '@/domain/fees';
import { externalCashFlows, moneyWeightedReturn, timeWeightedReturn } from '@/domain/performance';
import type {
  BacktestResult,
  DrawdownResult,
  LiquidationEstimate,
  PortfolioAggregateResult,
  PortfolioPoint,
  TaxMode,
  Transaction,
} from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/**
 * How the flat-rate capital-gain tax is applied to the netted portfolio result.
 * Holdings run for a portfolio defer their own capital-gain tax, so the tax is
 * computed once here from the netted gain. Omitted (or pre-tax) means no tax.
 */
export interface PortfolioTaxContext {
  mode: TaxMode;
  capitalGainsTaxRate: number;
}

/** The aggregate ending balance and return decomposition must reconcile this tightly. */
const AGGREGATE_CROSS_CHECK_TOLERANCE = 1e-6;

/**
 * Combines audited holding results into one portfolio result.
 *
 * - NETTING MODE (a `taxContext` is supplied): the production portfolio model.
 *   Every holding must have deferred its capital-gain tax; gains and losses net
 *   across holdings (IRS Topic 409), one flat-rate tax is computed and subtracted
 *   once, and a single non-trade adjustment records it. Passing already-taxed
 *   holdings throws rather than taxing twice.
 * - LEGACY/COMPOSITION MODE (no `taxContext`): a plain merge that invents no
 *   netting. Whatever capital-gain tax the holdings already applied is preserved
 *   and reported; final amounts are summed as-is (not re-subtracted). Production
 *   portfolios always use netting mode.
 */
export function aggregateBacktestResults(
  results: BacktestResult[],
  taxContext?: PortfolioTaxContext,
): PortfolioAggregateResult | undefined {
  if (results.length === 0) return undefined;
  const netting = taxContext !== undefined;

  if (netting) {
    const alreadyTaxed = results.some(
      (result) => result.capitalGainsTax !== 0 || (result.liquidation?.capitalGainsTax ?? 0) !== 0,
    );
    if (alreadyTaxed) {
      throw new BacktestError(
        'Portfolio netting requires holding-level capital-gain tax to be deferred; received already-taxed holding results.',
      );
    }
  }

  const startDate = results.map((result) => result.startDate).sort()[0];
  const endDate = results.map((result) => result.endDate).sort().at(-1)!;
  const portfolio = aggregatePortfolioPoints(results);

  const { liquidation, capitalGainsTax, deductTax } = netting
    ? nettedLiquidation(results, taxContext)
    : legacyLiquidation(results);

  const totalContributions = sum(results, 'totalContributions');
  // In netting mode the summed final amounts are pre-tax (holdings deferred), so
  // the single netted tax is subtracted once here. In legacy mode holdings already
  // subtracted their own tax, so nothing is deducted again.
  const finalAmount = sum(results, 'finalAmount') - deductTax;
  const cash = sum(results, 'cash') - deductTax;
  const totalProfit = finalAmount - totalContributions;

  const priceReturn = sum(results, 'priceReturn');
  const grossDividends = sum(results, 'grossDividends');
  const dividendTax = sum(results, 'dividendTax');
  const totalFees = sum(results, 'totalFees');
  const totalProfitByParts =
    priceReturn + grossDividends - dividendTax - capitalGainsTax - totalFees;
  const crossCheckDifference = totalProfitByParts - totalProfit;

  // Enforce the same fail-closed reconciliation the holding engine uses: if the
  // ending balance and the return decomposition disagree by more than the
  // tolerance, stop rather than display an unreliable portfolio result.
  if (Math.abs(crossCheckDifference) > AGGREGATE_CROSS_CHECK_TOLERANCE) {
    throw new BacktestError(
      'The portfolio return audit cross-check failed, so aggregation stopped before displaying unreliable values.',
    );
  }

  const transactions: Transaction[] = results
    .flatMap((result) => result.transactions.map((transaction) => ({ ...transaction, ticker: result.ticker })))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Only netting mode adds the adjustment: its per-holding liquidation taxes are
  // deferred (zero), so this single non-trade record keeps the ledger's tax column
  // reconciled to the portfolio total. Legacy mode already carries per-holding
  // taxes in the ledger, so adding one would double-count.
  if (netting && capitalGainsTax > 0) {
    transactions.push(portfolioTaxAdjustment(endDate, capitalGainsTax));
  }

  // End-of-period valuation policy (matches the holding engine): the single netted
  // portfolio liquidation tax is folded into the terminal unit value so it is internal
  // to the flow-neutral TWR and drawdown, never an external flow. The summed terminal
  // value carries each holding's after-sell-fee value (their capital-gain tax is
  // deferred), so only the netted portfolio tax remains to apply here. A no-op when no
  // tax was netted (legacy mode, or a net loss).
  if (deductTax > 0 && portfolio.length > 0) {
    const terminal = portfolio[portfolio.length - 1];
    if (terminal.value > 0) {
      terminal.unitValue *= finalAmount / terminal.value;
      terminal.value = finalAmount;
      terminal.cash = cash;
    }
  }

  // Combined-portfolio performance: TWR from the netted flow-neutral unit-value series,
  // MWRR from the combined external cash flows and the portfolio terminal value — never
  // an average of the per-holding IRRs.
  const twr = timeWeightedReturn(portfolio);
  const mwrr = moneyWeightedReturn(externalCashFlows(portfolio, finalAmount, endDate));

  return {
    startDate,
    endDate,
    holdingsCount: results.length,
    stockValue: sum(results, 'stockValue'),
    cash,
    finalAmount,
    totalContributions,
    purchaseCost: sum(results, 'purchaseCost'),
    priceReturn,
    grossDividends,
    dividendTax,
    capitalGainsTax,
    totalFees,
    totalProfit,
    netGainRatioPercent: totalContributions > 0 ? (totalProfit / totalContributions) * 100 : 0,
    twr,
    mwrr,
    durationDays: daysBetween(startDate, endDate),
    contributionCount: sum(results, 'contributionCount'),
    dividendCount: sum(results, 'dividendCount'),
    maxDrawdown: calculateMaxDrawdown(portfolio),
    transactions,
    portfolio,
    splitCount: sum(results, 'splitCount'),
    tickerChangeCount: sum(results, 'tickerChangeCount'),
    crossCheckDifference,
    projected: results.some((result) => result.projected),
    acquisitionFees: sum(results, 'acquisitionFees'),
    feeComponents: aggregateFeeComponents(results.flatMap((result) => result.feeComponents)),
    liquidation,
  };
}

interface LiquidationOutcome {
  liquidation: LiquidationEstimate | undefined;
  /** Capital-gain tax reported at the portfolio level. */
  capitalGainsTax: number;
  /** Amount subtracted once from the summed final amounts (0 in legacy mode). */
  deductTax: number;
}

/**
 * Netting mode. The portfolio realized gain/loss is the summed amount realized
 * minus the summed basis, so a loss on one holding offsets a gain on another; the
 * flat-rate tax is applied once to the netted, floored-at-zero gain and deducted
 * once from the summed (pre-tax) final amounts.
 */
function nettedLiquidation(results: BacktestResult[], taxContext: PortfolioTaxContext): LiquidationOutcome {
  const parts = liquidationParts(results);
  if (parts.length === 0) return { liquidation: undefined, capitalGainsTax: 0, deductTax: 0 };

  const adjustedTaxBasis = sumBy(parts, (part) => part.adjustedTaxBasis);
  const netAmountRealized = sumBy(parts, (part) => part.netAmountRealized);
  const sellFee = sumBy(parts, (part) => part.sellFee);
  const realizedGainLoss = roundCalcMoney(netAmountRealized - adjustedTaxBasis);
  const taxableGain = Math.max(0, realizedGainLoss);
  const tax =
    taxContext.mode === 'after-tax'
      ? roundCalcMoney(taxableGain * (taxContext.capitalGainsTaxRate / 100))
      : 0;

  return {
    liquidation: {
      adjustedTaxBasis,
      netAmountRealized,
      realizedGainLoss,
      taxableGain,
      sellFee,
      capitalGainsTax: tax,
      feeComponents: aggregateFeeComponents(parts.flatMap((part) => part.feeComponents)),
    },
    capitalGainsTax: tax,
    deductTax: tax,
  };
}

/**
 * Legacy/composition mode. No netting is invented: the per-holding taxable gains
 * and the tax the holdings already applied are summed and reported, and nothing is
 * deducted again from their already-net final amounts.
 */
function legacyLiquidation(results: BacktestResult[]): LiquidationOutcome {
  const alreadyAppliedTax = sum(results, 'capitalGainsTax');
  const parts = liquidationParts(results);
  if (parts.length === 0) {
    return { liquidation: undefined, capitalGainsTax: alreadyAppliedTax, deductTax: 0 };
  }

  const adjustedTaxBasis = sumBy(parts, (part) => part.adjustedTaxBasis);
  const netAmountRealized = sumBy(parts, (part) => part.netAmountRealized);
  const sellFee = sumBy(parts, (part) => part.sellFee);
  const realizedGainLoss = roundCalcMoney(netAmountRealized - adjustedTaxBasis);

  return {
    liquidation: {
      adjustedTaxBasis,
      netAmountRealized,
      realizedGainLoss,
      taxableGain: sumBy(parts, (part) => part.taxableGain),
      sellFee,
      capitalGainsTax: alreadyAppliedTax,
      feeComponents: aggregateFeeComponents(parts.flatMap((part) => part.feeComponents)),
    },
    capitalGainsTax: alreadyAppliedTax,
    deductTax: 0,
  };
}

function liquidationParts(results: BacktestResult[]): LiquidationEstimate[] {
  return results
    .map((result) => result.liquidation)
    .filter((item): item is LiquidationEstimate => Boolean(item));
}

function sumBy<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

function portfolioTaxAdjustment(date: string, tax: number): Transaction {
  return {
    date,
    type: 'portfolio-tax-adjustment',
    shares: 0,
    price: 0,
    grossCash: 0,
    fee: 0,
    tax,
    note: 'Portfolio capital-gain tax: gains and losses netted across holdings, then taxed once. Not a market trade.',
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
