import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { AnalyticsError, TRADING_DAYS_PER_YEAR } from '@/domain/analytics';
import type { DatedValue, ReturnSeries } from '@/domain/analytics';
import {
  DEFAULT_FRONTIER_POINT_COUNT,
  EFFICIENT_FRONTIER_MIN_OBSERVATIONS,
  computeEfficientFrontier,
} from '@/domain/efficient-frontier';
import type { FrontierPoint } from '@/domain/efficient-frontier';

// --- Deterministic fixtures --------------------------------------------------

const BASE = Date.UTC(2024, 0, 1);

/** The i-th sequential UTC calendar day from 2024-01-01, as an ISO date. Deterministic, no clock. */
function isoDay(offset: number): string {
  return new Date(BASE + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Wraps a plain numeric return array as a dated series over sequential days from `startOffset`. */
function toSeries(symbol: string, values: number[], startOffset = 0): ReturnSeries {
  return {
    symbol,
    returns: values.map((value, index) => ({ date: isoDay(startOffset + index), value })),
  };
}

/**
 * A smooth deterministic wave, `base + amp·sin(freq·i + phase)`. Distinct frequencies/phases make the
 * columns linearly independent (so the sample covariance is positive definite) without any randomness.
 */
function wave(count: number, base: number, amp: number, freq: number, phase: number): number[] {
  return Array.from({ length: count }, (_, i) => base + amp * Math.sin(freq * i + phase));
}

function meanOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Bessel-corrected (÷ N-1) sample covariance, matching the engine's estimator, for cross-checks. */
function covOf(a: number[], b: number[]): number {
  const meanA = meanOf(a);
  const meanB = meanOf(b);
  const sum = a.reduce((total, value, index) => total + (value - meanA) * (b[index] - meanB), 0);
  return sum / (a.length - 1);
}

function approx(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function weightOf(point: FrontierPoint, symbol: string): number {
  const entry = point.weights.find((w) => w.symbol === symbol);
  assert.ok(entry, `expected a weight for ${symbol}`);
  return entry.weight;
}

// --- Tests -------------------------------------------------------------------

describe('computeEfficientFrontier', () => {
  it('reproduces the two-asset efficient branch from GMV to the high-return endpoint', () => {
    const count = 64;
    const aVals = wave(count, 0.0004, 0.012, 0.35, 0.0);
    const bVals = wave(count, 0.0021, 0.009, 0.62, 1.2);
    const frontier = computeEfficientFrontier([toSeries('AAA', aVals), toSeries('BBB', bVals)], 5);

    // Independently computed sample statistics (all series share dates, so columns are the raw values).
    const meanA = meanOf(aVals);
    const meanB = meanOf(bVals);
    const varA = covOf(aVals, aVals);
    const varB = covOf(bVals, bVals);
    const covAB = covOf(aVals, bVals);

    const hi = meanA < meanB ? 'BBB' : 'AAA';
    const maxMean = Math.max(meanA, meanB);
    const varHi = hi === 'AAA' ? varA : varB;
    const gmvWeightA = Math.min(1, Math.max(0, (varB - covAB) / (varA + varB - 2 * covAB)));
    const gmvWeightB = 1 - gmvWeightA;
    const gmvMean = gmvWeightA * meanA + gmvWeightB * meanB;
    const gmvVariance = gmvWeightA ** 2 * varA + gmvWeightB ** 2 * varB + 2 * gmvWeightA * gmvWeightB * covAB;

    assert.equal(frontier.points.length, 5);

    // First endpoint: the long-only global minimum-variance portfolio.
    const first = frontier.points[0];
    approx(first.targetDailyMean, gmvMean, 1e-8);
    approx(frontier.minimumVarianceDailyMean, gmvMean, 1e-8);
    approx(weightOf(first, 'AAA'), gmvWeightA, 1e-7);
    approx(weightOf(first, 'BBB'), gmvWeightB, 1e-7);
    approx(first.dailyVariance, gmvVariance, 1e-9);
    approx(first.annualizedReturn, gmvMean * TRADING_DAYS_PER_YEAR, 1e-8);
    approx(first.annualizedVolatility, Math.sqrt(gmvVariance * TRADING_DAYS_PER_YEAR), 1e-8);

    // Upper endpoint: 100% of the highest-mean asset.
    const last = frontier.points[4];
    approx(last.targetDailyMean, maxMean);
    approx(weightOf(last, hi), 1);
    approx(last.weights.find((entry) => entry.symbol !== hi)?.weight ?? Number.NaN, 0);
    approx(last.dailyVariance, varHi);

    // Interior midpoint: the two-asset weights are pinned uniquely by the two equality constraints.
    const mid = frontier.points[2];
    const target = gmvMean + (maxMean - gmvMean) * 0.5;
    approx(mid.targetDailyMean, target);
    const expectedA = (target - meanB) / (meanA - meanB);
    const expectedB = 1 - expectedA;
    approx(weightOf(mid, 'AAA'), expectedA);
    approx(weightOf(mid, 'BBB'), expectedB);
    const expectedVar = expectedA ** 2 * varA + expectedB ** 2 * varB + 2 * expectedA * expectedB * covAB;
    approx(mid.dailyVariance, expectedVar);
    approx(mid.annualizedVolatility, Math.sqrt(expectedVar * TRADING_DAYS_PER_YEAR));
  });

  it('produces non-negative, fully-invested weights that hit each target mean exactly', () => {
    const count = 80;
    const series = [
      toSeries('AAA', wave(count, 0.0003, 0.010, 0.30, 0.0)),
      toSeries('BBB', wave(count, 0.0012, 0.014, 0.51, 0.7)),
      toSeries('CCC', wave(count, 0.0025, 0.008, 0.83, 1.9)),
      toSeries('DDD', wave(count, 0.0018, 0.011, 1.10, 2.6)),
    ];
    const frontier = computeEfficientFrontier(series, 25);

    for (const point of frontier.points) {
      let sum = 0;
      let weightedMean = 0;
      for (let i = 0; i < frontier.symbols.length; i += 1) {
        const weight = point.weights[i].weight;
        assert.ok(weight >= 0, `weight ${weight} for ${point.weights[i].symbol} must be non-negative`);
        sum += weight;
        weightedMean += weight * frontier.meanDailyReturns[i];
      }
      approx(sum, 1, 1e-8);
      approx(weightedMean, point.targetDailyMean, 1e-8);
      approx(point.annualizedReturn, point.targetDailyMean * TRADING_DAYS_PER_YEAR);
      approx(point.annualizedVolatility, Math.sqrt(point.dailyVariance * TRADING_DAYS_PER_YEAR));
    }
  });

  it('finds the true minimum variance for a target, verified against an exact feasible line scan', () => {
    const count = 72;
    const aVals = wave(count, 0.0002, 0.011, 0.33, 0.0);
    const bVals = wave(count, 0.0016, 0.013, 0.58, 0.9);
    const cVals = wave(count, 0.0029, 0.009, 0.87, 2.1);
    const frontier = computeEfficientFrontier([toSeries('AAA', aVals), toSeries('BBB', bVals), toSeries('CCC', cVals)], 21);

    const means = [meanOf(aVals), meanOf(bVals), meanOf(cVals)];
    const cov = [
      [covOf(aVals, aVals), covOf(aVals, bVals), covOf(aVals, cVals)],
      [covOf(bVals, aVals), covOf(bVals, bVals), covOf(bVals, cVals)],
      [covOf(cVals, aVals), covOf(cVals, bVals), covOf(cVals, cVals)],
    ];
    const variance = (w: number[]): number => {
      let total = 0;
      for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) total += w[i] * cov[i][j] * w[j];
      return total;
    };

    // Check an interior frontier point (index 10 of 21) whose optimum genuinely blends all three assets.
    const point = frontier.points[10];
    const target = point.targetDailyMean;

    // The long-only feasible set for a fixed target is a line segment w0 + t·d in the simplex, where d
    // is the exact null-space direction of {Σw = 1, μᵀw = target}. Every scanned point hits the target
    // EXACTLY, so the minimum over the segment is the true constrained minimum variance.
    const loIndex = means.indexOf(Math.min(...means));
    const hiIndex = means.indexOf(Math.max(...means));
    const midIndex = 3 - loIndex - hiIndex;
    const w0 = [0, 0, 0];
    const wHi = (target - means[loIndex]) / (means[hiIndex] - means[loIndex]);
    w0[hiIndex] = wHi;
    w0[loIndex] = 1 - wHi;
    w0[midIndex] = 0;
    const d = [means[1] - means[2], means[2] - means[0], means[0] - means[1]]; // sums to 0, μ·d = 0

    let minLineVariance = Infinity;
    for (let t = -1000; t <= 1000; t += 0.02) {
      const w = [w0[0] + t * d[0], w0[1] + t * d[1], w0[2] + t * d[2]];
      if (w[0] < -1e-12 || w[1] < -1e-12 || w[2] < -1e-12) continue;
      const v = variance(w);
      if (v < minLineVariance) minLineVariance = v;
    }

    assert.ok(Number.isFinite(minLineVariance), 'the feasible line scan found at least one point');
    // The engine minimizes over the full feasible set, so it can never exceed a specific feasible point;
    // and the fine exact-target scan is close enough to confirm it did not miss a lower-variance blend.
    assert.ok(point.dailyVariance <= minLineVariance + 1e-12, 'engine variance never exceeds a feasible point');
    approx(point.dailyVariance, minLineVariance, 1e-7);
  });

  it('sweeps targets in strictly increasing order across the individual-mean range', () => {
    const count = 70;
    const frontier = computeEfficientFrontier(
      [
        toSeries('AAA', wave(count, 0.0005, 0.010, 0.4, 0.0)),
        toSeries('BBB', wave(count, 0.0020, 0.012, 0.7, 1.1)),
        toSeries('CCC', wave(count, 0.0031, 0.008, 0.9, 2.3)),
      ],
      31,
    );

    assert.equal(frontier.points.length, 31);
    approx(frontier.points[0].targetDailyMean, frontier.minimumVarianceDailyMean);
    approx(frontier.points[30].targetDailyMean, Math.max(...frontier.meanDailyReturns));
    for (let i = 1; i < frontier.points.length; i += 1) {
      assert.ok(
        frontier.points[i].targetDailyMean > frontier.points[i - 1].targetDailyMean,
        'targets must strictly increase',
      );
    }
  });

  it('is scale invariant: scaling all returns by c leaves weights fixed and scales moments by c and c²', () => {
    const count = 66;
    const base = [
      toSeries('AAA', wave(count, 0.0006, 0.011, 0.37, 0.0)),
      toSeries('BBB', wave(count, 0.0019, 0.013, 0.64, 1.0)),
      toSeries('CCC', wave(count, 0.0028, 0.009, 0.91, 2.2)),
    ];
    const c = 3.7;
    const scaled: ReturnSeries[] = base.map((entry) => ({
      symbol: entry.symbol,
      returns: entry.returns.map((point) => ({ date: point.date, value: point.value * c })),
    }));

    const original = computeEfficientFrontier(base, 15);
    const rescaled = computeEfficientFrontier(scaled, 15);

    for (let p = 0; p < original.points.length; p += 1) {
      const a = original.points[p];
      const b = rescaled.points[p];
      for (let i = 0; i < original.symbols.length; i += 1) {
        approx(b.weights[i].weight, a.weights[i].weight, 1e-9);
      }
      approx(b.annualizedReturn, a.annualizedReturn * c, 1e-9);
      approx(b.dailyVariance, a.dailyVariance * c * c, 1e-12);
    }
  });

  it('is deterministic: identical inputs yield byte-identical output', () => {
    const count = 68;
    const series = [
      toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0)),
      toSeries('BBB', wave(count, 0.0017, 0.012, 0.59, 0.8)),
      toSeries('CCC', wave(count, 0.0026, 0.008, 0.88, 2.0)),
    ];
    const first = computeEfficientFrontier(series, 21);
    const second = computeEfficientFrontier(series, 21);
    assert.deepEqual(second, first);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });

  it('defaults to the documented point count', () => {
    const count = 64;
    const frontier = computeEfficientFrontier([
      toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0)),
      toSeries('BBB', wave(count, 0.0018, 0.012, 0.60, 0.9)),
    ]);
    assert.equal(frontier.points.length, DEFAULT_FRONTIER_POINT_COUNT);
    assert.equal(frontier.observations, count);
  });

  it('diversifies a tied maximum-mean endpoint instead of choosing an arbitrary single asset', () => {
    const count = 64;
    const p2 = Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const p4 = Array.from({ length: count }, (_, i) => (Math.floor(i / 2) % 2 === 0 ? 1 : -1));
    const p8 = Array.from({ length: count }, (_, i) => (Math.floor(i / 4) % 2 === 0 ? 1 : -1));
    const a = p2.map((value) => 0.002 + 0.01 * value);
    const b = p4.map((value) => 0.002 + 0.02 * value);
    const c = p8.map((value) => 0.0005 + 0.015 * value);
    const frontier = computeEfficientFrontier([toSeries('AAA', a), toSeries('BBB', b), toSeries('CCC', c)], 9);
    const endpoint = frontier.points.at(-1)!;
    approx(endpoint.targetDailyMean, 0.002, 1e-12);
    approx(weightOf(endpoint, 'AAA'), 0.8, 1e-8);
    approx(weightOf(endpoint, 'BBB'), 0.2, 1e-8);
    approx(weightOf(endpoint, 'CCC'), 0, 1e-8);
  });

  // --- Rejections ------------------------------------------------------------

  it('rejects a singular covariance from perfectly correlated series', () => {
    const count = 64;
    const shared = wave(count, 0.0009, 0.011, 0.44, 0.3);
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries('AAA', shared),
          toSeries('BBB', shared.map((v) => v)),
          toSeries('CCC', wave(count, 0.0020, 0.009, 0.7, 1.4)),
        ]),
      AnalyticsError,
    );
  });

  it('rejects a flat (zero-variance) series', () => {
    const count = 64;
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries('AAA', new Array(count).fill(0.001)),
          toSeries('BBB', wave(count, 0.0018, 0.012, 0.6, 0.9)),
        ]),
      AnalyticsError,
    );
  });

  it('rejects too few inner-aligned observations (short window)', () => {
    const count = EFFICIENT_FRONTIER_MIN_OBSERVATIONS - 20;
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0)),
          toSeries('BBB', wave(count, 0.0018, 0.012, 0.60, 0.9)),
        ]),
      AnalyticsError,
    );
  });

  it('rejects series that overlap on too few dates (misaligned windows)', () => {
    const count = 80;
    // 80 observations each, but B starts 40 days later, so only 40 dates are shared.
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0), 0),
          toSeries('BBB', wave(count, 0.0018, 0.012, 0.60, 0.9), 40),
        ]),
      AnalyticsError,
    );
  });

  it('rejects duplicate symbols', () => {
    const count = 64;
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0)),
          toSeries('AAA', wave(count, 0.0018, 0.012, 0.60, 0.9)),
        ]),
      AnalyticsError,
    );
    assert.throws(
      () =>
        computeEfficientFrontier([
          toSeries(' aaa ', wave(count, 0.0004, 0.010, 0.31, 0.0)),
          toSeries('AAA', wave(count, 0.0018, 0.012, 0.60, 0.9)),
        ]),
      AnalyticsError,
    );
  });

  it('rejects fewer than two or more than ten series', () => {
    const count = 64;
    assert.throws(
      () => computeEfficientFrontier([toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0))]),
      AnalyticsError,
    );
    const eleven = Array.from({ length: 11 }, (_, i) =>
      toSeries(`S${i}`, wave(count, 0.0004 + i * 0.0001, 0.010, 0.3 + i * 0.05, i)),
    );
    assert.throws(() => computeEfficientFrontier(eleven), AnalyticsError);
  });

  it('rejects an invalid point count', () => {
    const count = 64;
    const series = [
      toSeries('AAA', wave(count, 0.0004, 0.010, 0.31, 0.0)),
      toSeries('BBB', wave(count, 0.0018, 0.012, 0.60, 0.9)),
    ];
    assert.throws(() => computeEfficientFrontier(series, 4), AnalyticsError);
    assert.throws(() => computeEfficientFrontier(series, 52), AnalyticsError);
    assert.throws(() => computeEfficientFrontier(series, 3.5), AnalyticsError);
  });

  it('rejects a non-ISO date and a non-finite return', () => {
    const count = 64;
    const good = toSeries('BBB', wave(count, 0.0018, 0.012, 0.60, 0.9));
    const badDate: ReturnSeries = {
      symbol: 'AAA',
      returns: [{ date: '2024/01/01', value: 0.01 }, ...wave(count, 0.0004, 0.01, 0.3, 0).slice(1).map(
        (value, i): DatedValue => ({ date: isoDay(i + 1), value }),
      )],
    };
    assert.throws(() => computeEfficientFrontier([badDate, good]), AnalyticsError);

    const impossibleDate: ReturnSeries = {
      symbol: 'AAA',
      returns: wave(count, 0.0004, 0.01, 0.3, 0).map((value, i): DatedValue => ({
        date: i === 0 ? '2024-02-30' : isoDay(i), value,
      })),
    };
    assert.throws(() => computeEfficientFrontier([impossibleDate, good]), AnalyticsError);

    const badValue: ReturnSeries = {
      symbol: 'AAA',
      returns: wave(count, 0.0004, 0.01, 0.3, 0).map((value, i): DatedValue => ({
        date: isoDay(i),
        value: i === 5 ? Number.NaN : value,
      })),
    };
    assert.throws(() => computeEfficientFrontier([badValue, good]), AnalyticsError);
  });
});
