import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  CALENDAR_DAYS_PER_YEAR,
  MIN_RISK_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
} from '@/domain/analytics';
import {
  MOVING_AVERAGE_WINDOWS,
  VOLUME_AVERAGE_WINDOW,
  buildStockAnalysis,
  describeDrawdownScenario,
} from '@/domain/stock-analysis';
import type {
  DateString,
  DividendEvent,
  MarketData,
  PriceBar,
  SplitEvent,
} from '@/types/backtest';
import { addDays } from '@/utils/date';

function bars(entries: [DateString, number][]): PriceBar[] {
  return entries.map(([date, close]) => ({ date, open: close, high: close, low: close, close }));
}

/** Bars on consecutive calendar dates; dates only need to be strictly increasing ISO days. */
function sequentialBars(closes: number[], start: DateString = '2025-01-02'): PriceBar[] {
  return closes.map((close, index) => ({
    date: addDays(start, index),
    open: close,
    high: close,
    low: close,
    close,
  }));
}

function withVolumes(series: PriceBar[], volumes: (number | undefined)[]): PriceBar[] {
  return series.map((bar, index) => ({ ...bar, volume: volumes[index] }));
}

function marketData(prices: PriceBar[], overrides: Partial<MarketData> = {}): MarketData {
  return {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    currency: 'USD',
    locale: 'us',
    type: 'CS',
    prices,
    dividends: [],
    splits: [],
    tickerChanges: [],
    source: 'demo',
    fetchedAt: '2026-07-27T00:00:00.000Z',
    provenance: {
      priceProvider: 'demo',
      priceBasis: 'split-adjusted',
      fetchedAt: '2026-07-27T00:00:00.000Z',
      dividendCoverage: 'demo',
      totalReturnCoverage: 'demo',
      splitCoverage: 'demo',
      reorganizationCoverage: 'demo',
      mode: 'demo',
    },
    ...overrides,
  };
}

function dividend(exDate: DateString, cashAmount = 0.25): DividendEvent {
  return {
    id: `div-${exDate}`,
    exDate,
    payDate: exDate,
    cashAmount,
    splitAdjustedCashAmount: cashAmount,
    distributionType: 'CD',
    frequency: 4,
  };
}

function split(executionDate: DateString): SplitEvent {
  return {
    id: `split-${executionDate}`,
    executionDate,
    splitFrom: 1,
    splitTo: 4,
    adjustmentType: 'regular',
  };
}

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

/** `count + 1` closes producing `count` alternating ±magnitude daily returns from 100. */
function alternatingCloses(magnitude: number, count: number = MIN_RISK_OBSERVATIONS): number[] {
  const closes = [100];
  for (let index = 0; index < count; index += 1) {
    closes.push(closes[closes.length - 1] * (1 + (index % 2 === 0 ? magnitude : -magnitude)));
  }
  return closes;
}

function dailyReturnValues(closes: number[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < closes.length; index += 1) out.push(closes[index] / closes[index - 1] - 1);
  return out;
}

function sampleStdDev(values: number[]): number {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Asset moving ±20% daily against a benchmark moving ±10% on the same days, over the
 * minimum 60-return sample the risk math requires. The asset return is exactly twice
 * the benchmark return each day (beta 2, correlation 1), and both average zero.
 */
const DOUBLE_BETA_ASSET_CLOSES = alternatingCloses(0.2);
const DOUBLE_BETA_ASSET = sequentialBars(DOUBLE_BETA_ASSET_CLOSES, '2025-01-06');
const DOUBLE_BETA_BENCHMARK = sequentialBars(alternatingCloses(0.1), '2025-01-06');

describe('buildStockAnalysis latest quote and history', () => {
  it('reports the last split-adjusted close, its date, and the covered history', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2020-01-01', 100],
          ['2022-01-01', 150],
          ['2024-01-01', 200],
        ]),
      ),
      annualRiskFreeRate: 0.04,
    });

    assert.equal(view.ticker, 'AAPL');
    assert.equal(view.name, 'Apple Inc.');
    assert.equal(view.currency, 'USD');
    assert.equal(view.latestClose, 200);
    assert.equal(view.latestDate, '2024-01-01');
    assert.deepEqual(view.history, {
      firstDate: '2020-01-01',
      lastDate: '2024-01-01',
      barCount: 3,
      calendarDays: 1461,
      years: 1461 / CALENDAR_DAYS_PER_YEAR,
    });
    assert.equal(view.annualRiskFreeRate, 0.04);
  });
});

