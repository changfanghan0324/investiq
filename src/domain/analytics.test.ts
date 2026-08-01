import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  INVERSE_VOLATILITY_MAX_SERIES,
  LIMITED_SAMPLE_OBSERVATIONS,
  MIN_RISK_OBSERVATIONS,
  alignReturns,
  analyzeConcentration,
  annualizedSharpeRatio,
  annualizedSortinoRatio,
  annualizedVolatility,
  beta,
  compoundAnnualGrowthRate,
  compoundDailyReturns,
  correlation,
  cumulativePriceReturns,
  dailyCloseReturns,
  downsideDeviation,
  globalMinimumVarianceWeights,
  historicalValueAtRisk,
  inverseVolatilityWeights,
  jensenAlpha,
  MIN_VARIANCE_MAX_SERIES,
  maxCloseDrawdown,
  portfolioDailyReturns,
  resolveReturnBasis,
  riskSampleStatus,
  simpleMovingAverage,
  simpleMovingAverages,
  toReturnBasisBars,
  validatePriceSeries,
  validateWeights,
  TRADING_DAYS_PER_YEAR,
} from '@/domain/analytics';
import type { DatedValue } from '@/domain/analytics';
import type { DateString, PriceBar } from '@/types/backtest';
import { addDays } from '@/utils/date';

function bar(date: DateString, close: number): PriceBar {
  return { date, open: close, high: close, low: close, close };
}

function bars(entries: [DateString, number][]): PriceBar[] {
  return entries.map(([date, close]) => bar(date, close));
}

function returns(entries: [DateString, number][]): DatedValue[] {
  return entries.map(([date, value]) => ({ date, value }));
}

/** `count` dated returns on consecutive calendar days, valued by `valueAt`. */
function seriesReturns(
  count: number,
  valueAt: (index: number) => number,
  start: DateString = '2024-01-02',
): DatedValue[] {
  return Array.from({ length: count }, (unused, index) => ({
    date: addDays(start, index),
    value: valueAt(index),
  }));
}

function sampleMean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sampleStdDev(values: number[]): number {
  const mean = sampleMean(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Independent target downside deviation: RMS shortfall below `target`, averaged over every value. */
function targetDownsideDeviation(values: number[], target: number): number {
  const sum = values.reduce((total, value) => {
    const shortfall = Math.min(0, value - target);
    return total + shortfall * shortfall;
  }, 0);
  return Math.sqrt(sum / values.length);
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
  it('is unavailable below 60 returns and available at exactly 60', () => {
    const under = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => (index % 2 === 0 ? 0.01 : -0.01));
    const at = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.01 : -0.01));

    assert.equal(annualizedVolatility(under), undefined);
    assert.equal(annualizedSharpeRatio(under, 0), undefined);
    assert.ok(annualizedVolatility(at) !== undefined);
    assert.ok(annualizedSharpeRatio(at, 0) !== undefined);
  });

  it('annualizes the sample standard deviation with 252 trading days', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.01 : -0.01));
    const values = series.map((point) => point.value);

    assertClose(annualizedVolatility(series), sampleStdDev(values) * Math.sqrt(TRADING_DAYS_PER_YEAR));
  });

  it('reports zero volatility for a constant series with enough observations', () => {
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);

    assert.equal(annualizedVolatility(flat), 0);
  });

  it('returns undefined Sharpe when volatility is zero', () => {
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);

    assert.equal(annualizedSharpeRatio(flat, 0.04), undefined);
  });

  it('computes Sharpe from mean excess return over annualized volatility', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.01 : 0.03));
    const values = series.map((point) => point.value);
    const expected =
      ((sampleMean(values) - 0) / sampleStdDev(values)) * Math.sqrt(TRADING_DAYS_PER_YEAR);

    assertClose(annualizedSharpeRatio(series, 0), expected);
  });

  it('lowers Sharpe as the explicit risk-free rate rises, and rejects a rate at or below -1', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.01 : 0.03));
    const atZero = annualizedSharpeRatio(series, 0)!;
    const atFourPercent = annualizedSharpeRatio(series, 0.04)!;

    assert.ok(atFourPercent < atZero);
    assert.throws(() => annualizedSharpeRatio(series, -1), AnalyticsError);
  });
});

