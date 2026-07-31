import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  HOLDING_CONCENTRATION_THRESHOLD,
  MIN_RISK_OBSERVATIONS,
  WEIGHT_SUM_TOLERANCE,
  annualizedSharpeRatio,
  annualizedSortinoRatio,
  annualizedVolatility,
  compoundAnnualGrowthRate,
  dailyCloseReturns,
  historicalValueAtRisk,
  jensenAlpha,
  maxCloseDrawdown,
} from '@/domain/analytics';
import {
  ATTRIBUTION_CROSS_CHECK_TOLERANCE,
  MAX_PORTFOLIO_HOLDINGS,
  MIN_PORTFOLIO_HOLDINGS,
  PORTFOLIO_VAR_CONFIDENCE,
  analyzePortfolioConcentration,
  buildPortfolioLab,
  classifyConcentration,
} from '@/domain/portfolio-lab';
import type { PortfolioLabHoldingInput } from '@/domain/portfolio-lab';
import { MIN_COMMON_CLOSES } from '@/domain/stock-comparison';
import type { DateString, DividendEvent, MarketData, PriceBar } from '@/types/backtest';
import { addDays } from '@/utils/date';

function bars(dates: DateString[], closes: number[]): PriceBar[] {
  return dates.map((date, index) => {
    const close = closes[index];
    return { date, open: close, high: close, low: close, close };
  });
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

/** One holding on `dates`, with the given closes and target weight. */
function holding(
  ticker: string,
  dates: DateString[],
  closes: number[],
  weight: number,
): PortfolioLabHoldingInput {
  return { marketData: security(ticker, bars(dates, closes)), weight };
}

/** A holding whose provider supplied a complete aligned adjusted-close axis. */
function coveredHolding(
  ticker: string,
  dates: DateString[],
  closes: number[],
  adjusted: number[],
  weight: number,
): PortfolioLabHoldingInput {
  const prices = bars(dates, closes).map((bar, index) => ({ ...bar, adjustedClose: adjusted[index] }));
  return {
    marketData: security(ticker, prices, {
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
    }),
    weight,
  };
}

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

const WEEK = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];

/** Three shared sessions, the shortest window the engine accepts. */
const THREE = WEEK.slice(0, 3);
const FOUR = WEEK.slice(0, 4);

const CAPITAL = 1000;

/** Up 10% then down 10%: two returns, a -10% drawdown, and a stressed volatility band. */
const SWING = [100, 110, 99];

/** A doubles in two steps while B never moves. */
function doubleAndFlat(): PortfolioLabHoldingInput[] {
  return [
    holding('AAA', THREE, [100, 150, 200], 0.5),
    holding('BBB', THREE, [100, 100, 100], 0.5),
  ];
}

function equalWeighted(
  count: number,
  closes: number[] = SWING,
  dates: DateString[] = THREE,
): PortfolioLabHoldingInput[] {
  return Array.from({ length: count }, (unused, index) =>
    holding(`SYM${index}`, dates, closes, 1 / count),
  );
}

/** `count` consecutive calendar dates from `start`. */
function days(count: number, start: DateString = '2025-02-03'): DateString[] {
  return Array.from({ length: count }, (unused, index) => addDays(start, index));
}

function closesFromReturns(returnValues: number[], base = 100): number[] {
  const closes = [base];
  for (const value of returnValues) closes.push(closes[closes.length - 1] * (1 + value));
  return closes;
}

/** `count + 1` closes producing `count` alternating ±magnitude daily returns from `base`. */
function alternatingCloses(magnitude: number, count: number, base = 100): number[] {
  return closesFromReturns(
    Array.from({ length: count }, (unused, index) => (index % 2 === 0 ? magnitude : -magnitude)),
    base,
  );
}

/** Flat closes over `count + 1` sessions (no movement). */
function flatCloses(count: number, level = 100): number[] {
  return Array.from({ length: count + 1 }, () => level);
}

/**
 * 60 daily returns whose ±10%/−6% oscillation is a stressed volatility band, with a
 * sustained decline that carries the value into the deep (not severe) drawdown band.
 */
function deepStressedCloses(): number[] {
  const returnValues: number[] = [];
  // Rising, high-volatility section; the last move is an up that sets the global peak.
  for (let index = 0; index < 45; index += 1) returnValues.push(index % 2 === 0 ? 0.1 : -0.06);
  // Four −4% sessions ≈ −15% from that peak: the deep (not severe) drawdown band.
  returnValues.push(-0.04, -0.04, -0.04, -0.04);
  // Recover with the same oscillation, starting on an up so the drawdown stays ≈ −15%.
  let up = true;
  while (returnValues.length < MIN_RISK_OBSERVATIONS) {
    returnValues.push(up ? 0.1 : -0.06);
    up = !up;
  }
  return closesFromReturns(returnValues);
}