describe('buildStockAnalysis price series', () => {
  it('rebases cumulative price return to 0 on the first bar and tracks the closes', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 110],
          ['2025-01-06', 80],
        ]),
      ),
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(view.cumulativeReturns, [
      { date: '2025-01-02', value: 0 },
      { date: '2025-01-03', value: 0.10000000000000009 },
      { date: '2025-01-06', value: -0.19999999999999996 },
    ]);
  });

  it('emits one daily return per gap between bars', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 110],
          ['2025-01-06', 99],
        ]),
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.dailyReturns.length, 2);
    assert.deepEqual(
      view.dailyReturns.map((point) => point.date),
      ['2025-01-03', '2025-01-06'],
    );
    assertClose(view.dailyReturns[0].value, 0.1);
    assertClose(view.dailyReturns[1].value, -0.1);
  });

  it('excludes dividends from price return, so a large payout does not lift the series', () => {
    const prices = bars([
      ['2025-01-02', 100],
      ['2025-01-03', 110],
    ]);
    const withoutDividend = buildStockAnalysis({
      marketData: marketData(prices),
      annualRiskFreeRate: 0,
    });
    const withDividend = buildStockAnalysis({
      marketData: marketData(prices, { dividends: [dividend('2025-01-03', 25)] }),
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(withDividend.cumulativeReturns, withoutDividend.cumulativeReturns);
    assert.equal(withDividend.dividendCount, 1);
  });

  it('emits 50- and 200-session moving averages only once each window is full', () => {
    const closes = Array.from({ length: 60 }, (_, index) => index + 1);
    const view = buildStockAnalysis({
      marketData: marketData(sequentialBars(closes)),
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(
      view.movingAverages.map((series) => series.window),
      [...MOVING_AVERAGE_WINDOWS],
    );
    const [fifty, twoHundred] = view.movingAverages;
    assert.equal(fifty.points.length, 11);
    assert.equal(fifty.points[0].date, addDays('2025-01-02', 49));
    assertClose(fifty.points[0].value, 25.5);
    assertClose(fifty.points[10].value, 35.5);
    assert.deepEqual(twoHundred.points, [], '200-session average needs 200 bars');
  });
});

describe('buildStockAnalysis risk metrics', () => {
  it('annualizes growth over the elapsed calendar days', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2020-01-01', 100],
          ['2024-01-01', 200],
        ]),
      ),
      annualRiskFreeRate: 0,
    });

    assertClose(view.cagr, 2 ** (1 / 4) - 1);
  });

  it('annualizes daily volatility by the square root of the trading year', () => {
    const view = buildStockAnalysis({
      marketData: marketData(DOUBLE_BETA_ASSET),
      annualRiskFreeRate: 0,
    });

    const expected = sampleStdDev(dailyReturnValues(DOUBLE_BETA_ASSET_CLOSES)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    assertClose(view.volatility, expected);
  });

  it('lowers the Sharpe ratio as the supplied risk-free rate rises', () => {
    const prices = marketData(DOUBLE_BETA_ASSET);
    const atZero = buildStockAnalysis({ marketData: prices, annualRiskFreeRate: 0 });
    const atFourPercent = buildStockAnalysis({ marketData: prices, annualRiskFreeRate: 0.04 });

    const zeroRateSharpe = atZero.sharpeRatio;
    const fourPercentSharpe = atFourPercent.sharpeRatio;
    assert.ok(zeroRateSharpe !== undefined && fourPercentSharpe !== undefined);
    assertClose(zeroRateSharpe, 0);
    assert.ok(
      fourPercentSharpe < zeroRateSharpe,
      'a positive risk-free rate must reduce the excess return',
    );
  });

  it('reports the worst close-to-close drawdown with its peak, trough, and recovery dates', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 120],
          ['2025-01-06', 90],
          ['2025-01-07', 130],
        ]),
      ),
      annualRiskFreeRate: 0,
    });

    assertClose(view.maxDrawdown.drawdown, -0.25);
    assert.equal(view.maxDrawdown.peakDate, '2025-01-03');
    assert.equal(view.maxDrawdown.troughDate, '2025-01-06');
    assert.equal(view.maxDrawdown.recoveryDate, '2025-01-07');
  });

  it('leaves the Sharpe ratio undefined for flat prices instead of reporting zero risk-adjusted return', () => {
    const view = buildStockAnalysis({
      marketData: marketData(sequentialBars(Array.from({ length: MIN_RISK_OBSERVATIONS + 1 }, () => 100))),
      annualRiskFreeRate: 0.04,
    });

    assert.equal(view.volatility, 0, 'a flat series really did have zero volatility');
    assert.equal(view.sharpeRatio, undefined, 'no Sharpe ratio is defined without volatility');
    assertClose(view.cagr, 0);
    assert.equal(view.maxDrawdown.drawdown, 0);
    assert.equal(view.maxDrawdown.peakDate, undefined);
    assert.equal(view.maxDrawdown.troughDate, undefined);
  });

  it('leaves every multi-bar metric undefined for a one-bar history', () => {
    const view = buildStockAnalysis({
      marketData: marketData(bars([['2025-01-02', 100]])),
      annualRiskFreeRate: 0.04,
    });

    assert.equal(view.latestClose, 100);
    assert.deepEqual(view.dailyReturns, []);
    assert.deepEqual(view.cumulativeReturns, [{ date: '2025-01-02', value: 0 }]);
    assert.equal(view.cagr, undefined);
    assert.equal(view.volatility, undefined);
    assert.equal(view.sharpeRatio, undefined);
    assert.equal(view.maxDrawdown.drawdown, 0);
    assert.equal(view.history.barCount, 1);
    assert.equal(view.history.calendarDays, 0);
    assert.equal(view.history.years, 0);
    assert.deepEqual(
      view.movingAverages.map((series) => series.points.length),
      [0, 0],
    );
  });
});

