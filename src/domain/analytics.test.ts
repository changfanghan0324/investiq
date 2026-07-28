import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  alignReturns,
  analyzeConcentration,
  annualizedSharpeRatio,
  annualizedVolatility,
  beta,
  compoundAnnualGrowthRate,
  compoundDailyReturns,
  correlation,
  cumulativePriceReturns,
  dailyCloseReturns,
  maxCloseDrawdown,
  portfolioDailyReturns,
  simpleMovingAverage,
  simpleMovingAverages,
  validatePriceSeries,
  validateWeights,
  TRADING_DAYS_PER_YEAR,
} from '@/domain/analytics';
import type { DatedValue } from '@/domain/analytics';
import type { DateString, PriceBar } from '@/types/backtest';

function bar(date: DateString, close: number): PriceBar {
  return { date, open: close, high: close, low: close, close };
}

function bars(entries: [DateString, number][]): PriceBar[] {
  return entries.map(([date, close]) => bar(date, close));
}

function returns(entries: [DateString, number][]): DatedValue[] {
  return entries.map(([date, value]) => ({ date, value }));
}

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe('price series validation', () => {
  it('rejects a close that is not a finite positive number', () => {
    assert.throws(
      () => validatePriceSeries(bars([['2024-01-02', 100], ['2024-01-03', 0]])),
      AnalyticsError,
    );
    assert.throws(
      () => validatePriceSeries(bars([['2024-01-02', 100], ['2024-01-03', -5]])),
      AnalyticsError,
    );
    assert.throws(
      () => validatePriceSeries(bars([['2024-01-02', 100], ['2024-01-03', Number.NaN]])),
      AnalyticsError,
    );
  });

  it('rejects out-of-order and duplicate dates, and an empty series', () => {
    assert.throws(
      () => validatePriceSeries(bars([['2024-01-03', 100], ['2024-01-02', 101]])),
      AnalyticsError,
    );
    assert.throws(
      () => validatePriceSeries(bars([['2024-01-02', 100], ['2024-01-02', 101]])),
      AnalyticsError,
    );
    assert.throws(() => validatePriceSeries([]), AnalyticsError);
  });

  it('rejects a date that is not an ISO calendar date', () => {
    assert.throws(() => validatePriceSeries([bar('01/02/2024', 100)]), AnalyticsError);
  });
});

describe('return series', () => {
  it('stamps each daily close return with the later of the two dates', () => {
    const result = dailyCloseReturns(
      bars([['2024-01-02', 100], ['2024-01-03', 110], ['2024-01-04', 99]]),
    );

    assert.equal(result.length, 2);
    assert.equal(result[0].date, '2024-01-03');
    assertClose(result[0].value, 0.1);
    assert.equal(result[1].date, '2024-01-04');
    assertClose(result[1].value, -0.1);
  });

  it('reports zero daily and cumulative return for a constant price', () => {
    const flat = bars([['2024-01-02', 50], ['2024-01-03', 50], ['2024-01-04', 50]]);

    assert.deepEqual(
      dailyCloseReturns(flat).map((point) => point.value),
      [0, 0],
    );
    assert.deepEqual(
      cumulativePriceReturns(flat).map((point) => point.value),
      [0, 0, 0],
    );
  });

  it('measures cumulative price return from the first close', () => {
    const result = cumulativePriceReturns(
      bars([['2024-01-02', 200], ['2024-01-03', 220], ['2024-01-04', 150]]),
    );

    assert.deepEqual(result.map((point) => point.date), ['2024-01-02', '2024-01-03', '2024-01-04']);
    assertClose(result[0].value, 0);
    assertClose(result[1].value, 0.1);
    assertClose(result[2].value, -0.25);
  });

  it('compounds a daily return series rather than summing it', () => {
    const result = compoundDailyReturns(returns([['2024-01-03', 0.1], ['2024-01-04', 0.1]]));

    // 1.1 × 1.1 = 1.21, so the cumulative return is 21%, not 20%.
    assertClose(result[1].value, 0.21);
  });
});