describe('holding-count bounds', () => {
  it('accepts a single holding at weight 1', () => {
    assert.equal(MIN_PORTFOLIO_HOLDINGS, 1);
    const view = buildPortfolioLab({
      holdings: [holding('AAA', THREE, SWING, 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.holdings.length, 1);
    assert.equal(view.holdings[0].symbol, 'AAA');
  });

  it('accepts the maximum of ten holdings', () => {
    assert.equal(MAX_PORTFOLIO_HOLDINGS, 10);
    const view = buildPortfolioLab({
      holdings: equalWeighted(10),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.holdings.length, 10);
    assertClose(view.concentration.effectiveHoldings, 10, 1e-9);
  });

  it('rejects an eleventh holding', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: equalWeighted(11),
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('rejects an empty portfolio', () => {
    assert.throws(
      () => buildPortfolioLab({ holdings: [], initialCapital: CAPITAL, annualRiskFreeRate: 0 }),
      AnalyticsError,
    );
  });
});

describe('weight validation', () => {
  it('rejects a negative weight, because short positions are out of scope', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [
            holding('AAA', THREE, SWING, 1.2),
            holding('BBB', THREE, SWING, -0.2),
          ],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('rejects a non-finite weight', () => {
    for (const weight of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          buildPortfolioLab({
            holdings: [holding('AAA', THREE, SWING, weight)],
            initialCapital: CAPITAL,
            annualRiskFreeRate: 0,
          }),
        AnalyticsError,
      );
    }
  });

  it('rejects weights that do not sum to 1', () => {
    for (const weights of [
      [0.5, 0.4],
      [0.7, 0.5],
      [0.5, 0.5 + 1e-5],
    ]) {
      assert.throws(
        () =>
          buildPortfolioLab({
            holdings: [
              holding('AAA', THREE, SWING, weights[0]),
              holding('BBB', THREE, SWING, weights[1]),
            ],
            initialCapital: CAPITAL,
            annualRiskFreeRate: 0,
          }),
        AnalyticsError,
      );
    }
  });

  it('accepts a weight sum inside the shared tolerance', () => {
    const drift = WEIGHT_SUM_TOLERANCE / 2;
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, SWING, 0.5),
        holding('BBB', THREE, SWING, 0.5 + drift),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    // The weights are what the caller asked for; only the deployed capital absorbs the drift.
    assertClose(view.allocatedCapital, CAPITAL * (1 + drift), 1e-9);
  });

  it('allows a zero-weight holding, which buys no shares', () => {
    const view = buildPortfolioLab({
      holdings: [holding('AAA', THREE, SWING, 1), holding('BBB', THREE, SWING, 0)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.holdings[1].shares, 0);
    assert.equal(view.holdings[1].finalValue, 0);
    assert.equal(view.holdings[1].contributionDollars, 0);
  });
});

describe('ticker validation', () => {
  it('trims and uppercases every ticker into the symbol used downstream', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('  aaa ', THREE, SWING, 0.5),
        holding('bbb', THREE, SWING, 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(
      view.holdings.map((entry) => entry.symbol),
      ['AAA', 'BBB'],
    );
    assert.deepEqual(view.correlations.symbols, ['AAA', 'BBB']);
  });

  it('rejects the same ticker twice, however it is cased', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [
            holding('AAA', THREE, SWING, 0.5),
            holding('aaa', THREE, SWING, 0.5),
          ],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('rejects a blank ticker', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [holding('   ', THREE, SWING, 1)],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

describe('capital validation', () => {
  it('rejects capital that is not a finite positive number', () => {
    for (const capital of [0, -1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          buildPortfolioLab({
            holdings: [holding('AAA', THREE, SWING, 1)],
            initialCapital: capital,
            annualRiskFreeRate: 0,
          }),
        AnalyticsError,
      );
    }
  });

  it('rejects a risk-free rate that is not a finite number above -1', () => {
    for (const rate of [Number.NaN, -1, -2, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          buildPortfolioLab({
            holdings: [holding('AAA', THREE, SWING, 1)],
            initialCapital: CAPITAL,
            annualRiskFreeRate: rate,
          }),
        AnalyticsError,
      );
    }
  });
});

describe('price-series validation', () => {
  it('rejects a holding with no price history', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [{ marketData: security('AAA', []), weight: 1 }],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('rejects a non-positive close', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [holding('AAA', THREE, [100, 0, 99], 1)],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });

  it('rejects an overlap shorter than the minimum common closes', () => {
    assert.equal(MIN_COMMON_CLOSES, 3);
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [
            holding('AAA', THREE, SWING, 0.5),
            holding('BBB', WEEK.slice(1, 3), [50, 55], 0.5),
          ],
          initialCapital: CAPITAL,
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

describe('one-asset equivalence', () => {
  it('reproduces the security’s own price metrics exactly', () => {
    const prices = bars(days(MIN_RISK_OBSERVATIONS + 1), alternatingCloses(0.1, MIN_RISK_OBSERVATIONS));
    const view = buildPortfolioLab({
      holdings: [{ marketData: security('AAA', prices), weight: 1 }],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.02,
    });

    const returns = dailyCloseReturns(prices);
    assertClose(view.totalPriceReturn, prices[prices.length - 1].close / prices[0].close - 1);
    assertClose(view.cagr, compoundAnnualGrowthRate(prices) as number);
    assertClose(view.volatility, annualizedVolatility(returns) as number);
    assertClose(view.sharpeRatio, annualizedSharpeRatio(returns, 0.02) as number);
    assert.deepEqual(view.maxDrawdown, maxCloseDrawdown(prices));
    assertClose(view.holdings[0].contributionToTotalReturn, view.totalPriceReturn);
    assert.equal(view.holdings[0].finalWeight, 1);
  });
});

describe('buy-and-hold allocation', () => {
  it('turns 50/50 into a 50% portfolio return and a two-thirds final weight', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assertClose(view.totalPriceReturn, 0.5);
    assertClose(view.finalValue, 1500);
    assertClose(view.holdings[0].finalWeight, 2 / 3);
    assertClose(view.holdings[1].finalWeight, 1 / 3);
    assertClose(view.holdings[0].priceReturn, 1);
    assertClose(view.holdings[1].priceReturn, 0);
  });

  it('deploys the capital once at the entry closes and never rebalances', () => {
    // A doubles then gives it all back; a daily-rebalanced portfolio would have kept +12.5%.
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, [100, 200, 100], 0.5),
        holding('BBB', THREE, [100, 100, 100], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.rebalanced, false);
    assertClose(view.totalPriceReturn, 0);
    assertClose(view.valueSeries[1].value, 1500);
    assertClose(view.finalValue, CAPITAL);
    assert.equal(view.holdings[0].shares, 5);
    assert.equal(view.holdings[1].shares, 5);
  });

  it('values every session from the fixed share counts', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const closes = [
      [100, 150, 200],
      [100, 100, 100],
    ];
    view.valueSeries.forEach((point, index) => {
      const expected = view.holdings.reduce(
        (total, entry, position) => total + entry.shares * closes[position][index],
        0,
      );
      assert.equal(point.value, expected);
      assert.equal(point.date, THREE[index]);
    });
  });

  it('buys fractional shares rather than rounding down to whole ones', () => {
    const view = buildPortfolioLab({
      holdings: [holding('AAA', THREE, [137.42, 141.03, 129.87], 1)],
      initialCapital: 1000,
      annualRiskFreeRate: 0,
    });

    assertClose(view.holdings[0].shares, 1000 / 137.42, 1e-12);
    assert.ok(!Number.isInteger(view.holdings[0].shares));
  });

  it('ignores dividends entirely, so the same closes give the same figures', () => {
    const dividend: DividendEvent = {
      id: 'div-1',
      exDate: THREE[1],
      payDate: THREE[2],
      cashAmount: 5,
      splitAdjustedCashAmount: 5,
      distributionType: 'CD',
      frequency: 4,
    };
    const request = (dividends: DividendEvent[]) => ({
      holdings: [
        { marketData: security('AAA', bars(THREE, SWING), { dividends }), weight: 1 },
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const withDividend = buildPortfolioLab(request([dividend]));
    const without = buildPortfolioLab(request([]));

    assert.equal(withDividend.excludesDividends, true);
    assert.equal(withDividend.finalValue, without.finalValue);
    assert.equal(withDividend.totalPriceReturn, without.totalPriceReturn);
  });
});

describe('common window and history coverage', () => {
  it('starts the window where a later-listing holding starts, and buys at that close', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [90, 100, 110, 121], 0.5),
        holding('BBB', WEEK.slice(1, 4), [50, 50, 50], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.window.startDate, WEEK[1]);
    assert.equal(view.window.endDate, WEEK[3]);
    assert.equal(view.window.sessions, 3);
    assert.deepEqual(view.window.dates, WEEK.slice(1, 4));
    // The entry close is the close on the common start date, never the holding's own first close.
    assert.equal(view.holdings[0].entryClose, 100);
    assert.equal(view.holdings[0].shares, 5);
    assertClose(view.holdings[0].priceReturn, 0.21);
  });

  it('reports supplied history against used history for every holding', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [90, 100, 110, 121], 0.5),
        holding('BBB', WEEK.slice(1, 4), [50, 50, 50], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const [first, second] = view.holdings;
    assert.equal(first.suppliedBars, 4);
    assert.equal(first.suppliedFirstDate, WEEK[0]);
    assert.equal(first.usedSessions, 3);
    assert.equal(first.usedFirstDate, WEEK[1]);
    assert.equal(first.usedLastDate, WEEK[3]);
    assert.equal(second.suppliedBars, 3);
    assert.equal(second.usedSessions, 3);
    assert.deepEqual(view.window.shortenedFor, ['AAA']);
    assert.deepEqual(view.window.startLimitedBy, ['BBB']);
    assert.deepEqual(view.window.endLimitedBy, ['AAA', 'BBB']);
  });

  it('drops a session one holding missed rather than carrying a close forward', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [100, 110, 121, 133.1], 0.5),
        holding('BBB', [WEEK[0], WEEK[1], WEEK[3]], [50, 50, 50], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(view.window.dates, [WEEK[0], WEEK[1], WEEK[3]]);
    assert.equal(view.holdings[0].usedSessions, 3);
    // AAA's middle return spans two sessions because the shared calendar has no 08 January.
    assert.deepEqual(
      view.holdings[0].dailyReturns.map((point) => point.date),
      [WEEK[1], WEEK[3]],
    );
  });
});

describe('attribution', () => {
  it('cross-checks contributions against the portfolio gain and total return', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [137.42, 141.03, 129.87, 152.11], 1 / 3),
        holding('BBB', FOUR, [12.05, 11.4, 13.77, 13.02], 1 / 3),
        holding('CCC', FOUR, [988.11, 1001.9, 977.42, 1043.6], 1 / 3),
      ],
      initialCapital: 25_000,
      annualRiskFreeRate: 0.03,
    });

    const { attribution } = view;
    assert.equal(attribution.tolerance, ATTRIBUTION_CROSS_CHECK_TOLERANCE);
    assert.ok(attribution.withinTolerance, 'attribution must reconcile with the portfolio totals');
    assert.ok(Math.abs(attribution.dollarDifference) <= 1e-9 * view.allocatedCapital);
    assert.ok(Math.abs(attribution.returnDifference) <= ATTRIBUTION_CROSS_CHECK_TOLERANCE);
    assertClose(attribution.portfolioGain, view.finalValue - view.allocatedCapital);
    assertClose(attribution.totalPriceReturn, view.totalPriceReturn);
  });

  it('reports each holding’s contribution in dollars and in percentage points', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const [first, second] = view.holdings;
    assertClose(first.initialAllocation, 500);
    assertClose(first.finalValue, 1000);
    assertClose(first.contributionDollars, 500);
    assertClose(first.contributionToTotalReturn, 0.5);
    assertClose(second.contributionDollars, 0);
    assertClose(second.contributionToTotalReturn, 0);
    assertClose(
      first.contributionToTotalReturn + second.contributionToTotalReturn,
      view.totalPriceReturn,
    );
  });

  it('reports a losing holding as a negative contribution', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, [100, 150, 200], 0.5),
        holding('BBB', THREE, [100, 80, 50], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assertClose(view.holdings[1].contributionDollars, -250);
    assertClose(view.holdings[1].contributionToTotalReturn, -0.25);
    assertClose(view.totalPriceReturn, 0.25);
  });
});

describe('capital scale invariance', () => {
  it('leaves every percentage metric unchanged and scales every dollar figure', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const request = (initialCapital: number) => ({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.06, MIN_RISK_OBSERVATIONS, 137.42), 0.6),
        holding('BBB', dates, alternatingCloses(0.03, MIN_RISK_OBSERVATIONS, 12.05), 0.4),
      ],
      initialCapital,
      annualRiskFreeRate: 0.03,
    });

    const small = buildPortfolioLab(request(1000));
    const large = buildPortfolioLab(request(10_000));

    assertClose(large.totalPriceReturn, small.totalPriceReturn);
    assertClose(large.volatility, small.volatility as number);
    assertClose(large.sharpeRatio, small.sharpeRatio as number);
    assertClose(large.cagr, small.cagr as number);
    assertClose(large.maxDrawdown.drawdown, small.maxDrawdown.drawdown);
    assertClose(large.concentration.herfindahlIndex, small.concentration.herfindahlIndex);
    large.holdings.forEach((entry, index) => {
      assertClose(entry.finalWeight, small.holdings[index].finalWeight);
      assertClose(entry.contributionToTotalReturn, small.holdings[index].contributionToTotalReturn);
      assertClose(entry.shares, small.holdings[index].shares * 10, 1e-9);
      assertClose(entry.finalValue, small.holdings[index].finalValue * 10, 1e-9);
    });
    assertClose(large.finalValue, small.finalValue * 10, 1e-9);
  });
});

