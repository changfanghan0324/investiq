import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  MIN_ANNUALIZATION_DAYS,
  externalCashFlows,
  moneyWeightedReturn,
  timeWeightedReturn,
} from '@/domain/performance';
import type { DatedCashFlow } from '@/domain/performance';
import type { DateString, PortfolioPoint } from '@/types/backtest';

/** A portfolio point carrying only the fields the performance measures read. */
function point(
  date: DateString,
  unitValue: number,
  value: number,
  externalFlow = 0,
): PortfolioPoint {
  return { date, value, unitValue, preFlowValue: value, externalFlow, shares: 0, cash: 0 };
}

function assertClose(actual: number | undefined, expected: number, tolerance = 1e-9): void {
  assert.ok(actual !== undefined, 'expected a value, received undefined');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe('timeWeightedReturn', () => {
  it('reports a flat, flow-neutral portfolio as 0% with no fabricated annualization', () => {
    const twr = timeWeightedReturn([
      point('2024-01-02', 1, 100, 100),
      point('2024-06-03', 1, 100),
    ]);

    assert.equal(twr.cumulative, 0);
    assert.equal(twr.annualizationEligible, false);
    assert.equal(twr.annualized, undefined);
  });

  it('links the unit-value path geometrically and annualizes past one year', () => {
    // Unit value 1.0 → 1.2 over a full year: cumulative +20%.
    const twr = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2024-07-01', 1.05, 105),
      point('2025-01-01', 1.2, 120),
    ]);

    assertClose(twr.cumulative, 0.2);
    assert.equal(twr.annualizationEligible, true);
    // (1.2)^(365.25 / durationDays) - 1, close to but not exactly 20% because the year is 366 days.
    assert.ok(twr.annualized !== undefined && Math.abs(twr.annualized - 0.2) < 0.01);
  });

  it('is flow-neutral: an extra contribution on the same unit-value path does not move it', () => {
    const withoutMidFlow = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2024-07-01', 1.1, 110),
      point('2025-01-01', 1.2, 120),
    ]);
    const withMidFlow = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2024-07-01', 1.1, 1_110, 1_000),
      point('2025-01-01', 1.2, 1_320),
    ]);

    assertClose(withMidFlow.cumulative, withoutMidFlow.cumulative);
  });

  it('holds a total loss at -100% rather than dividing by zero', () => {
    const twr = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2024-02-01', 0, 0),
      point('2024-03-01', 0, 50, 50),
    ]);

    assertClose(twr.cumulative, -1);
  });

  it('reports 0 for a portfolio that was never invested', () => {
    const twr = timeWeightedReturn([point('2024-01-01', 1, 0, 0)]);
    assert.equal(twr.cumulative, 0);
    assert.equal(twr.annualizationEligible, false);
  });

  it('reports a terminal total loss as -100%, retaining the final zero-value point', () => {
    // The last session is worthless with no external flow; it must not be dropped, or
    // the loss would vanish and read as 0%.
    const twr = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2024-06-01', 0.5, 50),
      point('2024-12-01', 0, 0),
    ]);

    assertClose(twr.cumulative, -1);
  });
});