describe('risk sample sufficiency', () => {
  it('flags fewer than 60 observations as insufficient', () => {
    const status = riskSampleStatus(MIN_RISK_OBSERVATIONS - 1);
    assert.deepEqual(status, { observations: 59, sufficient: false, limited: false });
  });

  it('flags 60 to 251 observations as a limited sample', () => {
    assert.deepEqual(riskSampleStatus(MIN_RISK_OBSERVATIONS), {
      observations: 60,
      sufficient: true,
      limited: true,
    });
    assert.deepEqual(riskSampleStatus(LIMITED_SAMPLE_OBSERVATIONS - 1), {
      observations: 251,
      sufficient: true,
      limited: true,
    });
  });

  it('clears the limited flag at a full trading year', () => {
    assert.deepEqual(riskSampleStatus(LIMITED_SAMPLE_OBSERVATIONS), {
      observations: 252,
      sufficient: true,
      limited: false,
    });
  });
});

describe('return basis selection', () => {
  it('leaves price-basis bars unchanged and moves the adjusted close into total-basis bars', () => {
    const priced: PriceBar[] = [
      { date: '2024-01-02', open: 10, high: 11, low: 9, close: 10, adjustedClose: 8 },
      { date: '2024-01-03', open: 12, high: 13, low: 11, close: 12, adjustedClose: 9 },
    ];

    assert.equal(toReturnBasisBars(priced, 'price'), priced);
    assert.deepEqual(
      toReturnBasisBars(priced, 'total').map((entry) => entry.close),
      [8, 9],
    );
  });

  it('refuses a total basis when any bar lacks an adjusted close', () => {
    const partial: PriceBar[] = [
      { date: '2024-01-02', open: 10, high: 11, low: 9, close: 10, adjustedClose: 8 },
      { date: '2024-01-03', open: 12, high: 13, low: 11, close: 12 },
    ];

    assert.throws(() => toReturnBasisBars(partial, 'total'), AnalyticsError);
  });

  it('chooses total return only when every series has adjusted-close coverage', () => {
    assert.equal(resolveReturnBasis(['yahoo-adjusted-close', 'yahoo-adjusted-close']), 'total');
    assert.equal(resolveReturnBasis(['yahoo-adjusted-close', 'unavailable']), 'price');
    assert.equal(resolveReturnBasis(['demo', 'demo']), 'price');
    assert.equal(resolveReturnBasis([]), 'price');
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
  it('is unavailable below 60 overlapping returns and available at 60', () => {
    const bench59 = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => 0.001 * ((index % 9) + 1));
    const asset59 = bench59.map((point) => ({ date: point.date, value: point.value * 2 }));
    assert.equal(beta(asset59, bench59), undefined);
    assert.equal(correlation(asset59, bench59), undefined);

    const bench60 = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    const asset60 = bench60.map((point) => ({ date: point.date, value: point.value * 2 }));
    assert.ok(beta(asset60, bench60) !== undefined);
    assert.ok(correlation(asset60, bench60) !== undefined);
  });

  it('measures beta and correlation of an asset that moves twice the benchmark', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    const asset = benchmark.map((point) => ({ date: point.date, value: point.value * 2 }));

    assertClose(beta(asset, benchmark), 2);
    assertClose(correlation(asset, benchmark), 1);
    assertClose(correlation(benchmark, benchmark), 1);
  });

  it('inner-joins on date, dropping days one series does not have', () => {
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
  });

  it('uses only overlapping dates over a sufficient sample', () => {
    const benchmark = [
      ...seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1), '2024-02-01'),
      { date: '2024-01-01', value: 9 },
    ];
    const asset = [
      { date: '2024-05-01', value: -9 },
      ...seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.002 * ((index % 9) + 1), '2024-02-01'),
    ];

    // The non-overlapping outliers are dropped, so this is still exactly 2×.
    assertClose(beta(asset, benchmark), 2);
    assertClose(correlation(asset, benchmark), 1);
  });

  it('measures -1 correlation for a perfectly inverse series', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    const inverse = benchmark.map((point) => ({ date: point.date, value: -point.value }));

    assertClose(correlation(inverse, benchmark), -1);
    assertClose(beta(inverse, benchmark), -1);
  });

  it('returns undefined for insufficient overlap or a flat series', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    const oneOverlap = returns([['2024-01-04', 0.02], ['2024-01-08', 0.05]]);
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);

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