describe('flat prices', () => {
  it('reports zero movement without inventing a Sharpe ratio or a correlation', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, flatCloses(MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, flatCloses(MIN_RISK_OBSERVATIONS, 40), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.02,
    });

    assert.equal(view.totalPriceReturn, 0);
    assert.equal(view.volatility, 0);
    assert.equal(view.sharpeRatio, undefined);
    assert.equal(view.maxDrawdown.drawdown, 0);
    assert.equal(view.cagr, 0);
    assert.equal(view.diagnosis.volatilityBand, 'calm');
    assert.deepEqual(view.correlations.values, [
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe('concentration diagnostics', () => {
  it('measures the initial weights, not the drifted final weights', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assertClose(view.concentration.herfindahlIndex, 0.5);
    assertClose(view.concentration.effectiveHoldings, 2);
    assert.equal(view.concentration.largestWeight, 0.5);
    assert.equal(view.concentration.band, 'focused');
    // AAA drifted to two thirds, but the diagnostic still describes the 50/50 the caller chose.
    assertClose(view.holdings[0].finalWeight, 2 / 3);
  });

  it('bands by effective holdings', () => {
    assert.equal(classifyConcentration(1), 'concentrated');
    assert.equal(classifyConcentration(1.9), 'concentrated');
    assert.equal(classifyConcentration(2), 'focused');
    assert.equal(classifyConcentration(3.9), 'focused');
    assert.equal(classifyConcentration(4), 'diversified');
  });

  it('flags a holding above the shared 40% threshold and leaves 40% itself unflagged', () => {
    assert.equal(HOLDING_CONCENTRATION_THRESHOLD, 0.4);

    const flagged = analyzePortfolioConcentration([
      { symbol: 'AAA', weight: 0.9 },
      { symbol: 'BBB', weight: 0.1 },
    ]);
    assert.deepEqual(flagged.flags, [
      { kind: 'holding', label: 'AAA', weight: 0.9, threshold: 0.4 },
    ]);
    assert.equal(flagged.band, 'concentrated');

    const atThreshold = analyzePortfolioConcentration([
      { symbol: 'AAA', weight: 0.4 },
      { symbol: 'BBB', weight: 0.4 },
      { symbol: 'CCC', weight: 0.2 },
    ]);
    assert.deepEqual(atThreshold.flags, []);
  });

  it('states that sector concentration is unavailable instead of inferring a sector', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(view.concentration.sector, {
      available: false,
      reason: 'sector-data-unavailable',
    });
    assert.ok(view.concentration.flags.every((flag) => flag.kind === 'holding'));
    assert.ok(view.diagnosis.notes.some((note) => note.code === 'sector-data-unavailable'));
  });
});

describe('correlation matrix', () => {
  it('is symmetric with a unit diagonal', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS, 50), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const { symbols, values } = view.correlations;
    assert.deepEqual(symbols, ['AAA', 'BBB']);
    assert.equal(values[0][0], 1);
    assert.equal(values[1][1], 1);
    assertClose(values[0][1], values[1][0] as number);
    assert.ok((values[0][1] as number) >= -1 && (values[0][1] as number) <= 1);
  });

  it('reports a perfectly opposed pair as -1 and a perfectly aligned pair as 1', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const opposed = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, alternatingCloses(-0.1, MIN_RISK_OBSERVATIONS), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assertClose(opposed.correlations.values[0][1], -1, 1e-9);

    const aligned = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS, 50), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assertClose(aligned.correlations.values[0][1], 1, 1e-9);
  });

  it('leaves a never-moving holding’s row undefined rather than 0', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, flatCloses(MIN_RISK_OBSERVATIONS, 40), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.correlations.values[0][0], 1);
    assert.equal(view.correlations.values[1][1], undefined);
    assert.equal(view.correlations.values[0][1], undefined);
    assert.equal(view.correlations.values[1][0], undefined);
  });
});

