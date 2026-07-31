import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  CALENDAR_DAYS_PER_YEAR,
  MIN_RISK_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
} from '@/domain/analytics';
import {
  MAX_COMPARISON_SECURITIES,
  MIN_COMMON_CLOSES,
  MIN_COMPARISON_SECURITIES,
  buildCorrelationMatrix,
  buildStockComparison,
  commonTradingDates,
  describeComparison,
} from '@/domain/stock-comparison';
import type { ComparedSecurity, CommonWindow } from '@/domain/stock-comparison';
import type { DateString, MarketData, PriceBar } from '@/types/backtest';
import { addDays } from '@/utils/date';

function bars(entries: [DateString, number][]): PriceBar[] {
  return entries.map(([date, close]) => ({ date, open: close, high: close, low: close, close }));
}

/** Bars on the given dates, all sharing one close per date. */
function series(dates: DateString[], closes: number[]): PriceBar[] {
  return bars(dates.map((date, index) => [date, closes[index]]));
}

/** `count` consecutive calendar dates from `start`. */
function days(count: number, start: DateString = '2025-02-03'): DateString[] {
  return Array.from({ length: count }, (unused, index) => addDays(start, index));
}

/** `count + 1` closes producing `count` alternating ±magnitude daily returns from `base`. */
function alternatingCloses(magnitude: number, count: number, base = 100): number[] {
  return driftingCloses(magnitude, magnitude, count, base);
}