describe('Sortino ratio and downside deviation', () => {
  it('is unavailable below 60 returns and available at exactly 60', () => {
    const under = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => (index % 2 === 0 ? 0.02 : -0.01));
    const at = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.01));

    assert.equal(annualizedSortinoRatio(under, 0), undefined);
    assert.equal(downsideDeviation(under, 0), undefined);
    assert.ok(annualizedSortinoRatio(at, 0) !== undefined);
    assert.ok(downsideDeviation(at, 0) !== undefined);
  });

  it('hand-calculates the downside deviation and the annualized Sortino ratio at a zero MAR', () => {
    // 30 days of +2% and 30 days of −1% (alternating). With a 0% MAR only the −1% days are
    // shortfalls: Σ min(0,r)² = 30 × 0.01² = 0.003, /60 = 0.00005, √ = 0.01/√2 daily downside.
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.01));
    const values = series.map((point) => point.value);
    const expectedDownside = 0.01 / Math.SQRT2;

    assertClose(downsideDeviation(series, 0), expectedDownside);
    assertClose(downsideDeviation(series, 0), targetDownsideDeviation(values, 0));

    // Mean daily return is (0.6 − 0.3)/60 = 0.005, so the daily Sortino is 0.005 / (0.01/√2) = √2/2.
    const expectedSortino = (0.005 / expectedDownside) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    assertClose(annualizedSortinoRatio(series, 0), expectedSortino);
    assertClose(expectedSortino, (Math.SQRT2 / 2) * Math.sqrt(TRADING_DAYS_PER_YEAR));
  });

  it('subtracts the same geometric daily risk-free rate as the MAR', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.01));
    const values = series.map((point) => point.value);
    const dailyRiskFree = 1.04 ** (1 / TRADING_DAYS_PER_YEAR) - 1;
    const expectedDownside = targetDownsideDeviation(values, dailyRiskFree);
    const expectedSortino =
      ((sampleMean(values) - dailyRiskFree) / expectedDownside) * Math.sqrt(TRADING_DAYS_PER_YEAR);

    assertClose(downsideDeviation(series, 0.04), expectedDownside);
    assertClose(annualizedSortinoRatio(series, 0.04), expectedSortino);
  });

  it('lowers the Sortino ratio as the risk-free rate rises and rejects a rate at or below -1', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.01));

    assert.ok(annualizedSortinoRatio(series, 0.04)! < annualizedSortinoRatio(series, 0)!);
    assert.throws(() => annualizedSortinoRatio(series, -1), AnalyticsError);
    assert.throws(() => downsideDeviation(series, -1), AnalyticsError);
  });

  it('returns undefined when nothing fell below the MAR, rather than infinity', () => {
    const allGains = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0.01);
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);

    assert.equal(downsideDeviation(allGains, 0), 0);
    assert.equal(annualizedSortinoRatio(allGains, 0), undefined);
    assert.equal(annualizedSortinoRatio(flat, 0), undefined);
  });
});