describe('buildStockAnalysis benchmark comparison', () => {
  it('measures beta and correlation against the benchmark', () => {
    const view = buildStockAnalysis({
      marketData: marketData(DOUBLE_BETA_ASSET),
      benchmark: marketData(DOUBLE_BETA_BENCHMARK, { ticker: 'SPY', name: 'SPDR S&P 500' }),
      annualRiskFreeRate: 0.04,
    });

    assert.equal(view.benchmark?.symbol, 'SPY');
    assert.equal(view.benchmark?.overlappingDays, MIN_RISK_OBSERVATIONS);
    assertClose(view.benchmark?.beta, 2);
    assertClose(view.benchmark?.correlation, 1);
  });

  it('uses only the overlapping days when the benchmark history is shorter', () => {
    // The asset trades two return dates past the benchmark's history; only the 60
    // shared dates feed beta and correlation.
    const view = buildStockAnalysis({
      marketData: marketData(
        sequentialBars(alternatingCloses(0.2, MIN_RISK_OBSERVATIONS + 2), '2025-02-01'),
      ),
      benchmark: marketData(
        sequentialBars(alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), '2025-02-01'),
        { ticker: 'SPY' },
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.benchmark?.overlappingDays, MIN_RISK_OBSERVATIONS, 'only the shared dates count');
    assertClose(view.benchmark?.beta, 2, 1e-12);
    assertClose(view.benchmark?.correlation, 1, 1e-12);
  });

  it('leaves beta and correlation undefined when the series share only one return', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 105],
          ['2025-01-06', 103],
          ['2025-01-07', 108],
        ]),
      ),
      benchmark: marketData(
        bars([
          ['2025-01-06', 400],
          ['2025-01-07', 410],
          ['2025-01-08', 405],
        ]),
        { ticker: 'SPY' },
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.benchmark?.overlappingDays, 1);
    assert.equal(view.benchmark?.beta, undefined);
    assert.equal(view.benchmark?.correlation, undefined);
  });

  it('omits the comparison entirely when no benchmark is supplied', () => {
    const view = buildStockAnalysis({
      marketData: marketData(DOUBLE_BETA_ASSET),
      annualRiskFreeRate: 0.04,
    });

    assert.equal(view.benchmark, undefined);
    assert.ok(view.volatility !== undefined, 'single-symbol metrics still resolve');
  });
});

