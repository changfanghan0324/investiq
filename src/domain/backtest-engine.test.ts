// Purpose: Regression tests for schedules, dividends, unsupported actions, and accounting checks.

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { getBrokerPreset } from '@/constants/broker-presets';
import { BacktestError, runBacktest } from '@/domain/backtest-engine';
import { aggregateBacktestResults } from '@/domain/portfolio-aggregate';
import { buildExecutionSchedule } from '@/domain/schedule';
import type { BacktestInput, MarketData } from '@/types/backtest';
import { parseLocalDate, toLocalDateString } from '@/utils/date';

const input: BacktestInput = {
  ticker: 'TEST',
  startDate: '2024-01-02',
  endDate: '2024-01-08',
  investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'years' },
  taxMode: 'pre-tax',
  dividendTaxRate: 0,
  liquidateAtEnd: false,
  capitalGainsTaxRate: 0,
  fees: getBrokerPreset('custom'),
};

const marketData: MarketData = {
  ticker: 'TEST',
  name: 'Test Company',
  currency: 'USD',
  locale: 'us',
  type: 'CS',
  prices: [
    { date: '2024-01-02', open: 10, high: 10, low: 9, close: 10 },
    { date: '2024-01-03', open: 10, high: 10, low: 9, close: 10 },
    { date: '2024-01-04', open: 10, high: 10, low: 9, close: 10 },
    { date: '2024-01-05', open: 10, high: 10, low: 9, close: 10 },
    { date: '2024-01-08', open: 10, high: 10, low: 9, close: 10 },
  ],
  dividends: [],
  splits: [],
  tickerChanges: [],
  source: 'demo',
  fetchedAt: '2024-01-08T00:00:00.000Z',
  provenance: {
    sourceType: 'synthetic',
    provider: 'InvestIQ deterministic demo generator',
    generatedAt: '2024-01-08T00:00:00.000Z',
    disclaimer: 'This page uses synthetic market series for demonstration. It does not represent actual historical prices or investment performance.',
    priceProvider: 'demo',
    priceBasis: 'split-adjusted',
    fetchedAt: '2024-01-08T00:00:00.000Z',
    dividendCoverage: 'demo',
    totalReturnCoverage: 'demo',
    splitCoverage: 'demo',
    reorganizationCoverage: 'demo',
    mode: 'demo',
  },
};

describe('schedule', () => {
  it('moves a weekend monthly due date to the next trading day', () => {
    const dates = ['2024-06-28', '2024-07-01', '2024-07-02'];
    assert.deepEqual(
      buildExecutionSchedule(dates, {
        startDate: '2024-06-30',
        endDate: '2024-07-02',
        intervalValue: 1,
        intervalUnit: 'months',
      }),
      ['2024-07-01'],
    );
  });

  it('round-trips picker dates with local calendar components', () => {
    assert.equal(toLocalDateString(parseLocalDate('2026-07-18')), '2026-07-18');
  });
});

