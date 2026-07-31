import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  ValuationError,
  VALUATION_BOUNDS,
  buildDcfValuation,
  buildGrowthMarginSensitivity,
  buildComparableValuation,
  buildScenarioRange,
  buildWaccTerminalGrowthSensitivity,
  compareToCurrentPrice,
} from '@/domain/valuation';
import type { DcfAssumptions } from '@/domain/valuation';

// A hand-calculated two-period fixture. Every expected figure below is worked out by hand in
// the comments so the test is a genuine cross-check of the engine, not a snapshot of it.
//
// baseRevenue = 1000, forecastYears = 2, growth = 10%, operatingMargin = 20%, cashTax = 25%,
// D&A = 5% of revenue, CapEx = 7% of revenue, ΔNWC = 10% of incremental revenue,
// WACC = 10%, terminalGrowth = 2%, netDebt = 200, dilutedShares = 100.
//
// Year 1: Rev = 1000×1.10 = 1100; EBIT = 220; NOPAT = 165; D&A = 55; CapEx = 77;
//         ΔNWC = 0.10×(1100−1000) = 10; FCFF = 165+55−77−10 = 133; DF = 1/1.1;
//         PV = 133/1.1 = 120.909090909…
// Year 2: Rev = 1100×1.10 = 1210; EBIT = 242; NOPAT = 181.5; D&A = 60.5; CapEx = 84.7;
//         ΔNWC = 0.10×(1210−1100) = 11; FCFF = 181.5+60.5−84.7−11 = 146.3; DF = 1/1.21;
//         PV = 146.3/1.21 = 120.909090909…
// ΣPV(FCFF) = 241.818181818…
// FCFF_3 = 146.3×1.02 = 149.226; TV = 149.226/(0.10−0.02) = 1865.325;
// PV(TV) = 1865.325/1.21 = 1541.590909090…
// EV = 241.818181818… + 1541.590909090… = 1783.409090909…
// Equity = 1783.409090909… − 200 = 1583.409090909…
// Implied price = 1583.409090909…/100 = 15.83409090909…
// TV% of EV = 1541.590909090…/1783.409090909… = 0.864388…
const FIXTURE: DcfAssumptions = {
  baseRevenue: 1000,
  forecastYears: 2,
  revenueGrowth: 0.1,
  operatingMargin: 0.2,
  cashTaxRate: 0.25,
  daPercentOfRevenue: 0.05,
  capexPercentOfRevenue: 0.07,
  nwcPercentOfIncrementalRevenue: 0.1,
  wacc: 0.1,
  terminalGrowth: 0.02,
  netDebt: 200,
  dilutedShares: 100,
};

