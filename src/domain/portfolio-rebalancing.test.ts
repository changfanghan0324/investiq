import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { AnalyticsError } from '@/domain/analytics';
import type { DatedValue } from '@/domain/analytics';
import {
  MAX_REBALANCING_HOLDINGS,
  simulatePeriodicRebalancing,
} from '@/domain/portfolio-rebalancing';
import type { RebalancingHolding, RebalancingInput } from '@/domain/portfolio-rebalancing';
import type { DateString } from '@/types/backtest';

function series(entries: Array<[DateString, number]>): DatedValue[] {
  return entries.map(([date, value]) => ({ date, value }));
}

function approx(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

/**
 * A two-holding 50/50 portfolio that drifts and spans two quarterly boundaries (2024-04-15 and
 * 2024-07-15), so it produces exactly two rebalances. Used by the invariant tests where the exact
 * path does not matter, only its structural properties.
 */
function driftInput(initialValue: number): RebalancingInput {
  const holdings: RebalancingHolding[] = [
    {
      symbol: 'AAA',
      targetWeight: 0.5,
      returns: series([
        ['2024-02-15', 0.2],
        ['2024-03-15', -0.05],
        ['2024-04-16', 0.1],
        ['2024-05-15', 0],
        ['2024-07-16', 0.08],
      ]),
    },
    {
      symbol: 'BBB',
      targetWeight: 0.5,
      returns: series([
        ['2024-02-15', -0.1],
        ['2024-03-15', 0.15],
        ['2024-04-16', 0.05],
        ['2024-05-15', 0.1],
        ['2024-07-16', -0.04],
      ]),
    },
  ];
  return { holdings, initialDate: '2024-01-15', initialValue, frequency: 'quarterly' };
}

describe('simulatePeriodicRebalancing', () => {
  it('none is buy-and-hold sleeve math (hand calculation)', () => {
    const input: RebalancingInput = {
      initialDate: '2024-01-15',
      initialValue: 1000,
      frequency: 'none',
      holdings: [
        { symbol: 'AAA', targetWeight: 0.6, returns: series([['2024-01-16', 0.1], ['2024-01-17', 0]]) },
        { symbol: 'BBB', targetWeight: 0.4, returns: series([['2024-01-16', -0.05], ['2024-01-17', 0.2]]) },
      ],
    };

    const result = simulatePeriodicRebalancing(input);

    // Sleeves: A 600 -> 660 -> 660; B 400 -> 380 -> 456. Totals 1040 then 1116.
    assert.deepEqual(
      result.valueSeries.map((point) => point.date),
      ['2024-01-15', '2024-01-16', '2024-01-17'],
    );
    approx(result.valueSeries[0].value, 1000);
    approx(result.valueSeries[1].value, 1040);
    approx(result.valueSeries[2].value, 1116);
    approx(result.dailyReturns[0].value, 0.04);
    approx(result.dailyReturns[1].value, 1116 / 1040 - 1);
    approx(result.endingValue, 1116);
    approx(result.totalReturn, 0.116);
    assert.equal(result.events.length, 0);
    assert.equal(result.averageTurnover, 0);
    assert.equal(result.totalTurnover, 0);

    // Independent buy-and-hold cross-check of the sleeve arithmetic.
    const sleeveA = 600 * 1.1 * 1;
    const sleeveB = 400 * 0.95 * 1.2;
    approx(result.endingValue, sleeveA + sleeveB);
  });

  it('quarterly resets one doubling / one flat asset (hand calculation)', () => {
    const input: RebalancingInput = {
      initialDate: '2024-01-15',
      initialValue: 1000,
      frequency: 'quarterly',
      holdings: [
        // AAA doubles before the boundary; BBB is flat throughout.
        { symbol: 'AAA', targetWeight: 0.5, returns: series([['2024-02-15', 1], ['2024-04-16', 0]]) },
        { symbol: 'BBB', targetWeight: 0.5, returns: series([['2024-02-15', 0], ['2024-04-16', 0]]) },
      ],
    };

    const result = simulatePeriodicRebalancing(input);

    // Before rebalance on 2024-04-16 (first session on/after boundary 2024-04-15): A 1000, B 500,
    // total 1500 -> weights 2/3 and 1/3.
    assert.equal(result.events.length, 1);
    const event = result.events[0];
    assert.equal(event.date, '2024-04-16');
    approx(event.weightsBefore[0], 2 / 3);
    approx(event.weightsBefore[1], 1 / 3);
    assert.deepEqual(event.weightsAfter, [0.5, 0.5]);
    approx(event.grossTurnover, 1 / 3);
    approx(event.oneWayTurnover, 1 / 6);
    approx(result.endingValue, 1500);
    approx(result.totalReturn, 0.5);
    approx(result.averageTurnover, 1 / 6);
    approx(result.totalTurnover, 1 / 6);
  });

  it('is self-financing: the value path reconstructs purely from daily returns', () => {
    const result = simulatePeriodicRebalancing(driftInput(1000));
    assert.ok(result.events.length >= 1, 'scenario should trigger at least one rebalance');

    // No external cash and total-preserving resets => every value equals the compounded daily
    // returns off the initial value. Any cash injected/withdrawn at a rebalance would break this.
    let value = 1000;
    for (let index = 0; index < result.dailyReturns.length; index += 1) {
      value *= 1 + result.dailyReturns[index].value;
      approx(result.valueSeries[index + 1].value, value);
    }
    approx(result.endingValue, value);
    assert.equal(result.valueSeries[0].date, '2024-01-15');
    assert.equal(result.valueSeries[0].value, 1000);
  });

  it('records zero turnover when all holdings share a constant return', () => {
    const input: RebalancingInput = {
      initialDate: '2024-01-15',
      initialValue: 1000,
      frequency: 'quarterly',
      holdings: [
        { symbol: 'AAA', targetWeight: 0.5, returns: series([['2024-03-15', 0.01], ['2024-04-16', 0.01]]) },
        { symbol: 'BBB', targetWeight: 0.5, returns: series([['2024-03-15', 0.01], ['2024-04-16', 0.01]]) },
      ],
    };

    const result = simulatePeriodicRebalancing(input);

    // Identical returns keep the exact-binary 0.5/0.5 weights pinned, so turnover is exactly zero.
    assert.ok(result.events.length >= 1);
    for (const event of result.events) {
      assert.equal(event.grossTurnover, 0);
      assert.equal(event.oneWayTurnover, 0);
    }
    assert.equal(result.averageTurnover, 0);
    assert.equal(result.totalTurnover, 0);
  });

  it('keeps weights summing to 1 before and after every event', () => {
    const result = simulatePeriodicRebalancing(driftInput(1000));
    assert.ok(result.events.length >= 1);
    for (const event of result.events) {
      approx(event.weightsBefore.reduce((sum, weight) => sum + weight, 0), 1);
      approx(event.weightsAfter.reduce((sum, weight) => sum + weight, 0), 1);
    }
  });

  it('is scale invariant in value but not in weights, returns, or turnover', () => {
    const base = simulatePeriodicRebalancing(driftInput(1000));
    const scaled = simulatePeriodicRebalancing(driftInput(7000));
    const factor = 7;

    approx(scaled.totalReturn, base.totalReturn);
    approx(scaled.endingValue, base.endingValue * factor);
    assert.equal(scaled.events.length, base.events.length);

    for (let index = 0; index < base.dailyReturns.length; index += 1) {
      approx(scaled.dailyReturns[index].value, base.dailyReturns[index].value);
      approx(scaled.valueSeries[index + 1].value, base.valueSeries[index + 1].value * factor);
    }
    for (let index = 0; index < base.events.length; index += 1) {
      approx(scaled.events[index].oneWayTurnover, base.events[index].oneWayTurnover);
      approx(scaled.events[index].weightsBefore[0], base.events[index].weightsBefore[0]);
    }
  });

  it('rolls collapsed boundaries in a data gap into a single reset', () => {
    const input: RebalancingInput = {
      initialDate: '2024-01-15',
      initialValue: 1000,
      frequency: 'quarterly',
      holdings: [
        // First session 2024-08-01 sits past both the 2024-04-15 and 2024-07-15 boundaries.
        { symbol: 'AAA', targetWeight: 0.5, returns: series([['2024-08-01', 0.1], ['2024-11-01', 0.1]]) },
        { symbol: 'BBB', targetWeight: 0.5, returns: series([['2024-08-01', 0], ['2024-11-01', 0]]) },
      ],
    };

    const result = simulatePeriodicRebalancing(input);

    // Boundaries 04-15 and 07-15 collapse onto 2024-08-01 (one reset), 10-15 fires on 2024-11-01.
    assert.equal(result.events.length, 2);
    assert.deepEqual(result.events.map((event) => event.date), ['2024-08-01', '2024-11-01']);
  });

  it('is deterministic across repeated runs', () => {
    const first = simulatePeriodicRebalancing(driftInput(1234));
    const second = simulatePeriodicRebalancing(driftInput(1234));
    assert.deepEqual(first, second);
  });

  it('rejects invalid input', () => {
    const holdings: RebalancingHolding[] = [
      { symbol: 'AAA', targetWeight: 0.5, returns: series([['2024-02-15', 0.1]]) },
      { symbol: 'BBB', targetWeight: 0.5, returns: series([['2024-02-15', -0.1]]) },
    ];
    const ok: RebalancingInput = { holdings, initialDate: '2024-01-15', initialValue: 1000, frequency: 'none' };

    // Baseline is valid.
    assert.doesNotThrow(() => simulatePeriodicRebalancing(ok));

    // Non-ISO initial date.
    assert.throws(() => simulatePeriodicRebalancing({ ...ok, initialDate: '01/15/2024' }), AnalyticsError);
    assert.throws(() => simulatePeriodicRebalancing({ ...ok, initialDate: '2024-02-30' }), AnalyticsError);
    // Non-positive / non-finite initial value.
    assert.throws(() => simulatePeriodicRebalancing({ ...ok, initialValue: 0 }), AnalyticsError);
    assert.throws(() => simulatePeriodicRebalancing({ ...ok, initialValue: Number.NaN }), AnalyticsError);
    // Unknown frequency.
    assert.throws(
      () => simulatePeriodicRebalancing({ ...ok, frequency: 'monthly' as unknown as 'none' }),
      AnalyticsError,
    );
    // Weights that do not sum to 1.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], targetWeight: 0.5 }, { ...holdings[1], targetWeight: 0.4 }],
        }),
      AnalyticsError,
    );
    // Negative weight.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], targetWeight: 1.2 }, { ...holdings[1], targetWeight: -0.2 }],
        }),
      AnalyticsError,
    );
    // Duplicate symbol.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], symbol: 'AAA' }, { ...holdings[1], symbol: 'AAA' }],
        }),
      AnalyticsError,
    );
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], symbol: ' aaa ' }, { ...holdings[1], symbol: 'AAA' }],
        }),
      AnalyticsError,
    );
    // Too many holdings.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: Array.from({ length: MAX_REBALANCING_HOLDINGS + 1 }, (_, index) => ({
            symbol: `T${index}`,
            targetWeight: 1 / (MAX_REBALANCING_HOLDINGS + 1),
            returns: series([['2024-02-15', 0]]),
          })),
        }),
      AnalyticsError,
    );
    // Return at or below -1.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], returns: series([['2024-02-15', -1]]) }, holdings[1]],
        }),
      AnalyticsError,
    );
    // Non-ISO return date.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [{ ...holdings[0], returns: series([['2024/02/15', 0.1]]) }, holdings[1]],
        }),
      AnalyticsError,
    );
    // No shared session across holdings.
    assert.throws(
      () =>
        simulatePeriodicRebalancing({
          ...ok,
          holdings: [
            { ...holdings[0], returns: series([['2024-02-15', 0.1]]) },
            { ...holdings[1], returns: series([['2024-03-15', -0.1]]) },
          ],
        }),
      AnalyticsError,
    );
    // Shared session on/before the initial date.
    assert.throws(
      () => simulatePeriodicRebalancing({ ...ok, initialDate: '2024-02-15' }),
      AnalyticsError,
    );
  });
});
