import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { AnalyticsError, MIN_RISK_OBSERVATIONS, TRADING_DAYS_PER_YEAR } from '@/domain/analytics';
import {
  BENCHMARK_SYMBOLS,
  DRAWDOWN_BAND_LIMITS,
  MAX_WATCHLIST_SYMBOLS,
  VOLATILITY_BAND_LIMITS,
  addWatchlistSymbol,
  buildNormalizedSeries,
  classifyDrawdown,
  classifyVolatility,
  deriveMarketRisk,
  isValidSymbol,
  normalizeSymbol,
  parseStoredWatchlist,
  removeWatchlistSymbol,
  summarizePriceWindow,
  trailingWindow,
  windowHasTotalReturn,
} from '@/domain/market-overview';
import type { PriceWindowSummary } from '@/domain/market-overview';
import type { DateString, PriceBar } from '@/types/backtest';
import { addDays } from '@/utils/date';

function bars(entries: [DateString, number][]): PriceBar[] {
  return entries.map(([date, close]) => ({ date, open: close, high: close, low: close, close }));
}

/** Bars from a list of closes on consecutive calendar days. */
function sequentialClosingBars(closes: number[], start: DateString = '2025-01-02'): PriceBar[] {
  return closes.map((close, index) => ({
    date: addDays(start, index),
    open: close,
    high: close,
    low: close,
    close,
  }));
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

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-12): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function summary(overrides: Partial<PriceWindowSummary>): PriceWindowSummary {
  return {
    firstDate: '2025-01-02',
    lastDate: '2025-12-31',
    barCount: 250,
    close: 100,
    maxDrawdown: 0,
    ...overrides,
  };
}

describe('benchmark proxies', () => {
  it('loads SPY, QQQ, and DIA in that order', () => {
    assert.deepEqual([...BENCHMARK_SYMBOLS], ['SPY', 'QQQ', 'DIA']);
  });
});

describe('trailingWindow', () => {
  it('keeps bars on or after the window start and drops earlier ones', () => {
    const series = bars([
      ['2024-12-30', 90],
      ['2024-12-31', 95],
      ['2025-01-02', 100],
      ['2025-01-03', 105],
    ]);
    assert.deepEqual(
      trailingWindow(series, '2024-12-31').map((bar) => bar.date),
      ['2024-12-31', '2025-01-02', '2025-01-03'],
    );
  });

  it('returns an empty window when every bar predates the start', () => {
    assert.deepEqual(trailingWindow(bars([['2024-01-02', 100]]), '2025-01-01'), []);
  });
});