describe('moneyWeightedReturn', () => {
  it('solves a single +10% year to the documented 365.25-day convention', () => {
    const flows: DatedCashFlow[] = [
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: 110 },
    ];
    const mwrr = moneyWeightedReturn(flows);

    assert.equal(mwrr.status, 'available');
    // 2024 is a leap year, so the span is 366 calendar days; the model annualizes over
    // 365.25 days/year, making the expected rate unambiguous and reproducible.
    const expected = 1.1 ** (365.25 / 366) - 1;
    assertClose(mwrr.annualizedRate, expected, 1e-7);
  });

  it('refuses invalid flows (non-finite amount or non-ISO date) rather than cleaning them', () => {
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: Number.NaN },
        { date: '2025-01-01', amount: 110 },
      ]),
      { status: 'invalid-flows' },
    );
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: -100 },
        { date: '2025-01-01', amount: Number.POSITIVE_INFINITY },
      ]),
      { status: 'invalid-flows' },
    );
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '01/01/2024', amount: -100 },
        { date: '2025-01-01', amount: 110 },
      ]),
      { status: 'invalid-flows' },
    );
  });

  it('refuses a non-conventional (ambiguous / multiple-root) sign pattern', () => {
    // +, −, +: two sign changes, so a unique root is not guaranteed.
    assert.equal(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: 100 },
        { date: '2024-06-01', amount: -250 },
        { date: '2025-01-01', amount: 200 },
      ]).status,
      'ambiguous-flows',
    );
    // A positive flow before any contribution is also non-conventional.
    assert.equal(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: 50 },
        { date: '2024-02-01', amount: -100 },
        { date: '2025-01-01', amount: 80 },
      ]).status,
      'ambiguous-flows',
    );
  });

  it('rejects impossible calendar dates but accepts a real leap day', () => {
    // Impossible months/days pass a regex but are not real UTC calendar dates.
    assert.equal(
      moneyWeightedReturn([
        { date: '2024-13-40', amount: -100 },
        { date: '2025-01-01', amount: 110 },
      ]).status,
      'invalid-flows',
    );
    assert.equal(
      moneyWeightedReturn([
        { date: '2024-02-30', amount: -100 },
        { date: '2025-01-01', amount: 110 },
      ]).status,
      'invalid-flows',
    );
    assert.equal(
      moneyWeightedReturn([
        { date: '2023-02-29', amount: -100 }, // 2023 is not a leap year
        { date: '2024-01-01', amount: 110 },
      ]).status,
      'invalid-flows',
    );
    // A real leap day is valid and solves.
    const leap = moneyWeightedReturn([
      { date: '2024-02-29', amount: -100 },
      { date: '2025-02-28', amount: 110 },
    ]);
    assert.equal(leap.status, 'available');
    assert.ok((leap.annualizedRate as number) > 0);
  });

  it('nets same-day flows before analysis, so an all-negative net set has no root', () => {
    // 2025 nets to −100 + 50 = −50; every net flow is negative → no root, never a boundary rate.
    const mwrr = moneyWeightedReturn([
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: -100 },
      { date: '2025-01-01', amount: 50 },
    ]);
    assert.deepEqual(mwrr, { status: 'no-solution' });
  });

  it('does not fabricate -100% for two contributions with no explicit terminal-zero entry', () => {
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: -100 },
        { date: '2025-01-01', amount: -100 },
      ]),
      { status: 'no-solution' },
    );
  });

  it('honors an explicit terminal value of 0 as −100%, even with multiple prior contributions', () => {
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: -100 },
        { date: '2024-06-01', amount: -100 },
        { date: '2025-01-01', amount: 0 }, // explicit terminal value of exactly 0
      ]),
      { status: 'available', annualizedRate: -1 },
    );
  });

  it('treats an exact same-day terminal offset (terminal date nets to 0) as the −100% boundary', () => {
    // A positive terminal value exactly cancels a same-day contribution; the earlier
    // contribution is entirely unrecovered, so this is a defined total loss.
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: -100 },
        { date: '2025-01-01', amount: -50 },
        { date: '2025-01-01', amount: 50 },
      ]),
      { status: 'available', annualizedRate: -1 },
    );
  });

  it('reports no solution when a same-day contribution leaves the terminal date net-negative', () => {
    // Explicit terminal 0 plus a same-day contribution nets the last date to −50: no root.
    assert.deepEqual(
      moneyWeightedReturn([
        { date: '2024-01-01', amount: -100 },
        { date: '2025-01-01', amount: -50 },
        { date: '2025-01-01', amount: 0 },
      ]),
      { status: 'no-solution' },
    );
  });

  it('agrees with the annualized TWR for a single lump sum', () => {
    const twr = timeWeightedReturn([
      point('2024-01-01', 1, 100, 100),
      point('2025-01-01', 1.1, 110),
    ]);
    const mwrr = moneyWeightedReturn([
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: 110 },
    ]);

    assert.ok(twr.annualized !== undefined && mwrr.annualizedRate !== undefined);
    assertClose(mwrr.annualizedRate, twr.annualized as number, 1e-6);
  });

  it('solves a flat, no-gain flow set to 0%', () => {
    const mwrr = moneyWeightedReturn([
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: 100 },
    ]);

    assert.equal(mwrr.status, 'available');
    assertClose(mwrr.annualizedRate, 0, 1e-6);
  });

  it('reflects the timing of contributions where the flow-neutral TWR would not', () => {
    // Same total contributed (200) and same terminal value (240), different timing.
    const early = moneyWeightedReturn([
      { date: '2024-01-01', amount: -200 },
      { date: '2025-01-01', amount: 240 },
    ]);
    const late = moneyWeightedReturn([
      { date: '2024-01-01', amount: -100 },
      { date: '2024-11-01', amount: -100 },
      { date: '2025-01-01', amount: 240 },
    ]);

    assert.equal(early.status, 'available');
    assert.equal(late.status, 'available');
    // Contributing later for the same ending value implies a higher money-weighted rate.
    assert.ok((late.annualizedRate as number) > (early.annualizedRate as number));
  });

  it('reports a total loss as a defined -100%, not a solver failure', () => {
    const mwrr = moneyWeightedReturn([
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: 0 },
    ]);

    assert.equal(mwrr.status, 'available');
    assert.equal(mwrr.annualizedRate, -1);
  });

  it('returns an unavailable status — never NaN — when there is no external flow', () => {
    assert.deepEqual(moneyWeightedReturn([]), { status: 'no-external-flows' });
    assert.deepEqual(moneyWeightedReturn([{ date: '2024-01-01', amount: -100 }]), {
      status: 'no-external-flows',
    });
    // A single positive flow has no contribution to earn a return on.
    assert.deepEqual(moneyWeightedReturn([{ date: '2024-01-01', amount: 100 }]), {
      status: 'no-external-flows',
    });
  });

  it('never returns NaN or Infinity for a solvable set', () => {
    const mwrr = moneyWeightedReturn([
      { date: '2020-01-01', amount: -1_000 },
      { date: '2020-06-01', amount: -500 },
      { date: '2024-01-01', amount: 2_600 },
    ]);
    assert.equal(mwrr.status, 'available');
    assert.ok(Number.isFinite(mwrr.annualizedRate));
  });
});