describe('historical value at risk', () => {
  /** 57 days of +1% and three losing days of −10%, −8%, −6%: a controlled lower tail. */
  const TAIL_SAMPLE = [...Array.from({ length: 57 }, () => 0.01), -0.1, -0.08, -0.06];

  function tailSeries(): DatedValue[] {
    return seriesReturns(TAIL_SAMPLE.length, (index) => TAIL_SAMPLE[index]);
  }

  it('reads the nearest-rank lower-tail quantile as a positive loss (hand calc)', () => {
    // Sorted ascending the tail is [−0.10, −0.08, −0.06, 0.01 …]. At 95% the rank is
    // ceil(0.05 × 60) = 3, the 3rd-worst return −6%, so the one-day VaR is +0.06.
    assertClose(historicalValueAtRisk(tailSeries(), 0.95), 0.06);
  });

  it('does not imply a loss ceiling: a positive tail quantile yields a negative VaR', () => {
    // At 90% the rank is ceil(0.10 × 60) = 6; only three days are losses, so the 6th-worst
    // return is +1% and the VaR is −0.01, honestly a gain rather than clamped to zero.
    assertClose(historicalValueAtRisk(tailSeries(), 0.9), -0.01);
  });

  it('pins a high confidence on a small sample to the single worst return', () => {
    // rank = ceil(0.01 × 60) = 1 → the worst observed return, −10%.
    assertClose(historicalValueAtRisk(tailSeries(), 0.99), 0.1);
  });

  it('is undefined below 60 returns', () => {
    assert.equal(historicalValueAtRisk(seriesReturns(MIN_RISK_OBSERVATIONS - 1, () => -0.02), 0.95), undefined);
  });

  it('rejects a confidence that is not strictly between 0 and 1', () => {
    const series = seriesReturns(MIN_RISK_OBSERVATIONS, () => -0.01);
    for (const confidence of [0, 1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => historicalValueAtRisk(series, confidence), AnalyticsError);
    }
  });
});

describe('Jensen alpha', () => {
  it('is zero when the portfolio equals the benchmark', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.002 * ((index % 7) + 1));
    // Identical returns → beta 1 and equal annualized returns → alpha 0 at any risk-free rate.
    assertClose(jensenAlpha(benchmark, benchmark, 0.03), 0);
  });

  it('hand-calculates the annualized alpha of a 2× leveraged benchmark', () => {
    // Portfolio = 2 × benchmark each day, so beta = 2 exactly. Benchmark alternates ±u, so its
    // 60-day growth is (1−u²)^30 and the portfolio's is (1−4u²)^30. With Rf = 0 the CAPM term is
    // 2 × Rm, and geometric annualization uses the 252/60 exponent.
    const u = 0.02;
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? u : -u));
    const portfolio = benchmark.map((point) => ({ date: point.date, value: 2 * point.value }));

    const exponent = TRADING_DAYS_PER_YEAR / MIN_RISK_OBSERVATIONS;
    const annualizedBenchmark = (1 - u * u) ** (30 * exponent) - 1;
    const annualizedPortfolio = (1 - 4 * u * u) ** (30 * exponent) - 1;
    const expected = annualizedPortfolio - 2 * annualizedBenchmark;

    assertClose(jensenAlpha(portfolio, benchmark, 0), expected);
    // Leverage plus geometric compounding drags the annualized alpha slightly negative.
    assert.ok((jensenAlpha(portfolio, benchmark, 0) as number) < 0);
  });

  it('is undefined when the overlap is too short or the benchmark is flat', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    const shortPortfolio = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => 0.002 * ((index % 9) + 1));
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);

    assert.equal(jensenAlpha(shortPortfolio, benchmark.slice(0, MIN_RISK_OBSERVATIONS - 1), 0.02), undefined);
    assert.equal(jensenAlpha(benchmark, flat, 0.02), undefined);
  });

  it('rejects a risk-free rate at or below -1', () => {
    const benchmark = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.001 * ((index % 9) + 1));
    assert.throws(() => jensenAlpha(benchmark, benchmark, -1), AnalyticsError);
  });
});