describe('compound annual growth rate', () => {
  it('annualizes over actual calendar days, including the leap day', () => {
    // 2016-01-01 → 2020-01-01 is 1461 days = exactly 4 × 365.25, and the price doubles.
    const result = compoundAnnualGrowthRate(bars([['2016-01-01', 100], ['2020-01-01', 200]]));

    assertClose(result, 2 ** 0.25 - 1);
  });

  it('reports zero growth for a constant price and undefined when no time has elapsed', () => {
    assertClose(compoundAnnualGrowthRate(bars([['2020-01-01', 100], ['2024-01-01', 100]])), 0);
    assert.equal(compoundAnnualGrowthRate(bars([['2024-01-02', 100]])), undefined);
  });
});

describe('volatility and Sharpe', () => {
  it('annualizes the sample standard deviation with 252 trading days', () => {
    const series = returns([
      ['2024-01-03', 0.01],
      ['2024-01-04', -0.01],
      ['2024-01-05', 0.01],
      ['2024-01-08', -0.01],
    ]);

    // Mean 0, sample variance = (4 × 0.0001) / 3, annualized by sqrt(252).
    assertClose(annualizedVolatility(series), Math.sqrt(0.0004 / 3) * Math.sqrt(252));
  });

  it('reports zero volatility for a constant price and undefined for a single return', () => {
    const flat = dailyCloseReturns(bars([['2024-01-02', 50], ['2024-01-03', 50], ['2024-01-04', 50]]));

    assert.equal(annualizedVolatility(flat), 0);
    assert.equal(annualizedVolatility(returns([['2024-01-03', 0.01]])), undefined);
  });

  it('returns undefined Sharpe when volatility is zero', () => {
    const flat = dailyCloseReturns(bars([['2024-01-02', 50], ['2024-01-03', 50], ['2024-01-04', 50]]));

    assert.equal(annualizedSharpeRatio(flat, 0.04), undefined);
  });

  it('computes Sharpe from mean excess return over annualized volatility', () => {
    const series = returns([['2024-01-03', 0.01], ['2024-01-04', 0.03]]);

    // Risk-free 0: mean 0.02, sample sd sqrt(0.0002), scaled by sqrt(252).
    assertClose(
      annualizedSharpeRatio(series, 0),
      (0.02 / Math.sqrt(0.0002)) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    );
  });

  it('lowers Sharpe as the explicit risk-free rate rises, and rejects a rate at or below -1', () => {
    const series = returns([['2024-01-03', 0.01], ['2024-01-04', 0.03]]);
    const atZero = annualizedSharpeRatio(series, 0)!;
    const atFourPercent = annualizedSharpeRatio(series, 0.04)!;

    assert.ok(atFourPercent < atZero);
    assert.throws(() => annualizedSharpeRatio(series, -1), AnalyticsError);
  });
});

describe('maximum drawdown', () => {
  it('reports the worst close-to-close decline with peak, trough, and recovery dates', () => {
    const result = maxCloseDrawdown(
      bars([
        ['2024-01-02', 100],
        ['2024-01-03', 120],
        ['2024-01-04', 60],
        ['2024-01-05', 90],
        ['2024-01-08', 130],
      ]),
    );

    // Peak 120 on 01-03, trough 60 on 01-04 → 60/120 - 1 = -50%, recovered at 130 on 01-08.
    assertClose(result.drawdown, -0.5);
    assert.equal(result.peakDate, '2024-01-03');
    assert.equal(result.troughDate, '2024-01-04');
    assert.equal(result.recoveryDate, '2024-01-08');
  });

  it('leaves recovery undefined when the peak is never reclaimed', () => {
    const result = maxCloseDrawdown(
      bars([['2024-01-02', 100], ['2024-01-03', 80], ['2024-01-04', 99]]),
    );

    assertClose(result.drawdown, -0.2);
    assert.equal(result.peakDate, '2024-01-02');
    assert.equal(result.troughDate, '2024-01-03');
    assert.equal(result.recoveryDate, undefined);
  });

  it('reports no drawdown and no dates for a series that never declines', () => {
    assert.deepEqual(maxCloseDrawdown(bars([['2024-01-02', 100], ['2024-01-03', 101]])), {
      drawdown: 0,
    });
  });
});