function approx(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected} (diff ${Math.abs(actual - expected)})`,
  );
}

describe('buildDcfValuation — hand-calculated fixture', () => {
  it('reproduces every forecast row exactly', () => {
    const { rows } = buildDcfValuation(FIXTURE);
    assert.equal(rows.length, 2);

    const [y1, y2] = rows;
    approx(y1.revenue, 1100);
    approx(y1.ebit, 220);
    approx(y1.nopat, 165);
    approx(y1.da, 55);
    approx(y1.capex, 77);
    approx(y1.changeInNwc, 10);
    approx(y1.fcff, 133);
    approx(y1.discountFactor, 1 / 1.1);
    approx(y1.presentValue, 133 / 1.1);

    approx(y2.revenue, 1210);
    approx(y2.ebit, 242);
    approx(y2.nopat, 181.5);
    approx(y2.da, 60.5);
    approx(y2.capex, 84.7);
    approx(y2.changeInNwc, 11);
    approx(y2.fcff, 146.3);
    approx(y2.discountFactor, 1 / 1.21);
    approx(y2.presentValue, 146.3 / 1.21);
  });

  it('reproduces the terminal-value bridge and discount timing', () => {
    const { terminal } = buildDcfValuation(FIXTURE);
    approx(terminal.finalYearFcff, 146.3);
    approx(terminal.terminalYearFcff, 146.3 * 1.02);
    approx(terminal.terminalValue, (146.3 * 1.02) / (0.1 - 0.02));
    // Terminal value is struck at the END of year N, so it discounts by N = 2 periods.
    approx(terminal.discountFactor, 1 / 1.21);
    approx(terminal.presentValueOfTerminal, ((146.3 * 1.02) / 0.08) / 1.21);
  });

  it('reproduces the enterprise-to-equity bridge and implied price', () => {
    const { bridge, impliedSharePrice, terminalValuePercentOfEnterprise } = buildDcfValuation(FIXTURE);
    const sumPv = 133 / 1.1 + 146.3 / 1.21;
    const pvTv = ((146.3 * 1.02) / 0.08) / 1.21;
    const ev = sumPv + pvTv;

    approx(bridge.sumPresentValueFcff, sumPv);
    approx(bridge.presentValueOfTerminal, pvTv);
    approx(bridge.enterpriseValue, ev);
    approx(bridge.equityValue, ev - 200);
    approx(bridge.impliedSharePrice, (ev - 200) / 100);
    approx(impliedSharePrice, (ev - 200) / 100);
    // Nonzero EV here, so the ratio is a number (the null case is exercised separately).
    assert.ok(terminalValuePercentOfEnterprise !== null);
    approx(terminalValuePercentOfEnterprise, pvTv / ev);
    // Sanity: the hand-worked implied price to full precision.
    approx(impliedSharePrice, 15.834090909090909, 1e-9);
  });
});

describe('buildDcfValuation — enterprise-to-equity bridge under different balance sheets', () => {
  it('adds net cash back to enterprise value', () => {
    const positiveNetDebt = buildDcfValuation({ ...FIXTURE, netDebt: 200 });
    const netCash = buildDcfValuation({ ...FIXTURE, netDebt: -200 });
    // Enterprise value is identical; only the bridge differs.
    approx(positiveNetDebt.bridge.enterpriseValue, netCash.bridge.enterpriseValue);
    approx(
      netCash.bridge.equityValue - positiveNetDebt.bridge.equityValue,
      400, // −(−200) versus −(200)
    );
    approx(netCash.impliedSharePrice - positiveNetDebt.impliedSharePrice, 4);
  });
});

describe('buildDcfValuation — per-year vector assumptions', () => {
  it('accepts explicit per-year vectors and applies them in order', () => {
    const scalar = buildDcfValuation(FIXTURE);
    const vector = buildDcfValuation({
      ...FIXTURE,
      revenueGrowth: [0.1, 0.1],
      operatingMargin: [0.2, 0.2],
    });
    approx(vector.impliedSharePrice, scalar.impliedSharePrice);
  });

  it('rejects a vector whose length does not match the horizon', () => {
    assert.throws(
      () => buildDcfValuation({ ...FIXTURE, revenueGrowth: [0.1, 0.1, 0.1] }),
      (error: unknown) => error instanceof ValuationError && /forecast horizon is 2/.test((error as Error).message),
    );
  });
});

describe('buildDcfValuation — tax convention on operating profits and losses', () => {
  it('applies tax to positive EBIT as EBIT × (1 − tax)', () => {
    const { rows } = buildDcfValuation(FIXTURE);
    // Year 1 EBIT = 220, tax = 25% → NOPAT = 220 × 0.75 = 165.
    approx(rows[0].nopat, 165);
    approx(rows[0].nopat, rows[0].ebit * (1 - FIXTURE.cashTaxRate));
  });

  it('imputes no tax benefit on an operating loss: NOPAT equals the full untaxed EBIT loss', () => {
    // A negative operating margin drives EBIT below zero. A naive EBIT × (1 − tax) would shrink the
    // loss (a phantom tax benefit that overstates FCFF and value); the chosen convention —
    // NOPAT = EBIT − max(EBIT, 0) × tax — carries the loss through in full.
    const loss = buildDcfValuation({ ...FIXTURE, operatingMargin: -0.1 });
    assert.ok(loss.rows.length > 0);
    for (const row of loss.rows) {
      assert.ok(row.ebit < 0);
      approx(row.nopat, row.ebit); // no benefit: NOPAT === EBIT
      // And explicitly NOT the naive shielded figure.
      assert.notEqual(row.nopat, row.ebit * (1 - FIXTURE.cashTaxRate));
    }
  });
});

describe('buildDcfValuation — WACC ≤ terminal growth rejection', () => {
  it('rejects WACC equal to terminal growth', () => {
    assert.throws(
      () => buildDcfValuation({ ...FIXTURE, wacc: 0.05, terminalGrowth: 0.05 }),
      (error: unknown) => error instanceof ValuationError && /greater than the terminal growth/.test((error as Error).message),
    );
  });

  it('rejects WACC below terminal growth', () => {
    assert.throws(
      () => buildDcfValuation({ ...FIXTURE, wacc: 0.04, terminalGrowth: 0.05 }),
      ValuationError,
    );
  });
});

describe('buildDcfValuation — invalid and non-finite inputs', () => {
  it('rejects non-positive base revenue', () => {
    assert.throws(() => buildDcfValuation({ ...FIXTURE, baseRevenue: 0 }), ValuationError);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, baseRevenue: -1 }), ValuationError);
  });

  it('rejects non-positive diluted shares', () => {
    assert.throws(() => buildDcfValuation({ ...FIXTURE, dilutedShares: 0 }), ValuationError);
  });

  it('rejects non-finite rates', () => {
    assert.throws(() => buildDcfValuation({ ...FIXTURE, wacc: Number.NaN }), ValuationError);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, terminalGrowth: Number.POSITIVE_INFINITY }), ValuationError);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, netDebt: Number.NaN }), ValuationError);
  });

  it('rejects a non-integer or out-of-range forecast horizon', () => {
    assert.throws(() => buildDcfValuation({ ...FIXTURE, forecastYears: 2.5 }), ValuationError);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, forecastYears: 0 }), ValuationError);
    assert.throws(
      () => buildDcfValuation({ ...FIXTURE, forecastYears: VALUATION_BOUNDS.forecastYears.max + 1 }),
      ValuationError,
    );
  });

  it('rejects a zero WACC even though it is inside the numeric bound', () => {
    assert.throws(
      () => buildDcfValuation({ ...FIXTURE, wacc: 0, terminalGrowth: -0.5 }),
      (error: unknown) => error instanceof ValuationError && /strictly positive/.test((error as Error).message),
    );
  });

  it('rejects assumptions outside the documented economic bounds', () => {
    assert.throws(() => buildDcfValuation({ ...FIXTURE, revenueGrowth: -1.5 }), ValuationError);
    // Revenue growth is capped at +100%/yr; a 200% scalar is out of bounds.
    assert.throws(() => buildDcfValuation({ ...FIXTURE, revenueGrowth: 2 }), ValuationError);
    assert.equal(VALUATION_BOUNDS.revenueGrowth.max, 1);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, cashTaxRate: -0.1 }), ValuationError);
    assert.throws(() => buildDcfValuation({ ...FIXTURE, capexPercentOfRevenue: 5 }), ValuationError);
  });
});

describe('buildDcfValuation — negative FCFF is honest, never hidden', () => {
  it('keeps a negative-FCFF forecast finite and signed', () => {
    // Thin margin, heavy capex: NOPAT cannot cover reinvestment, so FCFF is negative.
    const bear = buildDcfValuation({
      ...FIXTURE,
      operatingMargin: 0.02,
      capexPercentOfRevenue: 0.5,
    });
    assert.ok(bear.rows.every((row) => Number.isFinite(row.fcff)));
    assert.ok(bear.rows.some((row) => row.fcff < 0));
    assert.ok(bear.rows.every((row) => Number.isFinite(row.presentValue)));
    // A negative present value must remain negative, not clamped to zero.
    assert.ok(bear.rows.some((row) => row.presentValue < 0));
    assert.ok(Number.isFinite(bear.impliedSharePrice));
  });

  it('produces a negative implied price when equity value is negative, without clamping', () => {
    // Large net debt against a small enterprise value drives equity value below zero.
    const insolvent = buildDcfValuation({
      ...FIXTURE,
      operatingMargin: 0.03,
      capexPercentOfRevenue: 0.4,
      netDebt: 5000,
    });
    assert.ok(insolvent.bridge.equityValue < 0);
    assert.ok(insolvent.impliedSharePrice < 0);
    assert.ok(Number.isFinite(insolvent.impliedSharePrice));
  });

  it('keeps a deep-bear valuation finite rather than producing NaN/Infinity', () => {
    // With a nonzero enterprise value the TV share of EV is a finite number; the exactly-zero-EV
    // case (reported as a null ratio, not a refusal) is covered separately below.
    const deepBear = buildDcfValuation({ ...FIXTURE, operatingMargin: 0.03, capexPercentOfRevenue: 0.35 });
    assert.ok(Number.isFinite(deepBear.terminalValuePercentOfEnterprise));
    assert.ok(Number.isFinite(deepBear.impliedSharePrice));
  });
});

describe('buildDcfValuation — enterprise value of exactly zero', () => {
  it('returns a valuation with a null TV-share ratio instead of refusing outright', () => {
    // Zero every cash-flow component so every FCFF, the sum of PVs, and the terminal value are
    // all *exactly* zero — hence EV is exactly zero — while the equity bridge stays well defined.
    // EBIT = 0 → NOPAT = 0 (and, importantly, no imputed tax benefit); D&A/CapEx/ΔNWC all 0.
    const flat = buildDcfValuation({
      ...FIXTURE,
      operatingMargin: 0,
      daPercentOfRevenue: 0,
      capexPercentOfRevenue: 0,
      nwcPercentOfIncrementalRevenue: 0,
      netDebt: 200,
    });
    assert.equal(flat.bridge.enterpriseValue, 0);
    // The one genuinely-undefined figure (0/0) is withheld as null, not NaN and not a throw.
    assert.equal(flat.terminalValuePercentOfEnterprise, null);
    // The equity bridge and implied price remain available and exact: (0 − 200) / 100 = −2.
    approx(flat.bridge.equityValue, -200);
    approx(flat.impliedSharePrice, -2);
    assert.ok(Number.isFinite(flat.impliedSharePrice));
  });
});

describe('buildScenarioRange', () => {
  const bear: DcfAssumptions = { ...FIXTURE, revenueGrowth: 0.03, operatingMargin: 0.15 };
  const base: DcfAssumptions = { ...FIXTURE };
  const bull: DcfAssumptions = { ...FIXTURE, revenueGrowth: 0.18, operatingMargin: 0.25 };

  it('preserves the supplied scenario order and emits no ranking', () => {
    const range = buildScenarioRange([
      { id: 'bull', assumptions: bull },
      { id: 'bear', assumptions: bear },
      { id: 'base', assumptions: base },
    ]);
    assert.deepEqual(range.scenarios.map((s) => s.id), ['bull', 'bear', 'base']);
    // The result exposes only a numeric spread — no "best"/"target"/"recommended" field.
    assert.deepEqual(
      Object.keys(range).sort(),
      ['highImpliedSharePrice', 'lowImpliedSharePrice', 'scenarios'],
    );
  });

  it('reports the numeric low/high across scenarios', () => {
    const range = buildScenarioRange([
      { id: 'base', assumptions: base },
      { id: 'bull', assumptions: bull },
      { id: 'bear', assumptions: bear },
    ]);
    const prices = range.scenarios.map((s) => s.valuation.impliedSharePrice);
    approx(range.lowImpliedSharePrice, Math.min(...prices));
    approx(range.highImpliedSharePrice, Math.max(...prices));
    // Sanity check that the scenarios genuinely differ in the expected direction.
    assert.ok(range.highImpliedSharePrice > range.lowImpliedSharePrice);
  });

  it('rejects an empty scenario list', () => {
    assert.throws(() => buildScenarioRange([]), ValuationError);
  });
});

describe('buildWaccTerminalGrowthSensitivity', () => {
  it('decreases in WACC and increases in terminal growth where both are valid', () => {
    const waccValues = [0.08, 0.1, 0.12];
    const gValues = [0.0, 0.02, 0.04];
    const table = buildWaccTerminalGrowthSensitivity(FIXTURE, waccValues, gValues);

    assert.equal(table.rowAxis.label, 'wacc');
    assert.equal(table.columnAxis.label, 'terminalGrowth');

    // Down each column (rising WACC), the implied price falls.
    for (let c = 0; c < gValues.length; c += 1) {
      const column = table.cells.map((row) => row[c]);
      for (let r = 1; r < column.length; r += 1) {
        const prev = column[r - 1];
        const curr = column[r];
        if (prev.available && curr.available) {
          assert.ok(
            curr.impliedSharePrice < prev.impliedSharePrice,
            `implied price should fall as WACC rises (col ${c}, row ${r})`,
          );
        }
      }
    }

    // Across each row (rising terminal growth), the implied price rises.
    for (const row of table.cells) {
      for (let c = 1; c < row.length; c += 1) {
        const prev = row[c - 1];
        const curr = row[c];
        if (prev.available && curr.available) {
          assert.ok(
            curr.impliedSharePrice > prev.impliedSharePrice,
            `implied price should rise as terminal growth rises (col ${c})`,
          );
        }
      }
    }
  });

  it('marks WACC ≤ terminal-growth cells unavailable without crashing the table', () => {
    // 0.03 WACC against a 0.03 and 0.05 terminal growth are invalid pairs.
    const table = buildWaccTerminalGrowthSensitivity(FIXTURE, [0.03, 0.1], [0.03, 0.05, 0.01]);
    const invalidCell = table.cells[0][0];
    assert.equal(invalidCell.available, false);
    if (!invalidCell.available) {
      assert.match(invalidCell.reason, /terminal growth/);
    }
    // The valid row is still fully computed.
    assert.ok(table.cells[1].every((cell) => cell.available));
  });
});

describe('buildGrowthMarginSensitivity', () => {
  it('increases in both revenue growth and operating margin', () => {
    const growthValues = [0.05, 0.1, 0.15];
    const marginValues = [0.15, 0.2, 0.25];
    const table = buildGrowthMarginSensitivity(FIXTURE, growthValues, marginValues);

    // Axis semantics: rows are revenue growth, columns are operating margin, and the values echo
    // the inputs in order so cells[r][c] ↔ (growthValues[r], marginValues[c]).
    assert.equal(table.rowAxis.label, 'revenueGrowth');
    assert.equal(table.columnAxis.label, 'operatingMargin');
    assert.deepEqual(table.rowAxis.values, growthValues);
    assert.deepEqual(table.columnAxis.values, marginValues);

    // Down each column (rising growth), the implied price rises.
    for (let c = 0; c < marginValues.length; c += 1) {
      const column = table.cells.map((row) => row[c]);
      for (let r = 1; r < column.length; r += 1) {
        const prev = column[r - 1];
        const curr = column[r];
        assert.ok(prev.available && curr.available);
        if (prev.available && curr.available) {
          assert.ok(curr.impliedSharePrice > prev.impliedSharePrice);
        }
      }
    }

    // Across each row (rising margin), the implied price rises.
    for (const row of table.cells) {
      for (let c = 1; c < row.length; c += 1) {
        const prev = row[c - 1];
        const curr = row[c];
        assert.ok(prev.available && curr.available);
        if (prev.available && curr.available) {
          assert.ok(curr.impliedSharePrice > prev.impliedSharePrice);
        }
      }
    }
  });

  it('marks out-of-bounds axis values unavailable rather than throwing', () => {
    const table = buildGrowthMarginSensitivity(FIXTURE, [0.1, 5], [0.2]);
    assert.ok(table.cells[0][0].available);
    assert.equal(table.cells[1][0].available, false);
  });
});

describe('compareToCurrentPrice — separate and date-bearing', () => {
  it('returns a dated upside when a finite positive price and both dates are supplied', () => {
    const comparison = compareToCurrentPrice({
      impliedSharePrice: 15.83409090909,
      currentPrice: 12,
      valuationDate: '2026-08-01',
      quoteDate: '2026-08-01',
    });
    approx(comparison.upsideDownside, (15.83409090909 - 12) / 12);
    assert.equal(comparison.valuationDate, '2026-08-01');
    assert.equal(comparison.quoteDate, '2026-08-01');
  });

  it('returns a negative downside when the implied price is below the market price', () => {
    const comparison = compareToCurrentPrice({
      impliedSharePrice: 10,
      currentPrice: 20,
      valuationDate: '2026-08-01',
      quoteDate: '2026-08-01',
    });
    approx(comparison.upsideDownside, -0.5);
  });

  it('rejects a non-positive or non-finite current price', () => {
    assert.throws(
      () => compareToCurrentPrice({ impliedSharePrice: 15, currentPrice: 0, valuationDate: '2026-08-01', quoteDate: '2026-08-01' }),
      ValuationError,
    );
    assert.throws(
      () => compareToCurrentPrice({ impliedSharePrice: 15, currentPrice: Number.NaN, valuationDate: '2026-08-01', quoteDate: '2026-08-01' }),
      ValuationError,
    );
  });

  it('rejects a missing valuation or quote date', () => {
    assert.throws(
      () => compareToCurrentPrice({ impliedSharePrice: 15, currentPrice: 12, valuationDate: '', quoteDate: '2026-08-01' }),
      ValuationError,
    );
    assert.throws(
      () => compareToCurrentPrice({ impliedSharePrice: 15, currentPrice: 12, valuationDate: '2026-08-01', quoteDate: '   ' }),
      ValuationError,
    );
  });
});

describe('buildComparableValuation', () => {
  it('hand-calculates a P/E range from diluted EPS', () => {
    const result = buildComparableValuation({ metric: 'pe', financialMetric: 5, multiples: { low: 15, median: 20, high: 25 } });
    assert.deepEqual(result.impliedSharePrices, { low: 75, median: 100, high: 125 });
    assert.equal(result.formula, 'multiple × EPS');
  });

  it('hand-calculates an EV/revenue range through the equity bridge', () => {
    const result = buildComparableValuation({ metric: 'ev-revenue', financialMetric: 1_000, netDebt: 200, dilutedShares: 100, multiples: { low: 2, median: 3, high: 4 } });
    assert.deepEqual(result.impliedSharePrices, { low: 18, median: 28, high: 38 });
  });

  it('requires positive ordered multiples and the EV bridge inputs', () => {
    assert.throws(() => buildComparableValuation({ metric: 'pe', financialMetric: -2, multiples: { low: 10, median: 15, high: 20 } }), ValuationError);
    assert.throws(() => buildComparableValuation({ metric: 'pe', financialMetric: 2, multiples: { low: 20, median: 15, high: 25 } }), ValuationError);
    assert.throws(() => buildComparableValuation({ metric: 'ev-ebitda', financialMetric: 100, multiples: { low: 8, median: 10, high: 12 } }), ValuationError);
  });
});

describe('compareToCurrentPrice — ISO date syntax validation', () => {
  const ok = { impliedSharePrice: 15, currentPrice: 12 };

  it('accepts well-formed ISO calendar dates, including a real leap day', () => {
    assert.doesNotThrow(() =>
      compareToCurrentPrice({ ...ok, valuationDate: '2024-02-29', quoteDate: '2026-08-01' }),
    );
  });

  it('rejects malformed, wrong-order, wrong-separator, or timestamped dates', () => {
    for (const bad of ['2026/08/01', '08-01-2026', '2026-8-1', '2026-08-01T00:00:00Z', 'not-a-date', '2026-08-01 ']) {
      assert.throws(
        () => compareToCurrentPrice({ ...ok, valuationDate: bad, quoteDate: '2026-08-01' }),
        (error: unknown) => error instanceof ValuationError && /ISO calendar dates/.test((error as Error).message),
      );
    }
  });

  it('rejects impossible calendar dates (bad month, bad day, non-leap Feb 29)', () => {
    for (const bad of ['2026-13-01', '2026-00-10', '2026-02-30', '2023-02-29', '2026-04-31']) {
      assert.throws(
        () => compareToCurrentPrice({ ...ok, valuationDate: '2026-08-01', quoteDate: bad }),
        ValuationError,
      );
    }
  });
});

describe('engine performs zero rounding internally', () => {
  it('retains full floating-point precision in the implied price', () => {
    const { impliedSharePrice } = buildDcfValuation(FIXTURE);
    // The hand-worked value is a repeating decimal; a rounded engine would fail this.
    assert.notEqual(impliedSharePrice, Math.round(impliedSharePrice * 100) / 100);
    approx(impliedSharePrice, 15.834090909090909, 1e-12);
  });

  it('retains full precision in intermediate present values', () => {
    const { rows } = buildDcfValuation(FIXTURE);
    const pv1 = rows[0].presentValue;
    assert.notEqual(pv1, Math.round(pv1 * 100) / 100);
    approx(pv1, 133 / 1.1, 1e-12);
  });
});