describe('externalCashFlows', () => {
  it('treats contributions as negative flows and the terminal value as the final positive flow', () => {
    const portfolio = [
      point('2024-01-01', 1, 100, 100),
      // A dividend-reinvestment session issues no external flow.
      point('2024-02-01', 1.02, 103),
      point('2024-03-01', 1.03, 207, 100),
    ];

    const flows = externalCashFlows(portfolio, 210, '2024-03-01');

    assert.deepEqual(flows, [
      { date: '2024-01-01', amount: -100 },
      { date: '2024-03-01', amount: -100 },
      { date: '2024-03-01', amount: 210 },
    ]);
  });

  it('keeps a reinvested dividend internal, so it never becomes an external flow', () => {
    const portfolio = [
      point('2024-01-01', 1, 100, 100),
      point('2024-02-15', 1.01, 101), // dividend reinvested: value moved, externalFlow stays 0
    ];

    const flows = externalCashFlows(portfolio, 101, '2024-02-15');
    const contributions = flows.filter((flow) => flow.amount < 0);

    assert.equal(contributions.length, 1);
    assertClose(contributions[0].amount, -100);
  });
});

describe('annualization threshold', () => {
  it('is a full calendar year', () => {
    assert.equal(MIN_ANNUALIZATION_DAYS, 365);
  });
});