/** Market data whose provider supplied a complete aligned adjusted-close axis. */
function coveredMarketData(prices: PriceBar[], overrides: Partial<MarketData> = {}): MarketData {
  return marketData(prices, {
    source: 'yahoo',
    provenance: {
      priceProvider: 'yahoo',
      priceBasis: 'split-adjusted',
      lastCompletedSession: prices[prices.length - 1].date,
      fetchedAt: '2026-07-27T00:00:00.000Z',
      dividendCoverage: 'not-requested',
      totalReturnCoverage: 'yahoo-adjusted-close',
      splitCoverage: 'none-reported',
      reorganizationCoverage: 'provider-reported-only',
      mode: 'analysis',
    },
    ...overrides,
  });
}

describe('buildStockAnalysis return basis', () => {
  it('measures on total-return basis and separates price return from total return', () => {
    // Flat price (0% price return) but a rising adjusted close: a dividend-driven total
    // return of 100/90 − 1 that price return alone cannot see.
    const count = MIN_RISK_OBSERVATIONS;
    const prices = sequentialBars(Array.from({ length: count + 1 }, () => 100)).map((bar, index) => ({
      ...bar,
      adjustedClose: 90 + (10 * index) / count,
    }));
    const view = buildStockAnalysis({ marketData: coveredMarketData(prices), annualRiskFreeRate: 0 });

    assert.equal(view.returnBasis, 'total');
    assertClose(view.priceReturn, 0);
    assertClose(view.totalReturn as number, 100 / 90 - 1);
    assert.ok(view.volatility !== undefined && view.volatility > 0, 'total-return volatility is nonzero');
    assert.equal(view.riskSample.observations, count);
    assert.equal(view.riskSample.sufficient, true);
    assert.equal(view.riskSample.limited, true);
  });

  it('falls back to price basis for both legs when the benchmark lacks coverage', () => {
    const count = MIN_RISK_OBSERVATIONS;
    const prices = sequentialBars(Array.from({ length: count + 1 }, () => 100)).map((bar, index) => ({
      ...bar,
      adjustedClose: 90 + (10 * index) / count,
    }));
    // The benchmark is demo data with no adjusted-close coverage.
    const benchmark = marketData(sequentialBars(alternatingCloses(0.1, count)), { ticker: 'SPY' });
    const view = buildStockAnalysis({
      marketData: coveredMarketData(prices),
      benchmark,
      annualRiskFreeRate: 0,
    });

    // Mixed coverage → price basis for every figure, never a mixed table.
    assert.equal(view.returnBasis, 'price');
    assertClose(view.priceReturn, 0);
    // The security's own total return is still exposed as a distinct metric.
    assertClose(view.totalReturn as number, 100 / 90 - 1);
  });
});

describe('buildStockAnalysis corporate action counts', () => {
  it('counts only the dividends and splits inside the covered window', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-02-01', 100],
          ['2025-02-28', 110],
        ]),
        {
          dividends: [dividend('2025-01-15'), dividend('2025-02-10'), dividend('2025-03-15')],
          splits: [split('2025-01-20'), split('2025-02-01'), split('2025-02-28'), split('2025-04-01')],
        },
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.dividendCount, 1);
    assert.equal(view.splitCount, 2, 'window bounds are inclusive');
  });
});