describe('inverse-volatility weights', () => {
  it('weights a calmer series more than a wilder one (hand calc)', () => {
    // AAA alternates ±2% and BBB alternates ±4%, so BBB's annualized volatility is exactly double
    // AAA's; inverse-volatility weights are proportional to 1 and 1/2 → 2/3 and 1/3.
    const calm = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.02));
    const wild = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.04 : -0.04));
    const allocation = inverseVolatilityWeights([
      { symbol: 'AAA', returns: calm },
      { symbol: 'BBB', returns: wild },
    ]);

    assert.equal(allocation.method, 'inverse-volatility');
    assertClose(allocation.weights[0].volatility, annualizedVolatility(calm) as number);
    assertClose(allocation.weights[1].volatility, annualizedVolatility(wild) as number);
    assertClose(allocation.weights[0].weight, 2 / 3);
    assertClose(allocation.weights[1].weight, 1 / 3);
    assertClose(
      allocation.weights.reduce((total, entry) => total + entry.weight, 0),
      1,
    );
  });

  it('gives a single series the whole weight', () => {
    const only = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.02));
    const allocation = inverseVolatilityWeights([{ symbol: 'AAA', returns: only }]);

    assert.equal(allocation.weights.length, 1);
    assert.equal(allocation.weights[0].weight, 1);
  });

  it('rejects a zero-volatility or too-short series rather than dividing by it', () => {
    const moving = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.02));
    const flat = seriesReturns(MIN_RISK_OBSERVATIONS, () => 0);
    const tooShort = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => (index % 2 === 0 ? 0.02 : -0.02));

    assert.throws(
      () => inverseVolatilityWeights([{ symbol: 'AAA', returns: moving }, { symbol: 'BBB', returns: flat }]),
      AnalyticsError,
    );
    assert.throws(() => inverseVolatilityWeights([{ symbol: 'AAA', returns: tooShort }]), AnalyticsError);
  });

  it('rejects fewer than one, more than ten, and duplicate series', () => {
    const moving = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => (index % 2 === 0 ? 0.02 : -0.02));

    assert.throws(() => inverseVolatilityWeights([]), AnalyticsError);
    assert.throws(
      () =>
        inverseVolatilityWeights(
          Array.from({ length: INVERSE_VOLATILITY_MAX_SERIES + 1 }, (unused, index) => ({
            symbol: `SYM${index}`,
            returns: moving,
          })),
        ),
      AnalyticsError,
    );
    assert.throws(
      () => inverseVolatilityWeights([{ symbol: 'AAA', returns: moving }, { symbol: 'AAA', returns: moving }]),
      AnalyticsError,
    );
  });
});