describe('summarizePriceWindow', () => {
  it('reports the closing price, window return, and worst close-to-close drawdown', () => {
    const result = summarizePriceWindow(
      bars([
        ['2025-01-02', 100],
        ['2025-01-03', 110],
        ['2025-01-06', 88],
        ['2025-01-07', 121],
      ]),
    );

    assert.equal(result.firstDate, '2025-01-02');
    assert.equal(result.lastDate, '2025-01-07');
    assert.equal(result.barCount, 4);
    assert.equal(result.close, 121);
    assertClose(result.priceReturn, 0.21);
    assertClose(result.maxDrawdown, -0.2);
  });

  it('annualizes the sample standard deviation of daily closes over a sufficient window', () => {
    // 61 closes → 60 daily returns (the minimum a risk figure is reported on),
    // alternating +10% / -10% so the sample deviation is well defined.
    const closes = [100];
    for (let index = 0; index < MIN_RISK_OBSERVATIONS; index += 1) {
      closes.push(closes[closes.length - 1] * (index % 2 === 0 ? 1.1 : 0.9));
    }
    const result = summarizePriceWindow(sequentialClosingBars(closes));
    const expected = sampleStdDev(dailyReturnValues(closes)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    assertClose(result.volatility, expected, 1e-12);
  });

  it('leaves return and volatility undefined for a single bar rather than reporting zero', () => {
    const result = summarizePriceWindow(bars([['2025-01-02', 100]]));
    assert.equal(result.priceReturn, undefined);
    assert.equal(result.volatility, undefined);
    assert.equal(result.maxDrawdown, 0);
    assert.equal(result.close, 100);
  });

  it('leaves volatility undefined with only two bars, where no sample deviation exists', () => {
    const result = summarizePriceWindow(
      bars([
        ['2025-01-02', 100],
        ['2025-01-03', 110],
      ]),
    );
    assertClose(result.priceReturn, 0.1);
    assert.equal(result.volatility, undefined);
  });

  it('rejects an empty window instead of inventing a summary', () => {
    assert.throws(() => summarizePriceWindow([]), AnalyticsError);
  });
});

describe('buildNormalizedSeries', () => {
  it('rebases every symbol to zero on the first shared trading day', () => {
    const points = buildNormalizedSeries([
      { symbol: 'SPY', bars: bars([['2025-01-02', 100], ['2025-01-03', 110]]) },
      { symbol: 'QQQ', bars: bars([['2025-01-02', 50], ['2025-01-03', 40]]) },
    ]);

    assert.equal(points.length, 2);
    assert.equal(points[0].values.SPY, 0);
    assert.equal(points[0].values.QQQ, 0);
    assertClose(points[1].values.SPY, 0.1);
    assertClose(points[1].values.QQQ, -0.2);
  });

  it('drops dates that any symbol is missing so mismatched days never pair up', () => {
    const points = buildNormalizedSeries([
      {
        symbol: 'SPY',
        bars: bars([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 120]]),
      },
      { symbol: 'QQQ', bars: bars([['2025-01-02', 50], ['2025-01-06', 60]]) },
    ]);

    assert.deepEqual(points.map((point) => point.date), ['2025-01-02', '2025-01-06']);
    assertClose(points[1].values.SPY, 0.2);
    assertClose(points[1].values.QQQ, 0.2);
  });

  it('charts a lone symbol against its own history', () => {
    const points = buildNormalizedSeries([
      { symbol: 'SPY', bars: bars([['2025-01-02', 100], ['2025-01-03', 105]]) },
    ]);
    assert.equal(points.length, 2);
    assertClose(points[1].values.SPY, 0.05);
  });

  it('returns nothing when no symbol loaded or no date is shared', () => {
    assert.deepEqual(buildNormalizedSeries([]), []);
    assert.deepEqual(buildNormalizedSeries([{ symbol: 'SPY', bars: [] }]), []);
    assert.deepEqual(
      buildNormalizedSeries([
        { symbol: 'SPY', bars: bars([['2025-01-02', 100]]) },
        { symbol: 'QQQ', bars: bars([['2025-01-03', 50]]) },
      ]),
      [],
    );
  });
});

/** Bars carrying an adjusted close, so a window has total-return coverage. */
function coveredBars(entries: [DateString, number, number][]): PriceBar[] {
  return entries.map(([date, close, adjustedClose]) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    adjustedClose,
  }));
}