describe('benchmark', () => {
  it('omits the benchmark entirely when none is supplied', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.benchmark, undefined);
    assert.ok(view.diagnosis.notes.some((note) => note.code === 'benchmark-unavailable'));
    assert.ok(!view.diagnosis.notes.some((note) => note.code === 'benchmark-partial-overlap'));
  });

  it('measures beta and correlation against SPY on the shared return dates', () => {
    // The single-holding portfolio moves exactly twice as far as SPY every session.
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [holding('AAA', dates, alternatingCloses(0.2, MIN_RISK_OBSERVATIONS), 1)],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS)), { type: 'ETF' }),
      annualRiskFreeRate: 0,
    });

    assert.ok(view.benchmark);
    assert.equal(view.benchmark.symbol, 'SPY');
    assert.equal(view.benchmark.overlappingSessions, dates.length);
    assert.equal(view.benchmark.coversCommonWindow, true);
    assert.equal(view.benchmark.startDate, dates[0]);
    assert.equal(view.benchmark.endDate, dates[dates.length - 1]);
    assertClose(view.benchmark.beta, 2, 1e-9);
    assertClose(view.benchmark.correlation, 1, 1e-9);
  });

  it('uses only the sessions a partially overlapping benchmark also traded', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 2);
    // The benchmark trades every common session but the last, leaving a partial
    // overlap that still spans enough returns to regress.
    const benchmarkDates = dates.slice(0, MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS + 1), 0.5),
        holding('BBB', dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS + 1), 0.5),
      ],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(benchmarkDates, alternatingCloses(0.08, MIN_RISK_OBSERVATIONS)), {
        type: 'ETF',
      }),
      annualRiskFreeRate: 0,
    });

    assert.ok(view.benchmark);
    assert.equal(view.window.sessions, MIN_RISK_OBSERVATIONS + 2);
    assert.equal(view.benchmark.overlappingSessions, MIN_RISK_OBSERVATIONS + 1);
    assert.equal(view.benchmark.coversCommonWindow, false);
    assert.notEqual(view.benchmark.beta, undefined);
    assert.ok(view.diagnosis.notes.some((note) => note.code === 'benchmark-partial-overlap'));
  });

  it('rejects a benchmark with no price history', () => {
    assert.throws(
      () =>
        buildPortfolioLab({
          holdings: [holding('AAA', THREE, SWING, 1)],
          initialCapital: CAPITAL,
          benchmark: security('SPY', []),
          annualRiskFreeRate: 0,
        }),
      AnalyticsError,
    );
  });
});

