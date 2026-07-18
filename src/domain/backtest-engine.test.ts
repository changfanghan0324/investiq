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
        high: index === 2 ? 10 : bar.high,
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
      prices: marketData.prices.map((bar) => ({ ...bar, close: 12 })),
    };

    const pretax = runBacktest(liquidationInput, gainsData);
    const aftertax = runBacktest({ ...liquidationInput, taxMode: 'after-tax' }, gainsData);

    assert.equal(pretax.finalShares, 0);
    assert.equal(pretax.capitalGainsTax, 0);
    assert.equal(pretax.totalFees, 1);
    assert.equal(pretax.finalAmount, 119);
    assert.equal(pretax.transactions.at(-1)?.tax, 0);
    assert.ok(Math.abs(pretax.crossCheckDifference) < 0.001);

    assert.equal(aftertax.finalShares, 0);
    assert.equal(aftertax.capitalGainsTax, 4);
    assert.equal(aftertax.totalFees, 1);
    assert.equal(aftertax.finalAmount, 115);
    assert.equal(aftertax.transactions.at(-1)?.tax, 4);
    assert.ok(Math.abs(aftertax.crossCheckDifference) < 0.001);
  });

  it('keeps unitization finite and records a full drawdown when value reaches zero', () => {
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
          { date: '2024-01-03', open: 0, high: 0, low: 0, close: 0 },
        ],
      },
    );

    assert.equal(result.portfolio[1].preFlowValue, 0);
    assert.equal(result.portfolio[1].unitValue, 0);
    assert.ok(Number.isFinite(result.portfolio[1].unitValue));
    assert.equal(result.maxDrawdown.percent, -100);
  });
});

describe('portfolio aggregation', () => {
  it('combines holdings, labels transactions, and calculates cash-flow-neutral drawdown', () => {
    const first = runBacktest(input, {
      ...marketData,
      prices: marketData.prices.map((bar, index) => ({ ...bar, close: index === 2 ? 5 : 10 })),
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

  it('keeps aggregate zero-value unitization finite', () => {
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
          { date: '2024-01-03', open: 0, high: 0, low: 0, close: 0 },
        ],
      },
    );
    const portfolio = aggregateBacktestResults([wipedOut]);

    assert.equal(portfolio?.portfolio[1].unitValue, 0);
    assert.ok(Number.isFinite(portfolio?.portfolio[1].unitValue));
    assert.equal(portfolio?.maxDrawdown.percent, -100);
  });
});