/** `count + 1` closes with `up` on even days and `down` on odd days, so drift and volatility differ. */
function driftingCloses(up: number, down: number, count: number, base = 100): number[] {
  const closes = [base];
  for (let index = 0; index < count; index += 1) {
    closes.push(closes[closes.length - 1] * (1 + (index % 2 === 0 ? up : -down)));
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

function security(ticker: string, prices: PriceBar[], overrides: Partial<MarketData> = {}): MarketData {
  return {
    ticker,
    name: `${ticker} Inc.`,
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

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

const WEEK = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09'];

/** Three shared sessions, the shortest window the builder accepts. */
const SHORT_WEEK = WEEK.slice(0, 3);

/** Up 20% then down 20%, against a benchmark up 10% then down 10% on the same sessions. */
const DOUBLE_BETA_CLOSES = [100, 120, 96];
const BENCHMARK_CLOSES = [100, 110, 99];

function twoSecurities(): MarketData[] {
  return [
    security('AAA', series(SHORT_WEEK, [100, 110, 99])),
    security('BBB', series(SHORT_WEEK, [50, 52, 55])),
  ];
}

function comparedStub(overrides: Partial<ComparedSecurity> = {}): ComparedSecurity {
  return {
    symbol: 'AAA',
    name: 'AAA Inc.',
    type: 'CS',
    currency: 'USD',
    source: 'demo',
    suppliedBars: 3,
    suppliedFirstDate: SHORT_WEEK[0],
    suppliedLastDate: SHORT_WEEK[2],
    sessions: 3,
    firstClose: 100,
    lastClose: 110,
    cumulativeReturns: [],
    dailyReturns: [],
    totalPriceReturn: 0.1,
    cagr: 0.1,
    volatility: 0.2,
    sharpeRatio: 0.5,
    maxDrawdown: { drawdown: 0 },
    ...overrides,
  };
}

const STUB_WINDOW: CommonWindow = {
  startDate: SHORT_WEEK[0],
  endDate: SHORT_WEEK[2],
  sessions: 3,
  dates: [...SHORT_WEEK],
  calendarDays: 2,
  years: 2 / CALENDAR_DAYS_PER_YEAR,
  startLimitedBy: ['AAA'],
  endLimitedBy: ['AAA'],
};

describe('selection bounds', () => {
  it('rejects a single security, which is not a comparison', () => {
    assert.equal(MIN_COMPARISON_SECURITIES, 2);
    assert.throws(
      () =>
        buildStockComparison({
          securities: [security('AAA', series(SHORT_WEEK, [100, 110, 99]))],
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('compares exactly two securities', () => {
    const view = buildStockComparison({ securities: twoSecurities(), annualRiskFreeRate: 0 });

    assert.deepEqual(
      view.securities.map((entry) => entry.symbol),
      ['AAA', 'BBB'],
    );
  });

  it('compares exactly five securities', () => {
    assert.equal(MAX_COMPARISON_SECURITIES, 5);
    const five = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((ticker, index) =>
      security(ticker, series(SHORT_WEEK, [100, 100 + index, 100 + index * 2])),
    );

    const view = buildStockComparison({ securities: five, annualRiskFreeRate: 0 });

    assert.equal(view.securities.length, 5);
    assert.deepEqual(view.correlations.symbols, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
    assert.equal(view.correlations.values.length, 5);
    view.correlations.values.forEach((row) => assert.equal(row.length, 5));
  });

  it('rejects a sixth security instead of silently dropping it', () => {
    const six = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map((ticker) =>
      security(ticker, series(SHORT_WEEK, [100, 110, 99])),
    );

    assert.throws(() => buildStockComparison({ securities: six, annualRiskFreeRate: 0 }), AnalyticsError);
  });
});

describe('input normalization', () => {
  it('rejects the same ticker twice regardless of case or surrounding whitespace', () => {
    assert.throws(
      () =>
        buildStockComparison({
          securities: [
            security('AAPL', series(SHORT_WEEK, [100, 110, 99])),
            security(' aapl ', series(SHORT_WEEK, [100, 110, 99])),
          ],
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('uppercases every symbol it reports', () => {
    const view = buildStockComparison({
      securities: [
        security(' aapl ', series(SHORT_WEEK, [100, 110, 99])),
        security('msft', series(SHORT_WEEK, [50, 52, 55])),
      ],
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(
      view.securities.map((entry) => entry.symbol),
      ['AAPL', 'MSFT'],
    );
    assert.deepEqual(view.correlations.symbols, ['AAPL', 'MSFT']);
    assert.deepEqual(view.narrative.symbols, ['AAPL', 'MSFT']);
  });

  it('rejects a security with an empty price series', () => {
    assert.throws(
      () =>
        buildStockComparison({
          securities: [security('AAA', series(SHORT_WEEK, [100, 110, 99])), security('BBB', [])],
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('requires an explicit, usable risk-free rate', () => {
    assert.throws(
      () => buildStockComparison({ securities: twoSecurities(), annualRiskFreeRate: Number.NaN }),
      AnalyticsError,
    );
    assert.throws(
      () => buildStockComparison({ securities: twoSecurities(), annualRiskFreeRate: -1 }),
      AnalyticsError,
    );

    const view = buildStockComparison({ securities: twoSecurities(), annualRiskFreeRate: 0.04 });
    assert.equal(view.annualRiskFreeRate, 0.04);
  });
});

describe('common trading window', () => {
  it('intersects the trading dates of every series and sorts them', () => {
    const dates = commonTradingDates([
      bars([
        ['2025-01-08', 3],
        ['2025-01-06', 1],
        ['2025-01-07', 2],
      ]),
      bars([
        ['2025-01-07', 2],
        ['2025-01-08', 3],
        ['2025-01-09', 4],
      ]),
    ]);

    assert.deepEqual(dates, ['2025-01-07', '2025-01-08']);
  });

  it('returns no dates when nothing was supplied', () => {
    assert.deepEqual(commonTradingDates([]), []);
  });

  it('lets a later listing shorten the window for everyone', () => {
    const view = buildStockComparison({
      securities: [
        security('AAA', series(['2025-01-02', '2025-01-03', ...SHORT_WEEK], [80, 90, 100, 110, 99])),
        security('BBB', series(SHORT_WEEK, [50, 52, 55])),
      ],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.commonWindow.startDate, '2025-01-06');
    assert.equal(view.commonWindow.endDate, '2025-01-08');
    assert.equal(view.commonWindow.sessions, 3);
    assert.deepEqual(view.commonWindow.dates, SHORT_WEEK);
    assert.deepEqual(view.commonWindow.startLimitedBy, ['BBB']);
    assert.deepEqual(view.commonWindow.endLimitedBy, ['AAA', 'BBB']);
    view.securities.forEach((entry) => {
      assert.equal(entry.sessions, 3);
      assert.equal(entry.cumulativeReturns.length, 3);
      assert.equal(entry.dailyReturns.length, 2);
      assert.equal(entry.cumulativeReturns[0].date, '2025-01-06');
    });
    assert.equal(view.securities[0].suppliedBars, 5);
    assert.ok(view.narrative.notes.includes('common-window-shortened'));
  });

  it('drops a date that any one security is missing rather than pairing mismatched sessions', () => {
    const view = buildStockComparison({
      securities: [
        security('AAA', series(['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'], [100, 110, 121, 133.1])),
        security('BBB', series(['2025-01-02', '2025-01-06', '2025-01-07'], [50, 55, 60])),
      ],
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(view.commonWindow.dates, ['2025-01-02', '2025-01-06', '2025-01-07']);
    const [aaa] = view.securities;
    assert.deepEqual(
      aaa.dailyReturns.map((point) => point.date),
      ['2025-01-06', '2025-01-07'],
    );
    // The first aligned return spans 01-02 to 01-06, since 01-03 left the comparison entirely.
    assertClose(aaa.dailyReturns[0].value, 0.21, 1e-12);
    assertClose(aaa.dailyReturns[1].value, 0.1, 1e-12);
  });

  it('reports the window length in calendar days and years', () => {
    const start = '2021-01-04';
    const end = addDays(start, 1461);
    const dates = [start, addDays(start, 700), end];
    const view = buildStockComparison({
      securities: [security('AAA', series(dates, [100, 150, 200])), security('BBB', series(dates, [10, 12, 14]))],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.commonWindow.calendarDays, 1461);
    assertClose(view.commonWindow.years, 4);
    assertClose(view.securities[0].cagr, 2 ** (1 / 4) - 1);
  });

  it('refuses to report anything on fewer than three common closes', () => {
    assert.equal(MIN_COMMON_CLOSES, 3);
    assert.throws(
      () =>
        buildStockComparison({
          securities: [
            security('AAA', series(SHORT_WEEK, [100, 110, 99])),
            security('BBB', series(['2025-01-07', '2025-01-08', '2025-01-09'], [50, 52, 55])),
          ],
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('refuses a comparison whose securities share no session at all', () => {
    assert.throws(
      () =>
        buildStockComparison({
          securities: [
            security('AAA', series(['2025-01-02', '2025-01-03', '2025-01-06'], [100, 110, 99])),
            security('BBB', series(['2025-02-03', '2025-02-04', '2025-02-05'], [50, 52, 55])),
          ],
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

describe('metrics recalculated on the common window', () => {
  it('rebases every cumulative series to zero on the first common date', () => {
    const view = buildStockComparison({
      securities: [
        security('AAA', series(['2025-01-02', ...SHORT_WEEK], [10, 100, 110, 99])),
        security('BBB', series(SHORT_WEEK, [50, 52, 55])),
      ],
      annualRiskFreeRate: 0,
    });

    view.securities.forEach((entry) => {
      assert.equal(entry.cumulativeReturns[0].date, '2025-01-06');
      assert.equal(entry.cumulativeReturns[0].value, 0);
    });
    assertClose(view.securities[0].cumulativeReturns[1].value, 0.1);
    assertClose(view.securities[1].cumulativeReturns[2].value, 0.1);
  });

  it('measures return and drawdown only inside the common window', () => {
    const view = buildStockComparison({
      securities: [
        // A 50% collapse before the common window starts must not follow AAA into the comparison.
        security('AAA', series(['2025-01-02', '2025-01-03', ...SHORT_WEEK], [200, 100, 100, 110, 121])),
        security('BBB', series(SHORT_WEEK, [50, 45, 55])),
      ],
      annualRiskFreeRate: 0,
    });

    const [aaa, bbb] = view.securities;
    assert.equal(aaa.firstClose, 100);
    assert.equal(aaa.lastClose, 121);
    assertClose(aaa.totalPriceReturn, 0.21);
    assert.equal(aaa.maxDrawdown.drawdown, 0);
    assertClose(bbb.maxDrawdown.drawdown, -0.1);
    assert.equal(bbb.maxDrawdown.troughDate, '2025-01-07');
  });

  it('annualizes volatility and Sharpe from the aligned daily returns', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const closes = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const view = buildStockComparison({
      securities: [
        security('AAA', series(dates, closes)),
        security('BBB', series(dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS))),
      ],
      annualRiskFreeRate: 0,
    });

    // Alternating ±10% returns: mean 0, so Sharpe at a 0 risk-free rate is 0.
    const expected = sampleStdDev(dailyReturnValues(closes)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    assertClose(view.securities[0].volatility, expected);
    assertClose(view.securities[0].sharpeRatio, 0);
  });

  it('echoes each security name and instrument type alongside the figures', () => {
    const view = buildStockComparison({
      securities: [
        security('SPY', series(SHORT_WEEK, [100, 110, 99]), { name: 'SPDR S&P 500 ETF Trust', type: 'ETF' }),
        security('AAPL', series(SHORT_WEEK, [50, 52, 55]), { name: 'Apple Inc.', type: 'CS' }),
      ],
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(
      view.securities.map((entry) => [entry.symbol, entry.name, entry.type, entry.currency]),
      [
        ['SPY', 'SPDR S&P 500 ETF Trust', 'ETF', 'USD'],
        ['AAPL', 'Apple Inc.', 'CS', 'USD'],
      ],
    );
    assert.equal(view.excludesDividends, true);
  });
});

describe('correlation matrix', () => {
  it('is symmetric with 1 on the diagonal', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildStockComparison({
      securities: [
        security('AAA', series(dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS))),
        security('BBB', series(dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS, 50))),
        security('CCC', series(dates, alternatingCloses(0.02, MIN_RISK_OBSERVATIONS, 10))),
      ],
      annualRiskFreeRate: 0,
    });

    const { values } = view.correlations;
    for (let row = 0; row < 3; row += 1) {
      assert.equal(values[row][row], 1);
      for (let column = 0; column < 3; column += 1) {
        assert.equal(values[row][column], values[column][row]);
      }
    }
  });

  it('reads +1 for series that move together and -1 for series that move opposite', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildStockComparison({
      securities: [
        security('AAA', series(dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS))),
        // The same daily returns on a different price level.
        security('BBB', series(dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS, 10))),
        // Exactly the opposite daily returns.
        security('CCC', series(dates, alternatingCloses(-0.1, MIN_RISK_OBSERVATIONS))),
      ],
      annualRiskFreeRate: 0,
    });

    const { values } = view.correlations;
    assertClose(values[0][1], 1, 1e-9);
    assertClose(values[0][2], -1, 1e-9);
  });

  it('leaves the whole row undefined for a series that never moved, including its diagonal', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildStockComparison({
      securities: [
        security('FLAT', series(dates, Array.from({ length: MIN_RISK_OBSERVATIONS + 1 }, () => 100))),
        security('BBB', series(dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS))),
      ],
      annualRiskFreeRate: 0,
    });

    const { values } = view.correlations;
    assert.equal(values[0][0], undefined);
    assert.equal(values[0][1], undefined);
    assert.equal(values[1][0], undefined);
    assert.equal(values[1][1], 1);

    const [flat] = view.securities;
    assert.equal(flat.volatility, 0);
    assert.equal(flat.sharpeRatio, undefined);
    assert.equal(flat.cagr, 0);
    assert.equal(flat.maxDrawdown.drawdown, 0);
  });

  it('keeps a cell undefined when two series share too few returns to correlate', () => {
    const matrix = buildCorrelationMatrix([
      { symbol: 'AAA', returns: [{ date: '2025-01-07', value: 0.1 }] },
      { symbol: 'BBB', returns: [{ date: '2025-01-07', value: 0.2 }] },
    ]);

    assert.deepEqual(matrix.symbols, ['AAA', 'BBB']);
    assert.deepEqual(matrix.values, [
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe('benchmark', () => {
  it('reports no benchmark and no beta when none was supplied', () => {
    const view = buildStockComparison({ securities: twoSecurities(), annualRiskFreeRate: 0 });

    assert.equal(view.benchmark, undefined);
    view.securities.forEach((entry) => assert.equal(entry.beta, undefined));
    assert.ok(view.narrative.notes.includes('benchmark-unavailable'));
  });

  it('measures beta against the benchmark over the common window', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const benchmarkCloses = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const view = buildStockComparison({
      securities: [
        security('AAA', series(dates, alternatingCloses(0.2, MIN_RISK_OBSERVATIONS))),
        security('BBB', series(dates, benchmarkCloses)),
      ],
      benchmark: security('SPY', series(dates, benchmarkCloses), { type: 'ETF' }),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.benchmark?.symbol, 'SPY');
    assert.equal(view.benchmark?.type, 'ETF');
    assert.equal(view.benchmark?.overlappingSessions, dates.length);
    assert.equal(view.benchmark?.coversCommonWindow, true);
    assert.equal(view.benchmark?.startDate, dates[0]);
    assert.equal(view.benchmark?.endDate, dates[dates.length - 1]);
    assertClose(view.securities[0].beta, 2, 1e-12);
    assertClose(view.securities[1].beta, 1, 1e-12);
    assert.ok(!view.narrative.notes.includes('benchmark-partial-overlap'));
  });

  it('uses only the sessions the benchmark shares and says the overlap was partial', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 2);
    // The benchmark trades every common session but the last, so the overlap is one
    // session short of the window while still spanning enough returns to regress.
    const benchmarkDates = dates.slice(0, MIN_RISK_OBSERVATIONS + 1);
    const view = buildStockComparison({
      securities: [
        security('AAA', series(dates, alternatingCloses(0.2, MIN_RISK_OBSERVATIONS + 1))),
        security('BBB', series(dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS + 1))),
      ],
      benchmark: security('SPY', series(benchmarkDates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS)), {
        type: 'ETF',
      }),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.commonWindow.sessions, MIN_RISK_OBSERVATIONS + 2);
    assert.equal(view.benchmark?.overlappingSessions, MIN_RISK_OBSERVATIONS + 1);
    assert.equal(view.benchmark?.coversCommonWindow, false);
    assert.equal(view.benchmark?.endDate, benchmarkDates[benchmarkDates.length - 1]);
    assert.ok(view.narrative.notes.includes('benchmark-partial-overlap'));
    assert.ok(view.securities[0].beta !== undefined);
  });

  it('leaves beta undefined when the benchmark shares too few sessions to regress', () => {
    const view = buildStockComparison({
      securities: [
        security('AAA', series(SHORT_WEEK, DOUBLE_BETA_CLOSES)),
        security('BBB', series(SHORT_WEEK, BENCHMARK_CLOSES)),
      ],
      benchmark: security('SPY', series(['2025-01-02', '2025-01-06'], [90, 100]), { type: 'ETF' }),
      annualRiskFreeRate: 0,
    });

    assert.equal(view.benchmark?.overlappingSessions, 1);
    assert.equal(view.benchmark?.coversCommonWindow, false);
    view.securities.forEach((entry) => assert.equal(entry.beta, undefined));
  });

  it('rejects a benchmark with an empty price series', () => {
    assert.throws(
      () =>
        buildStockComparison({
          securities: twoSecurities(),
          benchmark: security('SPY', []),
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

/** A security whose provider supplied a complete aligned adjusted-close axis. */
function covered(ticker: string, dates: DateString[], closes: number[], adjusted: number[]): MarketData {
  const prices = series(dates, closes).map((bar, index) => ({ ...bar, adjustedClose: adjusted[index] }));
  return security(ticker, prices, {
    source: 'yahoo',
    provenance: {
      priceProvider: 'yahoo',
      priceBasis: 'split-adjusted',
      lastCompletedSession: dates[dates.length - 1],
      fetchedAt: '2026-07-27T00:00:00.000Z',
      dividendCoverage: 'not-requested',
      totalReturnCoverage: 'yahoo-adjusted-close',
      splitCoverage: 'none-reported',
      reorganizationCoverage: 'provider-reported-only',
      mode: 'analysis',
    },
  });
}

describe('return basis', () => {
  it('uses total return for every asset only when all have adjusted-close coverage', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const closes = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const adjusted = closes.map((close, index) => close * (0.9 + (0.1 * index) / closes.length));
    const view = buildStockComparison({
      securities: [covered('AAA', dates, closes, adjusted), covered('BBB', dates, closes, adjusted)],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.returnBasis, 'total');
    assert.equal(view.excludesDividends, false);
    assert.ok(view.narrative.notes.includes('total-return-basis'));
    assert.ok(!view.narrative.notes.includes('price-return-only'));
    view.securities.forEach((entry) => assert.notEqual(entry.totalReturn, undefined));
  });

  it('degrades to price return for ALL assets when any lacks coverage, never mixing', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const closes = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const adjusted = closes.map((close, index) => close * (0.9 + (0.1 * index) / closes.length));
    const view = buildStockComparison({
      // BBB is demo data with no adjusted-close coverage.
      securities: [covered('AAA', dates, closes, adjusted), security('BBB', series(dates, closes))],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.returnBasis, 'price');
    assert.equal(view.excludesDividends, true);
    assert.ok(view.narrative.notes.includes('price-return-only'));
  });
});

describe('comparison narrative', () => {
  it('names the highest historical CAGR and the lowest historical volatility', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildStockComparison({
      securities: [
        // Small daily swings with a gentle upward drift: lowest volatility.
        security('CALM', series(dates, driftingCloses(0.003, 0.002, MIN_RISK_OBSERVATIONS))),
        // Large daily swings with a strong upward drift: highest CAGR, higher volatility.
        security('FAST', series(dates, driftingCloses(0.08, 0.04, MIN_RISK_OBSERVATIONS))),
      ],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.narrative.highestCagr?.symbol, 'FAST');
    assert.equal(view.narrative.lowestVolatility?.symbol, 'CALM');
    assert.equal(view.narrative.startDate, dates[0]);
    assert.equal(view.narrative.endDate, dates[dates.length - 1]);
    assert.equal(view.narrative.sessions, dates.length);
    assert.ok(view.narrative.notes.includes('price-return-only'));
    assert.ok(view.narrative.notes.includes('not-investment-advice'));
    assert.ok(!view.narrative.notes.includes('common-window-shortened'));
  });

  it('resolves a CAGR tie alphabetically and lists every tied security', () => {
    const closes = [100, 110, 121];
    const view = buildStockComparison({
      securities: [security('ZZZ', series(SHORT_WEEK, closes)), security('AAA', series(SHORT_WEEK, closes))],
      annualRiskFreeRate: 0,
    });

    assert.equal(view.narrative.highestCagr?.symbol, 'AAA');
    assert.deepEqual(view.narrative.highestCagr?.tiedSymbols, ['AAA', 'ZZZ']);
  });

  it('resolves a volatility tie the same way regardless of input order', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const closes = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const forward = buildStockComparison({
      securities: [security('ZZZ', series(dates, closes)), security('AAA', series(dates, closes))],
      annualRiskFreeRate: 0,
    });
    const reversed = buildStockComparison({
      securities: [security('AAA', series(dates, closes)), security('ZZZ', series(dates, closes))],
      annualRiskFreeRate: 0,
    });

    assert.equal(forward.narrative.lowestVolatility?.symbol, 'AAA');
    assert.deepEqual(forward.narrative.lowestVolatility?.tiedSymbols, ['AAA', 'ZZZ']);
    assert.deepEqual(reversed.narrative.lowestVolatility, forward.narrative.lowestVolatility);
  });

  it('omits an extreme entirely when a security has no figure to compare', () => {
    const narrative = describeComparison(
      [
        comparedStub({ symbol: 'AAA', cagr: 0.2, volatility: 0.3 }),
        comparedStub({ symbol: 'BBB', cagr: undefined, volatility: undefined }),
      ],
      STUB_WINDOW,
    );

    assert.equal(narrative.highestCagr, undefined);
    assert.equal(narrative.lowestVolatility, undefined);
    assert.ok(narrative.notes.includes('cagr-not-comparable'));
    assert.ok(narrative.notes.includes('volatility-not-comparable'));
  });

  it('always discloses that figures are price-return only and not advice', () => {
    const narrative = describeComparison(
      [comparedStub({ symbol: 'AAA' }), comparedStub({ symbol: 'BBB', cagr: 0.05, volatility: 0.1 })],
      STUB_WINDOW,
      {
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        type: 'ETF',
        overlappingSessions: 3,
        startDate: SHORT_WEEK[0],
        endDate: SHORT_WEEK[2],
        coversCommonWindow: true,
      },
    );

    assert.deepEqual(narrative.notes, ['price-return-only', 'not-investment-advice']);
    assert.equal(narrative.highestCagr?.symbol, 'AAA');
    assert.equal(narrative.lowestVolatility?.symbol, 'BBB');
  });
});