describe('simple moving averages', () => {
  it('emits a point only once the window is full, stamped with its last date', () => {
    const series = bars([
      ['2024-01-02', 100],
      ['2024-01-03', 102],
      ['2024-01-04', 104],
      ['2024-01-05', 106],
    ]);

    assert.deepEqual(simpleMovingAverage(series, 3), [
      { date: '2024-01-04', value: 102 },
      { date: '2024-01-05', value: 104 },
    ]);
    assert.deepEqual(simpleMovingAverage(series, 5), []);
  });

  it('returns one series per caller-selected window and rejects an invalid window', () => {
    const series = bars([['2024-01-02', 10], ['2024-01-03', 20], ['2024-01-04', 30]]);

    assert.deepEqual(
      simpleMovingAverages(series, [1, 2]).map((entry) => [entry.window, entry.points.length]),
      [[1, 3], [2, 2]],
    );
    assert.throws(() => simpleMovingAverage(series, 0), AnalyticsError);
    assert.throws(() => simpleMovingAverage(series, 1.5), AnalyticsError);
  });
});

describe('beta and correlation', () => {
  it('measures beta and correlation of an asset that moves twice the benchmark', () => {
    const benchmark = returns([['2024-01-03', 0.01], ['2024-01-04', 0.02], ['2024-01-05', 0.03]]);
    const asset = returns([['2024-01-03', 0.02], ['2024-01-04', 0.04], ['2024-01-05', 0.06]]);

    assertClose(beta(asset, benchmark), 2);
    assertClose(correlation(asset, benchmark), 1);
    assertClose(correlation(benchmark, benchmark), 1);
  });

  it('uses only overlapping dates, ignoring days one series does not have', () => {
    const benchmark = returns([['2024-01-04', 0.02], ['2024-01-05', 0.03]]);
    const asset = returns([
      ['2024-01-03', 5],
      ['2024-01-04', 0.04],
      ['2024-01-05', 0.06],
      ['2024-01-08', -9],
    ]);

    assert.deepEqual(alignReturns(asset, benchmark), [
      { date: '2024-01-04', a: 0.04, b: 0.02 },
      { date: '2024-01-05', a: 0.06, b: 0.03 },
    ]);
    // The non-overlapping outliers are dropped, so this is still exactly 2×.
    assertClose(beta(asset, benchmark), 2);
    assertClose(correlation(asset, benchmark), 1);
  });

  it('measures -1 correlation for a perfectly inverse series', () => {
    const benchmark = returns([['2024-01-03', 0.01], ['2024-01-04', 0.02], ['2024-01-05', 0.03]]);
    const inverse = returns([['2024-01-03', -0.01], ['2024-01-04', -0.02], ['2024-01-05', -0.03]]);

    assertClose(correlation(inverse, benchmark), -1);
    assertClose(beta(inverse, benchmark), -1);
  });

  it('returns undefined for insufficient overlap or a flat series', () => {
    const benchmark = returns([['2024-01-03', 0.01], ['2024-01-04', 0.02]]);
    const oneOverlap = returns([['2024-01-04', 0.02], ['2024-01-08', 0.05]]);
    const flat = returns([['2024-01-03', 0], ['2024-01-04', 0]]);

    assert.equal(beta(oneOverlap, benchmark), undefined);
    assert.equal(correlation(oneOverlap, benchmark), undefined);
    assert.equal(beta(benchmark, flat), undefined);
    assert.equal(correlation(benchmark, flat), undefined);
  });
});