describe('return basis (price vs vendor-adjusted total)', () => {
  it('exposes total return only when every bar in the window is covered', () => {
    const covered = summarizePriceWindow(coveredBars([['2025-01-02', 100, 90], ['2025-01-03', 110, 108]]));
    assertClose(covered.priceReturn, 0.1);
    assertClose(covered.totalReturn, 108 / 90 - 1);

    const partial = summarizePriceWindow([
      { date: '2025-01-02', open: 100, high: 100, low: 100, close: 100, adjustedClose: 90 },
      { date: '2025-01-03', open: 110, high: 110, low: 110, close: 110 },
    ]);
    assertClose(partial.priceReturn, 0.1);
    assert.equal(partial.totalReturn, undefined);
  });

  it('windowHasTotalReturn reflects complete adjusted-close coverage', () => {
    assert.equal(windowHasTotalReturn(coveredBars([['2025-01-02', 100, 90], ['2025-01-03', 110, 108]])), true);
    assert.equal(windowHasTotalReturn(bars([['2025-01-02', 100], ['2025-01-03', 110]])), false);
    assert.equal(windowHasTotalReturn([]), false);
  });

  it('never mixes bases: one uncovered member forces price return for every symbol', () => {
    const spy = coveredBars([['2025-01-02', 100, 90], ['2025-01-03', 110, 108]]); // price +10%, total +20%
    const qqqUncovered = bars([['2025-01-02', 50], ['2025-01-03', 55]]); // no coverage, price +10%

    const mixedBasis = [spy, qqqUncovered].every(windowHasTotalReturn) ? 'total' : 'price';
    assert.equal(mixedBasis, 'price');
    const priced = buildNormalizedSeries(
      [{ symbol: 'SPY', bars: spy }, { symbol: 'QQQ', bars: qqqUncovered }],
      mixedBasis,
    );
    // SPY uses its raw close (+10%), NOT its adjusted close (+20%): no mixing.
    assertClose(priced[1].values.SPY, 0.1);
    assertClose(priced[1].values.QQQ, 0.1);

    const qqqCovered = coveredBars([['2025-01-02', 50, 45], ['2025-01-03', 55, 54]]); // total +20%
    const sharedBasis = [spy, qqqCovered].every(windowHasTotalReturn) ? 'total' : 'price';
    assert.equal(sharedBasis, 'total');
    const totals = buildNormalizedSeries(
      [{ symbol: 'SPY', bars: spy }, { symbol: 'QQQ', bars: qqqCovered }],
      sharedBasis,
    );
    // Both symbols now use adjusted close (+20%).
    assertClose(totals[1].values.SPY, 108 / 90 - 1);
    assertClose(totals[1].values.QQQ, 54 / 45 - 1);
  });
});

describe('watchlist rules', () => {
  it('normalizes case and surrounding whitespace', () => {
    assert.equal(normalizeSymbol('  spy \n'), 'SPY');
    assert.equal(normalizeSymbol('brk.b'), 'BRK.B');
  });

  it('accepts US ticker shapes and rejects everything else', () => {
    for (const symbol of ['AAPL', 'VOO', 'BRK.B', 'RDS-A', 'F']) {
      assert.ok(isValidSymbol(symbol), `${symbol} should be valid`);
    }
    for (const symbol of ['', 'aapl', 'AA PL', 'TOOLONGTICKER1', 'AAPL$', '<script>']) {
      assert.ok(!isValidSymbol(symbol), `${symbol} should be rejected`);
    }
  });

  it('appends a normalized symbol', () => {
    const result = addWatchlistSymbol(['AAPL'], ' msft ');
    assert.deepEqual(result.symbols, ['AAPL', 'MSFT']);
    assert.equal(result.added, 'MSFT');
    assert.equal(result.rejected, undefined);
  });

  it('rejects an invalid entry without changing the list', () => {
    const existing = ['AAPL'];
    const result = addWatchlistSymbol(existing, 'not a ticker');
    assert.equal(result.rejected, 'invalid');
    assert.deepEqual(result.symbols, existing);
  });

  it('de-duplicates case-insensitively', () => {
    const result = addWatchlistSymbol(['AAPL'], 'aapl');
    assert.equal(result.rejected, 'duplicate');
    assert.deepEqual(result.symbols, ['AAPL']);
  });

  it('stops at the maximum of ten entries', () => {
    const full = Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, index) => `T${index}`);
    const result = addWatchlistSymbol(full, 'NVDA');
    assert.equal(MAX_WATCHLIST_SYMBOLS, 10);
    assert.equal(result.rejected, 'full');
    assert.deepEqual(result.symbols, full);
  });

  it('removes by normalized symbol', () => {
    assert.deepEqual(removeWatchlistSymbol(['AAPL', 'MSFT'], ' msft'), ['AAPL']);
    assert.deepEqual(removeWatchlistSymbol(['AAPL'], 'NVDA'), ['AAPL']);
  });
});

