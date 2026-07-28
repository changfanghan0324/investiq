import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  AnalyticsError,
  HOLDING_CONCENTRATION_THRESHOLD,
  WEIGHT_SUM_TOLERANCE,
  annualizedSharpeRatio,
  annualizedVolatility,
  compoundAnnualGrowthRate,
  dailyCloseReturns,
  maxCloseDrawdown,
} from '@/domain/analytics';
import {
  ATTRIBUTION_CROSS_CHECK_TOLERANCE,
  MAX_PORTFOLIO_HOLDINGS,
  MIN_PORTFOLIO_HOLDINGS,
  analyzePortfolioConcentration,
  buildPortfolioLab,
  classifyConcentration,
} from '@/domain/portfolio-lab';
import type { PortfolioLabHoldingInput } from '@/domain/portfolio-lab';
import { MIN_COMMON_CLOSES } from '@/domain/stock-comparison';
import type { DateString, DividendEvent, MarketData, PriceBar } from '@/types/backtest';

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

function equalWeighted(count: number, closes: number[] = SWING): PortfolioLabHoldingInput[] {
  return Array.from({ length: count }, (unused, index) =>
    holding(`SYM${index}`, THREE, closes, 1 / count),
  );
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
    const prices = bars(FOUR, [100, 110, 99, 120]);
    const view = buildPortfolioLab({
      holdings: [{ marketData: security('AAA', prices), weight: 1 }],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.02,
    });

    const returns = dailyCloseReturns(prices);
    assertClose(view.totalPriceReturn, 120 / 100 - 1);
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
    const request = (initialCapital: number) => ({
      holdings: [
        holding('AAA', FOUR, [137.42, 141.03, 129.87, 152.11], 0.6),
        holding('BBB', FOUR, [12.05, 11.4, 13.77, 13.02], 0.4),
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
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, [100, 100, 100], 0.5),
        holding('BBB', THREE, [40, 40, 40], 0.5),
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
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [100, 110, 99, 120], 0.5),
        holding('BBB', FOUR, [50, 48, 52, 51], 0.5),
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
    const opposed = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, [100, 110, 99], 0.5),
        holding('BBB', THREE, [100, 90, 99], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assertClose(opposed.correlations.values[0][1], -1, 1e-9);

    const aligned = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, [100, 110, 99], 0.5),
        holding('BBB', THREE, [50, 55, 49.5], 0.5),
      ],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assertClose(aligned.correlations.values[0][1], 1, 1e-9);
  });

  it('leaves a never-moving holding’s row undefined rather than 0', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', THREE, SWING, 0.5),
        holding('BBB', THREE, [40, 40, 40], 0.5),
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
    // The portfolio moves exactly twice as far as SPY on both sessions.
    const view = buildPortfolioLab({
      holdings: [holding('AAA', THREE, [100, 120, 96], 1)],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars(THREE, [100, 110, 99]), { type: 'ETF' }),
      annualRiskFreeRate: 0,
    });

    assert.ok(view.benchmark);
    assert.equal(view.benchmark.symbol, 'SPY');
    assert.equal(view.benchmark.overlappingSessions, 3);
    assert.equal(view.benchmark.coversCommonWindow, true);
    assert.equal(view.benchmark.startDate, THREE[0]);
    assert.equal(view.benchmark.endDate, THREE[2]);
    assertClose(view.benchmark.beta, 2, 1e-9);
    assertClose(view.benchmark.correlation, 1, 1e-9);
  });

  it('uses only the sessions a partially overlapping benchmark also traded', () => {
    const view = buildPortfolioLab({
      holdings: [
        holding('AAA', FOUR, [100, 110, 121, 133.1], 0.5),
        holding('BBB', FOUR, [50, 55, 60.5, 66.55], 0.5),
      ],
      initialCapital: CAPITAL,
      benchmark: security('SPY', bars([WEEK[0], WEEK[1], WEEK[3]], [400, 404, 412]), {
        type: 'ETF',
      }),
      annualRiskFreeRate: 0,
    });

    assert.ok(view.benchmark);
    assert.equal(view.window.sessions, 4);
    assert.equal(view.benchmark.overlappingSessions, 3);
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
    // Up 10% then down to 85% of the peak: unambiguously inside the `deep` drawdown band.
    const view = buildPortfolioLab({
      holdings: equalWeighted(4, [100, 110, 93.5]),
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
    const calm = buildPortfolioLab({
      holdings: [holding('AAA', THREE, [1000, 1005, 999.975], 1)],
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0,
    });
    assert.equal(calm.diagnosis.volatilityBand, 'calm');

    const stressed = buildPortfolioLab({
      holdings: [holding('AAA', THREE, SWING, 1)],
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
    const view = buildPortfolioLab({
      holdings: doubleAndFlat(),
      initialCapital: CAPITAL,
      annualRiskFreeRate: 0.045,
    });

    assert.equal(view.annualRiskFreeRate, 0.045);
    assertClose(view.sharpeRatio, annualizedSharpeRatio(view.dailyReturns, 0.045) as number);
  });
});