describe('buildStockAnalysis volume', () => {
  it('flags volume as unavailable when no bar reports it', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 110],
        ]),
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.volume.unavailable, true);
    assert.deepEqual(view.volume.points, []);
    assert.equal(view.volume.latest, undefined);
    assert.equal(view.volume.averageVolume, undefined);
  });

  it('drops bars whose volume is missing, negative, or non-finite', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        withVolumes(sequentialBars([100, 101, 102, 103]), [1_000, undefined, -5, Number.NaN]),
      ),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.volume.unavailable, false);
    assert.deepEqual(view.volume.points, [{ date: '2025-01-02', value: 1_000 }]);
    assert.equal(view.volume.latest, 1_000);
    assert.equal(view.volume.averageVolume, undefined, 'a 20-session average needs 20 sessions');
  });

  it('keeps a reported zero volume, which is an observation rather than a gap', () => {
    const view = buildStockAnalysis({
      marketData: marketData(withVolumes(sequentialBars([100, 101]), [1_000, 0])),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.volume.unavailable, false);
    assert.equal(view.volume.latest, 0);
    assert.equal(view.volume.points.length, 2);
  });

  it('averages the most recent 20 reporting sessions', () => {
    const closes = Array.from({ length: 25 }, () => 100);
    const volumes = Array.from({ length: 25 }, (_, index) => (index + 1) * 100);
    const view = buildStockAnalysis({
      marketData: marketData(withVolumes(sequentialBars(closes), volumes)),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.volume.points.length, 25);
    assert.equal(view.volume.latest, 2_500);
    assert.equal(VOLUME_AVERAGE_WINDOW, 20);
    assertClose(view.volume.averageVolume, 1_550, 1e-9);
  });
});

describe('buildStockAnalysis validation', () => {
  it('rejects an empty price series', () => {
    assert.throws(
      () => buildStockAnalysis({ marketData: marketData([]), annualRiskFreeRate: 0 }),
      AnalyticsError,
    );
  });

  it('rejects a risk-free rate that is not a finite fraction above -1', () => {
    const data = marketData(DOUBLE_BETA_ASSET);
    assert.throws(
      () => buildStockAnalysis({ marketData: data, annualRiskFreeRate: Number.NaN }),
      AnalyticsError,
    );
    assert.throws(() => buildStockAnalysis({ marketData: data, annualRiskFreeRate: -1 }), AnalyticsError);
  });

  it('rejects a benchmark whose own price series cannot support return math', () => {
    assert.throws(
      () =>
        buildStockAnalysis({
          marketData: marketData(DOUBLE_BETA_ASSET),
          benchmark: marketData([], { ticker: 'SPY' }),
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

describe('describeDrawdownScenario', () => {
  it('restates the worst drawdown as the dollar trough for the supplied amount', () => {
    const view = buildStockAnalysis({
      marketData: marketData(
        bars([
          ['2025-01-02', 100],
          ['2025-01-03', 120],
          ['2025-01-06', 90],
          ['2025-01-07', 130],
        ]),
      ),
      annualRiskFreeRate: 0,
    });
    const scenario = describeDrawdownScenario(view.maxDrawdown, 10_000);

    assert.equal(scenario.amount, 10_000);
    assertClose(scenario.troughValue, 7_500, 1e-9);
    assertClose(scenario.decline, -2_500, 1e-9);
    assertClose(scenario.drawdown, -0.25);
    assert.equal(scenario.peakDate, '2025-01-03');
    assert.equal(scenario.troughDate, '2025-01-06');
    assert.equal(scenario.recoveryDate, '2025-01-07');
  });

  it('returns the amount unchanged when the history never declined', () => {
    const scenario = describeDrawdownScenario({ drawdown: 0 }, 10_000);

    assert.equal(scenario.troughValue, 10_000);
    assert.equal(scenario.decline, 0);
    assert.equal(scenario.troughDate, undefined);
  });

  it('rejects an amount that is not a finite positive number', () => {
    assert.throws(() => describeDrawdownScenario({ drawdown: -0.2 }, 0), AnalyticsError);
    assert.throws(() => describeDrawdownScenario({ drawdown: -0.2 }, -100), AnalyticsError);
    assert.throws(() => describeDrawdownScenario({ drawdown: -0.2 }, Number.NaN), AnalyticsError);
  });

  it('rejects a drawdown that is not a fraction in (-1, 0]', () => {
    assert.throws(() => describeDrawdownScenario({ drawdown: 0.1 }, 10_000), AnalyticsError);
    assert.throws(() => describeDrawdownScenario({ drawdown: -1 }, 10_000), AnalyticsError);
  });
});