describe('weighted portfolio returns', () => {
  it('matches the asset itself for a single holding at full weight', () => {
    const assetReturns = dailyCloseReturns(
      bars([['2024-01-02', 100], ['2024-01-03', 110], ['2024-01-04', 99]]),
    );

    assert.deepEqual(
      portfolioDailyReturns([{ symbol: 'AAA', weight: 1, returns: assetReturns }]),
      assetReturns,
    );
  });

  it('weight-averages each day for a daily-rebalanced portfolio', () => {
    const result = portfolioDailyReturns([
      { symbol: 'AAA', weight: 0.5, returns: returns([['2024-01-03', 0.1], ['2024-01-04', -0.1]]) },
      { symbol: 'BBB', weight: 0.5, returns: returns([['2024-01-03', 0], ['2024-01-04', 0.2]]) },
    ]);

    assert.deepEqual(result.map((point) => point.date), ['2024-01-03', '2024-01-04']);
    assertClose(result[0].value, 0.05);
    assertClose(result[1].value, 0.05);
  });

  it('keeps only dates where every holding has a return', () => {
    const result = portfolioDailyReturns([
      {
        symbol: 'AAA',
        weight: 0.5,
        returns: returns([['2024-01-03', 0.1], ['2024-01-04', 0.1], ['2024-01-05', 0.1]]),
      },
      { symbol: 'BBB', weight: 0.5, returns: returns([['2024-01-04', 0.3]]) },
    ]);

    assert.deepEqual(result, [{ date: '2024-01-04', value: 0.2 }]);
  });

  it('rejects weights that do not sum to 1 and weights that are negative', () => {
    const aaa = returns([['2024-01-03', 0.1]]);
    const bbb = returns([['2024-01-03', 0.2]]);

    assert.throws(
      () =>
        portfolioDailyReturns([
          { symbol: 'AAA', weight: 0.5, returns: aaa },
          { symbol: 'BBB', weight: 0.3, returns: bbb },
        ]),
      AnalyticsError,
    );
    assert.throws(
      () =>
        portfolioDailyReturns([
          { symbol: 'AAA', weight: 1.2, returns: aaa },
          { symbol: 'BBB', weight: -0.2, returns: bbb },
        ]),
      AnalyticsError,
    );
    assert.throws(() => validateWeights([]), AnalyticsError);
  });

  it('accepts weights that sum to 1 only within floating-point tolerance', () => {
    assert.doesNotThrow(() =>
      validateWeights([
        { symbol: 'AAA', weight: 1 / 3 },
        { symbol: 'BBB', weight: 1 / 3 },
        { symbol: 'CCC', weight: 1 / 3 },
      ]),
    );
  });
});

describe('concentration diagnostics', () => {
  it('reports HHI and effective holdings for an equally weighted portfolio', () => {
    const result = analyzeConcentration([
      { symbol: 'AAA', weight: 0.25 },
      { symbol: 'BBB', weight: 0.25 },
      { symbol: 'CCC', weight: 0.25 },
      { symbol: 'DDD', weight: 0.25 },
    ]);

    assertClose(result.herfindahlIndex, 0.25);
    assertClose(result.effectiveHoldings, 4);
    assertClose(result.largestWeight, 0.25);
    assert.deepEqual(result.flags, []);
    assert.deepEqual(result.sectorWeights, [{ sector: 'unclassified', weight: 1 }]);
  });

  it('flags an oversized holding and an oversized sector', () => {
    const result = analyzeConcentration([
      { symbol: 'AAA', weight: 0.45, sector: 'Technology' },
      { symbol: 'BBB', weight: 0.25, sector: 'Technology' },
      { symbol: 'CCC', weight: 0.2, sector: 'Health Care' },
      { symbol: 'DDD', weight: 0.1, sector: 'Energy' },
    ]);

    assert.equal(result.largestWeightSymbol, 'AAA');
    assertClose(result.herfindahlIndex, 0.315);
    assertClose(result.effectiveHoldings, 1 / 0.315);
    assert.deepEqual(result.flags, [
      { kind: 'holding', label: 'AAA', weight: 0.45, threshold: 0.4 },
      { kind: 'sector', label: 'Technology', weight: 0.7, threshold: 0.5 },
    ]);
  });

  it('does not flag weights sitting exactly on the thresholds', () => {
    const result = analyzeConcentration([
      { symbol: 'AAA', weight: 0.4, sector: 'Technology' },
      { symbol: 'BBB', weight: 0.1, sector: 'Technology' },
      { symbol: 'CCC', weight: 0.3, sector: 'Health Care' },
      { symbol: 'DDD', weight: 0.2, sector: 'Energy' },
    ]);

    // Largest holding is exactly 40% and Technology is exactly 50%; both flags are strict.
    assertClose(result.sectorWeights[0].weight, 0.5);
    assert.deepEqual(result.flags, []);
  });

  it('never flags the unclassified bucket, even when it dominates', () => {
    const result = analyzeConcentration([
      { symbol: 'AAA', weight: 0.3 },
      { symbol: 'BBB', weight: 0.3, sector: '   ' },
      { symbol: 'CCC', weight: 0.2, sector: 'Energy' },
      { symbol: 'DDD', weight: 0.2, sector: 'Energy' },
    ]);

    assert.deepEqual(result.sectorWeights, [
      { sector: 'unclassified', weight: 0.6 },
      { sector: 'Energy', weight: 0.4 },
    ]);
    assert.deepEqual(result.flags, []);
  });
});