describe('parseStoredWatchlist', () => {
  it('reads a saved symbol array', () => {
    assert.deepEqual(parseStoredWatchlist('["AAPL","MSFT"]'), ['AAPL', 'MSFT']);
  });

  it('treats a missing or malformed slot as an empty watchlist', () => {
    assert.deepEqual(parseStoredWatchlist(null), []);
    assert.deepEqual(parseStoredWatchlist(''), []);
    assert.deepEqual(parseStoredWatchlist('{oops'), []);
    assert.deepEqual(parseStoredWatchlist('{"symbols":["AAPL"]}'), []);
  });

  it('discards non-strings, invalid tickers, and duplicates', () => {
    assert.deepEqual(
      parseStoredWatchlist(JSON.stringify(['aapl', 42, null, { symbol: 'X' }, 'AAPL', 'bad ticker', 'msft'])),
      ['AAPL', 'MSFT'],
    );
  });

  it('caps a tampered slot at the maximum length', () => {
    const stored = JSON.stringify(Array.from({ length: 40 }, (_, index) => `T${index}`));
    assert.equal(parseStoredWatchlist(stored).length, MAX_WATCHLIST_SYMBOLS);
  });
});

describe('risk bands', () => {
  it('classifies volatility on the documented thresholds', () => {
    assert.equal(classifyVolatility(0), 'calm');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.calm - 1e-9), 'calm');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.calm), 'normal');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.normal - 1e-9), 'normal');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.normal), 'elevated');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.elevated - 1e-9), 'elevated');
    assert.equal(classifyVolatility(VOLATILITY_BAND_LIMITS.elevated), 'stressed');
    assert.equal(classifyVolatility(0.9), 'stressed');
  });

  it('classifies drawdown on the documented thresholds', () => {
    assert.equal(classifyDrawdown(0), 'shallow');
    assert.equal(classifyDrawdown(DRAWDOWN_BAND_LIMITS.shallow + 1e-9), 'shallow');
    assert.equal(classifyDrawdown(DRAWDOWN_BAND_LIMITS.shallow), 'moderate');
    assert.equal(classifyDrawdown(DRAWDOWN_BAND_LIMITS.moderate), 'deep');
    assert.equal(classifyDrawdown(DRAWDOWN_BAND_LIMITS.deep), 'severe');
    assert.equal(classifyDrawdown(-0.55), 'severe');
  });
});

describe('deriveMarketRisk', () => {
  it('reports the widest-moving benchmark for each dimension', () => {
    const risk = deriveMarketRisk([
      { symbol: 'SPY', summary: summary({ volatility: 0.15, maxDrawdown: -0.08 }) },
      { symbol: 'QQQ', summary: summary({ volatility: 0.22, maxDrawdown: -0.06 }) },
      { symbol: 'DIA', summary: summary({ volatility: 0.13, maxDrawdown: -0.13 }) },
    ]);

    assert.ok(risk);
    assert.equal(risk.volatilitySymbol, 'QQQ');
    assert.equal(risk.volatility, 0.22);
    assert.equal(risk.volatilityBand, 'elevated');
    assert.equal(risk.drawdownSymbol, 'DIA');
    assert.equal(risk.drawdown, -0.13);
    assert.equal(risk.drawdownBand, 'deep');
  });

  it('still summarizes when only some benchmarks loaded', () => {
    const risk = deriveMarketRisk([
      { symbol: 'SPY', summary: summary({ volatility: 0.1, maxDrawdown: -0.02 }) },
    ]);
    assert.ok(risk);
    assert.equal(risk.volatilityBand, 'calm');
    assert.equal(risk.drawdownBand, 'shallow');
  });

  it('returns undefined rather than a band with no basis', () => {
    assert.equal(deriveMarketRisk([]), undefined);
    assert.equal(
      deriveMarketRisk([{ symbol: 'SPY', summary: summary({ volatility: undefined }) }]),
      undefined,
    );
  });
});