describe('backtest engine', () => {
  it('uses the daily high and keeps the accounting cross-check balanced', () => {
    const result = runBacktest(input, marketData);
    assert.equal(result.finalShares, 10);
    assert.equal(result.totalContributions, 100);
    assert.equal(result.totalProfit, 0);
    assert.ok(Math.abs(result.crossCheckDifference) < 0.001);
    assert.equal(result.transactions[0].price, 10);
  });

  it('reports a flat, no-fee run as a 0% ratio, 0% TWR, and 0% MWRR with no fake annualization', () => {
    const result = runBacktest(input, marketData);

    assert.equal(result.netGainRatioPercent, 0);
    assert.ok(Math.abs(result.twr.cumulative) < 1e-9, 'flat TWR is 0');
    assert.equal(result.twr.annualizationEligible, false); // 6 days elapsed, well under a year
    assert.equal(result.twr.annualized, undefined);
    assert.equal(result.mwrr.status, 'available');
    assert.ok(Math.abs(result.mwrr.annualizedRate as number) < 1e-6, 'flat MWRR is 0');
    assert.equal(result.maxDrawdown.percent, 0);
  });

  it('folds the end sell fee into TWR and drawdown as internal economics, not an external flow', () => {
    const custom = getBrokerPreset('custom');
    const fees = { ...custom, sell: { ...custom.sell, fixed: 1 } };
    const result = runBacktest({ ...input, liquidateAtEnd: true, fees }, marketData);

    // 10 shares × $10 = $100 market value, less the $1 sell fee = $99 ending value.
    assert.ok(Math.abs(result.finalAmount - 99) < 1e-9);
    // Terminal unit value = 99 / 100 contributed units = 0.99 → −1% cumulative TWR.
    assert.ok(Math.abs(result.twr.cumulative - -0.01) < 1e-9, 'the sell fee enters TWR');
    // The MWRR terminal uses the same after-fee value, so both measures see the drag.
    assert.equal(result.mwrr.status, 'available');
    assert.ok((result.mwrr.annualizedRate as number) < 0);
    // The terminal liquidation adjustment is the final (and only) drawdown observation.
    assert.ok(Math.abs(result.maxDrawdown.percent - -1) < 1e-9);
    // The sell fee is never introduced as an external cash flow.
    assert.equal(result.portfolio.filter((point) => point.externalFlow > 0).length, 1);
  });

  it('reflects a reinvested dividend in TWR/MWRR without treating it as an external flow', () => {
    const result = runBacktest(input, {
      ...marketData,
      dividends: [
        {
          id: 'div-twr',
          exDate: '2024-01-03',
          payDate: '2024-01-05',
          cashAmount: 1,
          splitAdjustedCashAmount: 1,
          distributionType: 'recurring',
          frequency: 4,
        },
      ],
    });

    // The single contribution is the only external flow; the reinvested dividend is internal,
    // so it lifts the flow-neutral TWR rather than appearing as a contribution.
    assert.ok(result.twr.cumulative > 0, 'the reinvested dividend lifts flow-neutral TWR');
    assert.equal(result.mwrr.status, 'available');
    const contributionFlows = result.portfolio.filter((point) => point.externalFlow > 0);
    assert.equal(contributionFlows.length, 1);
  });

  it('uses ex-date shares and reinvests the net dividend on pay date', () => {
    const result = runBacktest(input, {
      ...marketData,
      dividends: [
        {
          id: 'div-1',
          exDate: '2024-01-03',
          payDate: '2024-01-05',
          cashAmount: 1,
          splitAdjustedCashAmount: 1,
          distributionType: 'recurring',
          frequency: 4,
        },
      ],
    });
    assert.equal(result.grossDividends, 10);
    assert.equal(result.finalShares, 11);
    assert.equal(result.totalProfit, 10);
    assert.equal(result.dividendCount, 1);
  });

  it('stops instead of silently processing a special dividend', () => {
    assert.throws(() =>
      runBacktest(input, {
        ...marketData,
        dividends: [
          {
            id: 'special',
            exDate: '2024-01-03',
            payDate: '2024-01-05',
            cashAmount: 5,
            splitAdjustedCashAmount: 5,
            distributionType: 'special',
            frequency: 0,
          },
        ],
      }),
      BacktestError,
    );
  });

  it('computes peak-to-subsequent-trough drawdown', () => {
    const result = runBacktest(input, {
      ...marketData,
      prices: marketData.prices.map((bar, index) => ({
        ...bar,
        // The trough bar halves to 5, so its low must drop with the close to stay
        // a valid OHLC bar while preserving the intended 50% drawdown.
        high: index === 2 ? 10 : bar.high,
        low: index === 2 ? 5 : bar.low,
        close: index === 2 ? 5 : bar.close,
      })),
    });
    assert.ok(Math.abs(result.maxDrawdown.percent - (-50)) < 0.0001);
    assert.equal(result.maxDrawdown.troughDate, '2024-01-04');
    assert.equal(result.maxDrawdown.recoveryDate, '2024-01-05');
  });

  it('uses same-day pre-flow value so a gap-down contribution does not dilute TWR drawdown', () => {
    const result = runBacktest(
      {
        ...input,
        endDate: '2024-01-03',
        investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
      },
      {
        ...marketData,
        prices: [
          { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
          { date: '2024-01-03', open: 5, high: 5, low: 5, close: 5 },
        ],
      },
    );

    assert.equal(result.portfolio[1].preFlowValue, 50);
    assert.equal(result.portfolio[1].externalFlow, 100);
    assert.ok(Math.abs(result.portfolio[1].unitValue - 0.5) < 0.000001);
    assert.ok(Math.abs(result.maxDrawdown.percent - (-50)) < 0.000001);
  });

  it('values existing holdings at the execution high when issuing contribution units', () => {
    const result = runBacktest(
      {
        ...input,
        endDate: '2024-01-03',
        investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
      },
      {
        ...marketData,
        prices: [
          { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
          { date: '2024-01-03', open: 10, high: 20, low: 10, close: 10 },
        ],
      },
    );

    assert.equal(result.portfolio[1].preFlowValue, 200);
    assert.equal(result.portfolio[1].externalFlow, 100);
    assert.equal(result.portfolio[1].shares, 15);
    assert.equal(result.portfolio[1].value, 150);
    assert.ok(Math.abs(result.portfolio[1].unitValue - 1) < 0.000001);
    assert.equal(result.maxDrawdown.percent, 0);
  });

  it('ignores liquidation capital-gains tax for pretax and applies it for aftertax', () => {
    const liquidationInput: BacktestInput = {
      ...input,
      liquidateAtEnd: true,
      capitalGainsTaxRate: 20,
      fees: {
        ...input.fees,
        sell: { fixed: 1, perShare: 0, percentOfValue: 0, minimum: 0 },
      },
    };
    const gainsData: MarketData = {
      ...marketData,
      // The single buy executes at the first bar's high (10) and liquidation
      // sells at the last bar's close, so only the final bar needs to appreciate
      // to 12 to create the gain. Raising that bar's high to 12 keeps it a valid
      // OHLC bar without shifting the purchase price or the accounting.
      prices: marketData.prices.map((bar, index) =>
        index === marketData.prices.length - 1 ? { ...bar, high: 12, close: 12 } : bar,
      ),
    };

    const pretax = runBacktest(liquidationInput, gainsData);
    const aftertax = runBacktest({ ...liquidationInput, taxMode: 'after-tax' }, gainsData);

    // Single buy: 10 shares at high 10 → purchase principal 100, no buy fee.
    // Liquidation: gross 10 * close 12 = 120, sell fee 1.
    // Adjusted basis = 100 + 0 acquisition fees. Net realized = 120 - 1 = 119.
    // Taxable gain = 119 - 100 = 19 (net of the sell expense, per IRS Pub. 550).
    assert.equal(pretax.finalShares, 0);
    assert.equal(pretax.capitalGainsTax, 0);
    assert.equal(pretax.totalFees, 1);
    assert.equal(pretax.finalAmount, 119);
    assert.equal(pretax.transactions.at(-1)?.tax, 0);
    assert.equal(pretax.liquidation?.adjustedTaxBasis, 100);
    assert.equal(pretax.liquidation?.netAmountRealized, 119);
    assert.equal(pretax.liquidation?.taxableGain, 19);
    assert.equal(pretax.liquidation?.capitalGainsTax, 0);
    assert.ok(Math.abs(pretax.crossCheckDifference) < 1e-6);

    // 20% of the 19 net gain = 3.8. Ending cash = 120 - 1 sell fee - 3.8 tax = 115.2.
    assert.equal(aftertax.finalShares, 0);
    assert.equal(aftertax.capitalGainsTax, 3.8);
    assert.equal(aftertax.totalFees, 1);
    assert.ok(Math.abs(aftertax.finalAmount - 115.2) < 1e-9);
    assert.equal(aftertax.transactions.at(-1)?.tax, 3.8);
    assert.equal(aftertax.liquidation?.adjustedTaxBasis, 100);
    assert.equal(aftertax.liquidation?.netAmountRealized, 119);
    assert.equal(aftertax.liquidation?.taxableGain, 19);
    assert.ok(Math.abs(aftertax.crossCheckDifference) < 1e-6);
  });

  it('adds acquisition fees to the liquidation basis so buy commissions are not taxed as gain', () => {
    // A per-order buy fee raises the adjusted tax basis above the purchase
    // principal, shrinking the taxable gain relative to a fee-free basis.
    const liquidationInput: BacktestInput = {
      ...input,
      liquidateAtEnd: true,
      taxMode: 'after-tax',
      capitalGainsTaxRate: 10,
      fees: {
        ...input.fees,
        buy: { fixed: 2, perShare: 0, percentOfValue: 0, minimum: 0 },
        sell: { fixed: 3, perShare: 0, percentOfValue: 0, minimum: 0 },
      },
    };
    const gainsData: MarketData = {
      ...marketData,
      prices: marketData.prices.map((bar, index) =>
        index === marketData.prices.length - 1 ? { ...bar, high: 15, close: 15 } : bar,
      ),
    };

    const result = runBacktest(liquidationInput, gainsData);
    // $100 contribution, $2 buy fee → $98 buys 9.8 shares at high 10.
    assert.equal(result.finalShares, 0);
    assert.equal(result.purchaseCost, 98);
    assert.equal(result.acquisitionFees, 2);
    assert.equal(result.liquidation?.adjustedTaxBasis, 100);
    // Gross 9.8 * 15 = 147, sell fee 3 → net realized 144.
    assert.equal(result.liquidation?.sellFee, 3);
    assert.equal(result.liquidation?.netAmountRealized, 144);
    assert.equal(result.liquidation?.taxableGain, 44);
    assert.equal(result.liquidation?.capitalGainsTax, 4.4);
    // Total fees (2 buy + 3 sell) are each subtracted exactly once.
    assert.equal(result.totalFees, 5);
    assert.ok(Math.abs(result.crossCheckDifference) < 1e-6);
  });

  it('keeps unitization finite and records a near-total drawdown for a delisting-level collapse', () => {
    // A zero price is invalid market data, so a delisting is modeled with the
    // smallest positive price the provider would still report. The result is a
    // near-total (not exactly -100%) loss with a finite, positive unit value.
    const result = runBacktest(
      {
        ...input,
        endDate: '2024-01-03',
        investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
      },
      {
        ...marketData,
        prices: [
          { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
          { date: '2024-01-03', open: 0.01, high: 0.01, low: 0.01, close: 0.01 },
        ],
      },
    );

    assert.ok(Math.abs(result.portfolio[1].preFlowValue - 0.1) < 1e-9);
    assert.ok(result.portfolio[1].unitValue > 0);
    assert.ok(Number.isFinite(result.portfolio[1].unitValue));
    assert.ok(result.maxDrawdown.percent < -99 && result.maxDrawdown.percent > -100);
  });

  it('rejects hand-built market data that violates the OHLC economic invariants', () => {
    const highBelowClose: MarketData = {
      ...marketData,
      prices: marketData.prices.map((bar, index) =>
        index === 0 ? { ...bar, open: 10, high: 8, low: 7, close: 10 } : bar,
      ),
    };
    assert.throws(() => runBacktest(input, highBelowClose), BacktestError);

    const negativePrice: MarketData = {
      ...marketData,
      prices: marketData.prices.map((bar, index) =>
        index === 0 ? { ...bar, open: -1, high: 10, low: -2, close: 5 } : bar,
      ),
    };
    assert.throws(() => runBacktest(input, negativePrice), BacktestError);
  });
});

describe('dividend eligibility at the start boundary', () => {
  const dailyInput: BacktestInput = {
    ...input,
    endDate: '2024-01-08',
    investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
  };

  function withSingleDividend(exDate: string, payDate: string): MarketData {
    return {
      ...marketData,
      dividends: [
        {
          id: `div-${exDate}`,
          exDate,
          payDate,
          cashAmount: 1,
          splitAdjustedCashAmount: 1,
          distributionType: 'recurring',
          frequency: 4,
        },
      ],
    };
  }

  it('does not grant a dividend whose ex-date precedes the first trading session', () => {
    // The portfolio held nothing before 2024-01-02. An ex-date on 2023-12-28
    // must not be rolled forward and paid to shares bought during the run.
    const result = runBacktest(dailyInput, withSingleDividend('2023-12-28', '2024-01-04'));
    assert.equal(result.grossDividends, 0);
    assert.equal(result.dividendCount, 0);
  });

  it('excludes the same-day contribution buy from that session’s ex-date dividend', () => {
    // Jan 2 and Jan 3 buys leave 20 shares held before the Jan 4 ex-date
    // snapshot; the Jan 4 buy of 10 more shares is captured after the snapshot.
    const result = runBacktest(dailyInput, withSingleDividend('2024-01-04', '2024-01-08'));
    assert.equal(result.grossDividends, 20);
    assert.equal(result.dividendCount, 1);
  });

  it('pays shares held before a later ex-date but not the same-day purchase', () => {
    // 30 shares from Jan 2-4 are eligible on the Jan 5 ex-date; the Jan 5 buy
    // is not, so the gross dividend is 30, never 40.
    const result = runBacktest(dailyInput, withSingleDividend('2024-01-05', '2024-01-08'));
    assert.equal(result.grossDividends, 30);
    assert.equal(result.dividendCount, 1);
  });
});

describe('order principal precision', () => {
  it('never creates a positive share position for zero principal (0.001 share at $1)', () => {
    const oneDollar: MarketData = {
      ...marketData,
      prices: [{ date: '2024-01-02', open: 1, high: 1, low: 1, close: 1 }],
    };
    const result = runBacktest(
      {
        ...input,
        startDate: '2024-01-02',
        endDate: '2024-01-02',
        investment: { mode: 'shares', value: 0.001, intervalValue: 1, intervalUnit: 'years' },
      },
      oneDollar,
    );

    assert.equal(result.finalShares, 0.001);
    assert.ok(result.purchaseCost > 0);
    assert.ok(Math.abs(result.purchaseCost - 0.001) < 1e-9);
    assert.ok(result.totalContributions > 0);
    assert.ok(Math.abs(result.totalContributions - 0.001) < 1e-9);
    assert.ok(Math.abs(result.crossCheckDifference) < 1e-6);
  });

  it('preserves sub-cent residual cash and reconciles for a cash order', () => {
    const threeDollar: MarketData = {
      ...marketData,
      prices: [{ date: '2024-01-02', open: 3, high: 3, low: 3, close: 3 }],
    };
    const result = runBacktest(
      {
        ...input,
        startDate: '2024-01-02',
        endDate: '2024-01-02',
        investment: { mode: 'amount', value: 10, intervalValue: 1, intervalUnit: 'years' },
      },
      threeDollar,
    );

    // $10 buys 3.333 shares at $3 for $9.999; the $0.001 remainder stays as cash.
    assert.equal(result.finalShares, 3.333);
    assert.ok(Math.abs(result.purchaseCost - 9.999) < 1e-9);
    assert.ok(Math.abs(result.cash - 0.001) < 1e-9);
    assert.equal(result.totalContributions, 10);
    assert.ok(Math.abs(result.crossCheckDifference) < 1e-6);
  });

  it('subtracts each fee and tax exactly once across a buy and a dividend', () => {
    const feeInput: BacktestInput = {
      ...input,
      taxMode: 'after-tax',
      dividendTaxRate: 25,
      fees: { ...input.fees, buy: { fixed: 1, perShare: 0, percentOfValue: 0, minimum: 0 } },
    };
    const withDividend: MarketData = {
      ...marketData,
      dividends: [
        {
          id: 'div-once',
          exDate: '2024-01-03',
          payDate: '2024-01-05',
          cashAmount: 1,
          splitAdjustedCashAmount: 1,
          distributionType: 'recurring',
          frequency: 4,
        },
      ],
    };

    const result = runBacktest(feeInput, withDividend);
    const parts =
      result.priceReturn +
      result.grossDividends -
      result.dividendTax -
      result.capitalGainsTax -
      result.totalFees;

    assert.ok(result.totalFees > 0);
    assert.ok(result.dividendTax > 0);
    assert.ok(Math.abs(parts - result.totalProfit) < 1e-6);
    assert.ok(Math.abs(result.crossCheckDifference) < 1e-6);
  });
});

describe('portfolio aggregation', () => {
  it('combines holdings, labels transactions, and calculates cash-flow-neutral drawdown', () => {
    const first = runBacktest(input, {
      ...marketData,
      // The trough bar halves to 5, so its low must drop with the close to stay a
      // valid OHLC bar while preserving the intended -25% aggregate drawdown.
      prices: marketData.prices.map((bar, index) => ({
        ...bar,
        low: index === 2 ? 5 : bar.low,
        close: index === 2 ? 5 : 10,
      })),
    });
    const second = runBacktest({ ...input, ticker: 'OTHER' }, { ...marketData, ticker: 'OTHER', name: 'Other Company' });
    const portfolio = aggregateBacktestResults([first, second]);

    assert.equal(portfolio?.holdingsCount, 2);
    assert.equal(portfolio?.totalContributions, 200);
    assert.equal(portfolio?.finalAmount, 200);
    assert.ok(Math.abs((portfolio?.maxDrawdown.percent ?? 0) - (-25)) < 0.0001);
    assert.deepEqual(portfolio?.transactions.map((transaction) => transaction.ticker), ['TEST', 'OTHER']);
  });

  it('uses aggregate same-day pre-flow value for gap-down contributions', () => {
    const recurringInput: BacktestInput = {
      ...input,
      endDate: '2024-01-03',
      investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
    };
    const gapDownData: MarketData = {
      ...marketData,
      prices: [
        { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
        { date: '2024-01-03', open: 5, high: 5, low: 5, close: 5 },
      ],
    };
    const first = runBacktest(recurringInput, gapDownData);
    const second = runBacktest(
      { ...recurringInput, ticker: 'OTHER' },
      { ...gapDownData, ticker: 'OTHER', name: 'Other Company' },
    );
    const portfolio = aggregateBacktestResults([first, second]);

    assert.equal(portfolio?.portfolio[1].preFlowValue, 100);
    assert.equal(portfolio?.portfolio[1].externalFlow, 200);
    assert.ok(Math.abs((portfolio?.portfolio[1].unitValue ?? 0) - 0.5) < 0.000001);
    assert.ok(Math.abs((portfolio?.maxDrawdown.percent ?? 0) - (-50)) < 0.000001);
  });

  it('aggregates transaction-high pre-flow values without inventing drawdown', () => {
    const recurringInput: BacktestInput = {
      ...input,
      endDate: '2024-01-03',
      investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
    };
    const intradayRoundTripData: MarketData = {
      ...marketData,
      prices: [
        { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
        { date: '2024-01-03', open: 10, high: 20, low: 10, close: 10 },
      ],
    };
    const first = runBacktest(recurringInput, intradayRoundTripData);
    const second = runBacktest(
      { ...recurringInput, ticker: 'OTHER' },
      { ...intradayRoundTripData, ticker: 'OTHER', name: 'Other Company' },
    );
    const portfolio = aggregateBacktestResults([first, second]);

    assert.equal(portfolio?.portfolio[1].preFlowValue, 400);
    assert.equal(portfolio?.portfolio[1].externalFlow, 200);
    assert.equal(portfolio?.portfolio[1].value, 300);
    assert.ok(Math.abs((portfolio?.portfolio[1].unitValue ?? 0) - 1) < 0.000001);
    assert.equal(portfolio?.maxDrawdown.percent, 0);
  });

  it('keeps aggregate unitization finite through a delisting-level collapse', () => {
    const wipedOut = runBacktest(
      {
        ...input,
        endDate: '2024-01-03',
        investment: { mode: 'amount', value: 100, intervalValue: 1, intervalUnit: 'trading-days' },
      },
      {
        ...marketData,
        prices: [
          { date: '2024-01-02', open: 10, high: 10, low: 10, close: 10 },
          { date: '2024-01-03', open: 0.01, high: 0.01, low: 0.01, close: 0.01 },
        ],
      },
    );
    const portfolio = aggregateBacktestResults([wipedOut]);

    assert.ok((portfolio?.portfolio[1].unitValue ?? 0) > 0);
    assert.ok(Number.isFinite(portfolio?.portfolio[1].unitValue));
    assert.ok(
      (portfolio?.maxDrawdown.percent ?? 0) < -99 && (portfolio?.maxDrawdown.percent ?? 0) > -100,
    );
  });
});

describe('fee-component audit and realized gain/loss', () => {
  const bigLiquidation: BacktestInput = {
    ...input,
    investment: { mode: 'amount', value: 100_000, intervalValue: 1, intervalUnit: 'years' },
    liquidateAtEnd: true,
    taxMode: 'after-tax',
    capitalGainsTaxRate: 20,
  };

  it('records SEC and FINRA TAF sell components from a preset on the liquidation and result', () => {
    const result = runBacktest({ ...bigLiquidation, fees: getBrokerPreset('robinhood') }, marketData);
    // $100,000 buys 10,000 shares at high 10; liquidation sells 10,000 × close 10 = $100,000.
    assert.equal(result.finalShares, 0);
    assert.equal(result.liquidation?.feeComponents.find((c) => c.kind === 'sec-31')?.amount, 2.06);
    assert.equal(result.liquidation?.feeComponents.find((c) => c.kind === 'finra-taf')?.amount, 1.95);
    assert.equal(result.liquidation?.sellFee, 4.01);
    // The result-level breakdown surfaces the same regulatory lines for the audit and PDF.
    assert.ok(result.feeComponents.some((c) => c.kind === 'sec-31' && c.amount === 2.06));
    assert.ok(Math.abs(result.crossCheckDifference) < 1e-6);
  });

  it('reports a negative realized gain/loss and a floored taxable gain on a loss', () => {
    const lossData: MarketData = {
      ...marketData,
      prices: marketData.prices.map((bar, index) =>
        index === marketData.prices.length - 1 ? { ...bar, high: 10, low: 4, close: 4 } : bar,
      ),
    };
    const result = runBacktest({ ...bigLiquidation, fees: getBrokerPreset('custom') }, lossData);
    // Basis 100,000; sell 10,000 × 4 = 40,000, no fees → realized −60,000.
    assert.equal(result.liquidation?.realizedGainLoss, -60_000);
    assert.equal(result.liquidation?.taxableGain, 0);
    assert.equal(result.capitalGainsTax, 0);
  });

  it('defers the holding capital-gain tax but keeps the realized gain when flagged', () => {
    const gainsData: MarketData = {
      ...marketData,
      prices: marketData.prices.map((bar, index) =>
        index === marketData.prices.length - 1 ? { ...bar, high: 12, close: 12 } : bar,
      ),
    };
    const standalone = runBacktest({ ...bigLiquidation, fees: getBrokerPreset('custom') }, gainsData);
    const deferred = runBacktest(
      { ...bigLiquidation, fees: getBrokerPreset('custom'), deferCapitalGainsTax: true },
      gainsData,
    );

    assert.equal(standalone.capitalGainsTax, 4_000); // 20,000 gain × 20%
    assert.equal(standalone.finalAmount, 116_000);
    assert.equal(deferred.capitalGainsTax, 0);
    assert.equal(deferred.finalAmount, 120_000);
    assert.equal(deferred.liquidation?.realizedGainLoss, 20_000);
    assert.equal(deferred.liquidation?.taxableGain, 20_000);
    assert.equal(deferred.liquidation?.capitalGainsTax, 0);
  });
});