describe('educational risk diagnosis', () => {
  it('emits codes in a fixed order and never prose', () => {
    // A stressed-volatility series with a sustained decline into the deep drawdown band.
    const view = buildPortfolioLab({
      holdings: equalWeighted(4, deepStressedCloses(), days(MIN_RISK_OBSERVATIONS + 1)),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.deepEqual(
      view.diagnosis.notes.map((note) => note.code),
      [
        'concentration-diversified',
        'drawdown-deep',
        'volatility-stressed',
        'benchmark-unavailable',
        // 60 aligned returns is a sufficient but sub-year (limited) sample.
        'limited-sample',
        'sector-data-unavailable',
        'price-return-only',
        'no-rebalancing',
        'not-investment-advice',
      ],
    );
    assert.equal(view.diagnosis.educationalOnly, true);
    assert.equal(view.diagnosis.concentrationBand, 'diversified');
    assert.equal(view.diagnosis.drawdownBand, 'deep');
  });

  it('names the over-weighted holding in its concentration note', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, SWING, 0.9),
        holding('BBB', THREE, SWING, 0.1),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    const flagNote = view.diagnosis.notes.find(
      (note) => note.code === 'concentration-holding-above-threshold',
    );
    assert.ok(flagNote);
    assert.equal(flagNote.symbol, 'AAA');
    assert.equal(flagNote.value, 0.9);
    assert.equal(flagNote.severity, 'caution');
    assert.equal(view.diagnosis.concentrationBand, 'concentrated');
  });

  it('bands drawdown severity from the portfolio value series', () => {
    const severe = buildPortfolioLab({
      holdings: [holding('AAA', THREE, [100, 100, 70], 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.equal(severe.diagnosis.drawdownBand, 'severe');
    assertClose(severe.maxDrawdown.drawdown, -0.3, 1e-12);

    const shallow = buildPortfolioLab({
      holdings: [holding('AAA', THREE, [100, 101, 99], 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.equal(shallow.diagnosis.drawdownBand, 'shallow');
  });

  it('bands volatility from the portfolio’s own daily returns', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const calm = buildPortfolioLab({
      holdings: [holding('AAA', dates, alternatingCloses(0.005, MIN_RISK_OBSERVATIONS), 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.equal(calm.diagnosis.volatilityBand, 'calm');

    const stressed = buildPortfolioLab({
      holdings: [holding('AAA', dates, alternatingCloses(0.04, MIN_RISK_OBSERVATIONS), 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.equal(stressed.diagnosis.volatilityBand, 'stressed');
  });

  it('discloses the shortened window only when alignment actually shortened one', () => {
    const shortened = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [90, 100, 110, 121], 0.5),
        holding('BBB', WEEK.slice(1, 4), [50, 50, 50], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.ok(shortened.diagnosis.notes.some((note) => note.code === 'common-window-shortened'));

    const intact = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.ok(!intact.diagnosis.notes.some((note) => note.code === 'common-window-shortened'));
  });

  it('always discloses the no-advice and price-return-only limitations', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(THREE, [400, 404, 402]), { type: 'ETF' }),
      annualRiskFreeRate: 0,
    });

    const limitations = view.diagnosis.notes
      .filter((note) => note.topic === 'limitation')
      .map((note) => note.code);
    assert.deepEqual(limitations, [
      'sector-data-unavailable',
      'price-return-only',
      'no-rebalancing',
      'not-investment-advice',
    ]);
  });
});

describe('reported series', () => {
  it('rebases cumulative returns to 0 and ends them at the total return', () => {
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.cumulativeReturns.length, 3);
    assert.equal(view.cumulativeReturns[0].value, 0);
    assertClose(view.cumulativeReturns[2].value, view.totalPriceReturn);
    assert.equal(view.dailyReturns.length, 2);
    assert.deepEqual(
      view.dailyReturns.map((point) => point.date),
      [THREE[1], THREE[2]],
    );
  });

  it('echoes the risk-free rate the Sharpe ratio used', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.1, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.045,
    });

    assert.equal(view.annualRiskFreeRate, 0.045);
    assertClose(view.sharpeRatio, annualizedSharpeRatio(view.dailyReturns, 0.045) as number);
  });
});

describe('return basis', () => {
  const dates = days(MIN_RISK_OBSERVATIONS + 1);
  const closes = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
  const adjusted = closes.map((close, index) => close * (0.9 + (0.1 * index) / closes.length));

  it('uses total return only when every holding has adjusted-close coverage', () => {
    const view = buildPortfolioLab({
      holdings: [
        coveredHolding('AAA', dates, closes, adjusted, 0.5),
        coveredHolding('BBB', dates, closes, adjusted, 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.returnBasis, 'total');
    assert.equal(view.excludesDividends, false);
    assert.notEqual(view.totalReturn, undefined);
    view.holdings.forEach((holding) => assert.notEqual(holding.totalReturn, undefined));
  });

  it('degrades to price return for the whole portfolio when any holding lacks coverage, never mixing', () => {
    const view = buildPortfolioLab({
      holdings: [
        coveredHolding('AAA', dates, closes, adjusted, 0.5),
        holding('BBB', dates, closes, 0.5), // demo coverage: no adjusted close
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.returnBasis, 'price');
    assert.equal(view.excludesDividends, true);
    assert.equal(view.totalReturn, undefined);
    // Measured on the raw close for everyone, not the adjusted close of the covered holding.
    assertClose(view.totalPriceReturn, closes[closes.length - 1] / closes[0] - 1);
  });

  it('builds the total-return proxy from fixed initial weights, not raw-close shares (hand calc)', () => {
    // Both hold 50% at a constant raw close of 100, so price return is 0. Holding A's adjusted
    // close doubles (50 → 100, +100% on its $500 sleeve) while B's is flat (0%): the fixed-weight
    // total-return proxy ends at $1,500 = +50%, NOT the 0.3333 that shares × adjusted close gives.
    const three = ['2025-01-06', '2025-01-07', '2025-01-08'];
    const view = buildPortfolioLab({
      holdings: [
        coveredHolding('AAA', three, [100, 100, 100], [50, 75, 100], 0.5),
        coveredHolding('BBB', three, [100, 100, 100], [100, 100, 100], 0.5),
      ],
      initialCapital: 1000,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.returnBasis, 'total');
    assertClose(view.totalReturn as number, 0.5);
    assertClose(view.cumulativeReturns[view.cumulativeReturns.length - 1].value, 0.5);
    // Dollar path, price return, and final value stay on the raw split-adjusted close.
    assertClose(view.totalPriceReturn, 0);
    assertClose(view.finalValue, 1000);
    assertClose(view.allocatedCapital, 1000);
  });

  it('is invariant to the vendor adjusted-close scale of any holding', () => {
    const longDates = days(MIN_RISK_OBSERVATIONS + 1);
    const rawA = alternatingCloses(0.03, MIN_RISK_OBSERVATIONS);
    const rawB = alternatingCloses(0.05, MIN_RISK_OBSERVATIONS, 40);
    const adjA = alternatingCloses(0.06, MIN_RISK_OBSERVATIONS, 12);
    const adjB = alternatingCloses(0.04, MIN_RISK_OBSERVATIONS, 80);
    const benchmark = coveredHolding('SPY', longDates, rawB, adjB, 1).marketData;

    const build = (scale: number) =>
      buildPortfolioLab({
        holdings: [
          coveredHolding('AAA', longDates, rawA, adjA.map((value) => value * scale), 0.5),
          coveredHolding('BBB', longDates, rawB, adjB, 0.5),
        ],
        initialCapital: 1000,
        benchmark,
        annualRiskFreeRate: 0.02,
      });

    const base = build(1);
    const scaled = build(1000); // multiply holding A's entire adjusted-close axis by 1000

    assert.equal(base.returnBasis, 'total');
    assert.equal(scaled.returnBasis, 'total');
    assertClose(scaled.totalReturn as number, base.totalReturn as number, 1e-9);
    assertClose(scaled.cagr as number, base.cagr as number, 1e-9);
    assertClose(scaled.volatility as number, base.volatility as number, 1e-9);
    assertClose(scaled.sharpeRatio as number, base.sharpeRatio as number, 1e-9);
    assertClose(scaled.maxDrawdown.drawdown, base.maxDrawdown.drawdown, 1e-9);
    assertClose(scaled.benchmark?.beta as number, base.benchmark?.beta as number, 1e-9);
    assertClose(scaled.benchmark?.correlation as number, base.benchmark?.correlation as number, 1e-9);
    base.cumulativeReturns.forEach((point, index) => {
      assertClose(scaled.cumulativeReturns[index].value, point.value, 1e-9);
    });
  });
});

describe('sortino, value at risk, and benchmark alpha', () => {
  it('reports a Sortino ratio and a 95% one-day VaR consistent with the pure helpers', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', dates, alternatingCloses(0.03, MIN_RISK_OBSERVATIONS), 0.5),
        holding('BBB', dates, alternatingCloses(0.05, MIN_RISK_OBSERVATIONS, 40), 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.02,
    });

    assertClose(view.sortinoRatio, annualizedSortinoRatio(view.dailyReturns, 0.02) as number);
    assert.equal(view.historicalValueAtRisk.confidence, PORTFOLIO_VAR_CONFIDENCE);
    assert.equal(view.historicalValueAtRisk.method, 'historical-nearest-rank');
    assert.equal(view.historicalValueAtRisk.sample, view.dailyReturns.length);
    assertClose(
      view.historicalValueAtRisk.value,
      historicalValueAtRisk(view.dailyReturns, PORTFOLIO_VAR_CONFIDENCE) as number,
    );
  });

  it('gates Sortino and the VaR value on the same sample as volatility and Sharpe', () => {
    // THREE shared sessions → two daily returns, far below the 60-observation floor.
    const view = buildPortfolioLab({
      holdings: [holding('AAA', THREE, SWING, 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });

    assert.equal(view.riskSample.sufficient, false);
    assert.equal(view.volatility, undefined);
    assert.equal(view.sharpeRatio, undefined);
    assert.equal(view.sortinoRatio, undefined);
    assert.equal(view.historicalValueAtRisk.value, undefined);
    // The confidence, method, and sample stay exposed even when the value is unavailable.
    assert.equal(view.historicalValueAtRisk.confidence, PORTFOLIO_VAR_CONFIDENCE);
    assert.equal(view.historicalValueAtRisk.sample, view.dailyReturns.length);
  });

  it('measures benchmark alpha on the overlap and omits it when beta is unavailable', () => {
    const dates = days(MIN_RISK_OBSERVATIONS + 1);
    const benchmarkCloses = alternatingCloses(0.1, MIN_RISK_OBSERVATIONS);
    const view = buildPortfolioLab({
      holdings: [holding('AAA', dates, alternatingCloses(0.2, MIN_RISK_OBSERVATIONS), 1)],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(dates, benchmarkCloses), { type: 'ETF' }),
      annualRiskFreeRate: 0.02,
    });

    assert.ok(view.benchmark);
    assertClose(view.benchmark.beta, 2, 1e-9);
    assertClose(
      view.benchmark.alpha,
      jensenAlpha(view.dailyReturns, dailyCloseReturns(bars(dates, benchmarkCloses)), 0.02) as number,
    );

    const flatBenchmark = buildPortfolioLab({
      holdings: [holding('AAA', dates, alternatingCloses(0.2, MIN_RISK_OBSERVATIONS), 1)],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(dates, flatCloses(MIN_RISK_OBSERVATIONS)), { type: 'ETF' }),
      annualRiskFreeRate: 0.02,
    });

    assert.equal(flatBenchmark.benchmark?.beta, undefined);
    assert.equal(flatBenchmark.benchmark?.alpha, undefined);
  });
});