describe('global minimum-variance weights', () => {
  // N is a multiple of 8 so the three ±1 patterns below are each zero-mean and MUTUALLY
  // uncorrelated over the sample, which makes every covariance below exactly hand-computable.
  const N = MIN_RISK_OBSERVATIONS * 2;

  const pattern2 = (index: number): number => (index % 2 === 0 ? 1 : -1); // period 2
  const pattern4 = (index: number): number => (Math.floor(index / 2) % 2 === 0 ? 1 : -1); // period 4
  const pattern8 = (index: number): number => (Math.floor(index / 4) % 2 === 0 ? 1 : -1); // period 8

  /** A return series that is a linear blend of the three orthogonal patterns. */
  function blend(a: number, b: number, c: number): DatedValue[] {
    return seriesReturns(N, (index) => a * pattern2(index) + b * pattern4(index) + c * pattern8(index));
  }

  /** Independent sample covariance of two equal-length aligned columns, using the ÷(N-1) estimator. */
  function sampleCovariance(a: number[], b: number[]): number {
    const meanA = sampleMean(a);
    const meanB = sampleMean(b);
    const sum = a.reduce((total, value, index) => total + (value - meanA) * (b[index] - meanB), 0);
    return sum / (a.length - 1);
  }

  function covarianceMatrix(columns: number[][]): number[][] {
    return columns.map((rowColumn) => columns.map((colColumn) => sampleCovariance(rowColumn, colColumn)));
  }

  function values(series: DatedValue[]): number[] {
    return series.map((point) => point.value);
  }

  /** Portfolio sample variance wᵀΣw. */
  function portfolioVariance(cov: number[][], weights: number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i += 1) {
      for (let j = 0; j < weights.length; j += 1) total += weights[i] * cov[i][j] * weights[j];
    }
    return total;
  }

  /** Unconstrained two-asset GMV weight on the first asset: (σ₂₂ − σ₁₂)/(σ₁₁ + σ₂₂ − 2σ₁₂). */
  function twoAssetWeightOnFirst(cov: number[][]): number {
    return (cov[1][1] - cov[0][1]) / (cov[0][0] + cov[1][1] - 2 * cov[0][1]);
  }

  it('matches the closed-form two-asset solution for an interior optimum', () => {
    // A = 0.01·p2, B = 0.005·p2 + 0.01·p4 → σAA∝1, σBB∝1.25, σAB∝0.5 (in units of 0.0001·v),
    // so the closed-form weight on A is (1.25−0.5)/(1+1.25−1) = 0.6, strictly interior.
    const assetA = blend(0.01, 0, 0);
    const assetB = blend(0.005, 0.01, 0);
    const cov = covarianceMatrix([values(assetA), values(assetB)]);

    const expectedFirst = twoAssetWeightOnFirst(cov);
    // Guard the fixture: this scenario must actually be interior for the closed form to apply.
    assert.ok(expectedFirst > 0 && expectedFirst < 1);
    assertClose(expectedFirst, 0.6, 1e-12);

    const allocation = globalMinimumVarianceWeights([
      { symbol: 'AAA', returns: assetA },
      { symbol: 'BBB', returns: assetB },
    ]);

    assert.equal(allocation.method, 'global-minimum-variance');
    assert.equal(allocation.observations, N);
    assert.ok(allocation.converged);
    assertClose(allocation.weights[0].weight, expectedFirst, 1e-8);
    assertClose(allocation.weights[1].weight, 1 - expectedFirst, 1e-8);

    // The reported volatility is the annualized objective at the returned weights.
    const dailyVariance = portfolioVariance(cov, allocation.weights.map((entry) => entry.weight));
    assertClose(allocation.volatility, Math.sqrt(dailyVariance * TRADING_DAYS_PER_YEAR), 1e-8);
  });

  it('returns non-negative weights that sum to one', () => {
    // Three uncorrelated assets with distinct variances → an interior inverse-variance optimum.
    const allocation = globalMinimumVarianceWeights([
      { symbol: 'AAA', returns: blend(0.01, 0, 0) },
      { symbol: 'BBB', returns: blend(0, 0.02, 0) },
      { symbol: 'CCC', returns: blend(0, 0, 0.015) },
    ]);

    for (const entry of allocation.weights) assert.ok(entry.weight >= 0);
    assertClose(
      allocation.weights.reduce((total, entry) => total + entry.weight, 0),
      1,
      1e-9,
    );
  });

  it('achieves variance no worse than the equal-weight portfolio', () => {
    const series = [
      { symbol: 'AAA', returns: blend(0.01, 0, 0) },
      { symbol: 'BBB', returns: blend(0, 0.02, 0) },
      { symbol: 'CCC', returns: blend(0, 0, 0.015) },
    ];
    const cov = covarianceMatrix(series.map((entry) => values(entry.returns)));

    const allocation = globalMinimumVarianceWeights(series);
    const optimized = portfolioVariance(cov, allocation.weights.map((entry) => entry.weight));
    const equalWeight = portfolioVariance(cov, series.map(() => 1 / series.length));

    // The minimum-variance portfolio can never be more volatile than naive equal weighting, and
    // with distinct variances it is strictly less.
    assert.ok(optimized < equalWeight);
  });

  it('drives a dominated holding to a zero-weight corner', () => {
    // HIGH = 0.03·p2 + 0.01·p4 is highly correlated with LOW = 0.01·p2 but far more volatile:
    // σLOW∝1, σHIGH∝10, σ(LOW,HIGH)∝3, so the unconstrained weight on HIGH is (1−3)/(1+10−6) =
    // −0.4. The long-only constraint pins HIGH to exactly zero and LOW to one.
    const low = blend(0.01, 0, 0);
    const high = blend(0.03, 0.01, 0);
    const cov = covarianceMatrix([values(low), values(high)]);

    // Guard the fixture: the unconstrained weight on HIGH must be negative for this to be a corner.
    assert.ok(1 - twoAssetWeightOnFirst(cov) < 0);

    const allocation = globalMinimumVarianceWeights([
      { symbol: 'LOW', returns: low },
      { symbol: 'HIGH', returns: high },
    ]);

    assertClose(allocation.weights[0].weight, 1, 1e-8);
    assertClose(allocation.weights[1].weight, 0, 1e-8);
  });

  it('is invariant to scaling every return by the same positive constant', () => {
    const assetA = blend(0.01, 0, 0);
    const assetB = blend(0, 0.02, 0);
    const scale = 4; // A power of two keeps the covariance an exact multiple, isolating the invariance.

    const base = globalMinimumVarianceWeights([
      { symbol: 'AAA', returns: assetA },
      { symbol: 'BBB', returns: assetB },
    ]);
    const scaled = globalMinimumVarianceWeights([
      { symbol: 'AAA', returns: assetA.map((point) => ({ date: point.date, value: point.value * scale })) },
      { symbol: 'BBB', returns: assetB.map((point) => ({ date: point.date, value: point.value * scale })) },
    ]);

    assertClose(scaled.weights[0].weight, base.weights[0].weight, 1e-9);
    assertClose(scaled.weights[1].weight, base.weights[1].weight, 1e-9);
    // Uniformly scaling returns scales the volatility by the same constant.
    assertClose(scaled.volatility, base.volatility * scale, 1e-9);
  });

  it('rejects fewer than sixty aligned observations', () => {
    const tooShort = seriesReturns(MIN_RISK_OBSERVATIONS - 1, (index) => 0.02 * pattern2(index));
    assert.throws(() => globalMinimumVarianceWeights([{ symbol: 'AAA', returns: tooShort }]), AnalyticsError);

    // Individually long enough, but their trading days do not overlap, so the intersection is empty.
    const early = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.02 * pattern2(index), '2024-01-02');
    const late = seriesReturns(MIN_RISK_OBSERVATIONS, (index) => 0.02 * pattern4(index), '2025-06-02');
    assert.throws(
      () => globalMinimumVarianceWeights([{ symbol: 'AAA', returns: early }, { symbol: 'BBB', returns: late }]),
      AnalyticsError,
    );
  });

  it('rejects a flat holding and a singular covariance matrix', () => {
    const moving = blend(0.01, 0.005, 0);
    const flat = seriesReturns(N, () => 0);
    // Two identical series are perfectly correlated, so the covariance matrix is singular.
    const duplicate = blend(0.01, 0.005, 0);

    assert.throws(() => globalMinimumVarianceWeights([{ symbol: 'FLAT', returns: flat }]), AnalyticsError);
    assert.throws(
      () => globalMinimumVarianceWeights([{ symbol: 'AAA', returns: moving }, { symbol: 'FLAT', returns: flat }]),
      AnalyticsError,
    );
    assert.throws(
      () => globalMinimumVarianceWeights([{ symbol: 'AAA', returns: moving }, { symbol: 'BBB', returns: duplicate }]),
      AnalyticsError,
    );
  });

  it('rejects too few, too many, and duplicate series', () => {
    const moving = blend(0.01, 0.005, 0);

    assert.throws(() => globalMinimumVarianceWeights([]), AnalyticsError);
    assert.throws(
      () =>
        globalMinimumVarianceWeights(
          Array.from({ length: MIN_VARIANCE_MAX_SERIES + 1 }, (unused, index) => ({
            symbol: `SYM${index}`,
            returns: moving,
          })),
        ),
      AnalyticsError,
    );
    assert.throws(
      () => globalMinimumVarianceWeights([{ symbol: 'AAA', returns: moving }, { symbol: 'AAA', returns: moving }]),
      AnalyticsError,
    );
  });

  it('is deterministic: identical inputs yield an identical allocation', () => {
    const series = [
      { symbol: 'AAA', returns: blend(0.01, 0.005, 0) },
      { symbol: 'BBB', returns: blend(0, 0.02, 0.005) },
      { symbol: 'CCC', returns: blend(0.003, 0, 0.015) },
    ];

    assert.deepEqual(globalMinimumVarianceWeights(series), globalMinimumVarianceWeights(series));
  });
});
