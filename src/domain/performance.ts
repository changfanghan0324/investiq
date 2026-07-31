// Purpose: Pure performance measures for the DCA engine — a cash-flow-neutral
// Time-Weighted Return (TWR) and an investor-experience Money-Weighted Return
// (MWRR / annualized XIRR).
//
// Scope and conventions:
// - Deterministic: no clock, no randomness, no I/O.
// - TWR is computed from the flow-neutral unit-value (NAV-per-unit) series the engine
//   already maintains. External contributions issue units at the pre-flow unit value
//   and never move it; dividends, dividend tax, broker fees, and reinvestment stay
//   inside the unit value. Daily sub-period returns are geometrically linked.
// - MWRR is the annualized rate that discounts the dated external cash flows to zero.
//   Contributions are negative flows on their execution dates; the after-fee/after-tax
//   ending value is the terminal positive flow. Reinvested dividends are internal and
//   are never external flows.
// - Neither measure is ever NaN or Infinity. A period too short to annualize reports
//   the period figure with no annualization; a cash-flow set with no root, no external
//   flow, invalid amounts/dates, or a non-conventional (ambiguous/multiple-root) sign
//   pattern is reported as undefined with an explanatory status, never as zero.
//
// DAY-COUNT CONVENTION (model convention, applied consistently): time is measured in
// years as actual calendar days / 365.25 — the same `CALENDAR_DAYS_PER_YEAR` used for
// TWR annualization and CAGR across the app. This is a documented MODEL convention, not
// the Actual/365 (fixed) convention some XIRR implementations use; it is stated here, in
// the README, and on the Methodology page so a reader can reproduce every figure.
//
// Authoritative methodology: GIPS Standards Handbook for Firms — true TWR links
// sub-period returns geometrically at external cash flows; MWR reflects the timing and
// size of external cash flows using daily dated flows.
// https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/

import { CALENDAR_DAYS_PER_YEAR } from '@/domain/analytics';
import type {
  DateString,
  MoneyWeightedReturn,
  PortfolioPoint,
  TimeWeightedReturn,
} from '@/types/backtest';
import { daysBetween } from '@/utils/date';

/** At least a full calendar year must elapse before a return is annualized. */
export const MIN_ANNUALIZATION_DAYS = 365;

/** The documented XIRR/MWRR day-count denominator (365.25), consistent with TWR and CAGR. */
export const XIRR_DAYS_PER_YEAR = CALENDAR_DAYS_PER_YEAR;

/** Deterministic bracketed-solver bounds for the XIRR/MWRR root search. */
const XIRR_MAX_ITERATIONS = 200;
/** Convergence on the rate interval width, in decimal-fraction rate units. */
const XIRR_RATE_TOLERANCE = 1e-9;
/** Just above a total loss (-100%); the mathematical lower bound of an annual rate. */
const XIRR_RATE_LOWER = -0.999_999_9;
/** The solver refuses to search beyond this rate rather than crawl toward infinity. */
const XIRR_RATE_UPPER_CAP = 1e7;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for an exact, real UTC calendar date. The regex alone would accept impossible
 * dates like 2024-13-40 or 2024-02-30, so the string must also round-trip through a UTC
 * Date: an out-of-range month/day either fails to parse or normalizes to a different day,
 * and both are rejected. A valid leap day (2024-02-29) round-trips and is accepted.
 */
function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

/**
 * Combines every cash flow that shares a date into a single net flow, sorted ascending by
 * date. Netting BEFORE any sign-pattern or root analysis means a same-day contribution and
 * terminal value are seen as one flow, so an all-negative net set cannot be mistaken for a
 * solvable one and a same-day offset is classified honestly.
 */
function netByDate(flows: DatedCashFlow[]): DatedCashFlow[] {
  const totals = new Map<string, number>();
  for (const flow of flows) {
    totals.set(flow.date, (totals.get(flow.date) ?? 0) + flow.amount);
  }
  return [...totals]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One external cash flow: negative is money contributed in, positive is value returned. */
export interface DatedCashFlow {
  date: DateString;
  amount: number;
}

/**
 * Cash-flow-neutral Time-Weighted Return from the unit-value series.
 *
 * The unit value is 1.0 at the moment the first external flow issues units and moves
 * only with portfolio economics afterwards, so geometrically linking the daily
 * sub-period unit-value returns (seeded at that 1.0 base) yields the since-inception
 * TWR. Writing it as the explicit geometric link — rather than `finalUnitValue - 1` —
 * keeps a mid-series zero (a total loss the engine locks at unit value 0) pinned at
 * -100% instead of propagating a divide-by-zero.
 *
 * Annualization is reported only after at least `MIN_ANNUALIZATION_DAYS` elapsed; a
 * shorter window returns the period figure with `annualizationEligible: false` and no
 * `annualized` value, so no sub-year result is ever inflated to a yearly rate.
 *
 * The window starts at the first invested session and retains EVERY subsequent point,
 * including a later zero-value point. Dropping trailing zero/no-flow points would let a
 * true terminal total loss disappear and read as 0%, so a portfolio that ends worthless
 * correctly reports -100%.
 */
export function timeWeightedReturn(portfolio: PortfolioPoint[]): TimeWeightedReturn {
  const firstInvested = portfolio.findIndex((point) => point.externalFlow > 0 || point.value > 0);
  if (firstInvested < 0) {
    return { cumulative: 0, durationDays: 0, annualizationEligible: false };
  }
  const invested = portfolio.slice(firstInvested);

  let growth = 1;
  let previousUnitValue = 1;
  for (const point of invested) {
    if (growth !== 0 && previousUnitValue > 0 && Number.isFinite(previousUnitValue)) {
      growth *= point.unitValue / previousUnitValue;
    } else {
      // A prior total loss keeps the compounded growth — and thus cumulative TWR — at
      // -100% no matter what later rebasing does to the operational unit count.
      growth = 0;
    }
    previousUnitValue = point.unitValue;
  }
  const cumulative = Number.isFinite(growth) ? growth - 1 : -1;

  const durationDays = daysBetween(invested[0].date, invested[invested.length - 1].date);
  const annualizationEligible = durationDays >= MIN_ANNUALIZATION_DAYS;
  if (!annualizationEligible) {
    return { cumulative, durationDays, annualizationEligible };
  }

  const years = durationDays / CALENDAR_DAYS_PER_YEAR;
  const base = 1 + cumulative;
  const annualized = base > 0 ? base ** (1 / years) - 1 : -1;
  return { cumulative, annualized, durationDays, annualizationEligible };
}

/**
 * Builds the dated external cash-flow set for an MWRR/XIRR solve: every external
 * contribution as a negative flow on its execution date, plus the after-fee/after-tax
 * terminal value as the final positive flow. Reinvested dividends are internal and
 * deliberately excluded.
 */
export function externalCashFlows(
  portfolio: PortfolioPoint[],
  terminalValue: number,
  terminalDate: DateString,
): DatedCashFlow[] {
  const flows: DatedCashFlow[] = [];
  for (const point of portfolio) {
    if (point.externalFlow > 0) {
      flows.push({ date: point.date, amount: -point.externalFlow });
    }
  }
  flows.push({ date: terminalDate, amount: terminalValue });
  return flows;
}

/**
 * Investor-experience Money-Weighted Return (annualized XIRR).
 *
 * Validation is strict rather than forgiving, so a malformed set is refused instead of
 * silently cleaned into a plausible-looking number:
 * - any non-finite amount or non-real UTC calendar date → `invalid-flows`;
 * - fewer than two dated net flows, or no contributed (net-negative) flow → `no-external-flows`;
 * - anything other than the conventional one-sign-change pattern (contributions, then a
 *   terminal positive value) → `ambiguous-flows`, because a unique real root is not
 *   guaranteed and a single bracketed root would be arbitrary.
 *
 * Terminal-flow contract. Flows are first netted by date, so same-day flows combine before
 * any sign or root analysis. `externalCashFlows` always appends the after-fee/after-tax
 * ending value as the terminal (largest-date) flow, so a total loss is signalled by the
 * terminal net being exactly 0. When there is no positive net flow at all, the only defined
 * outcome is that total loss (terminal net exactly 0 with contributions before it → a
 * defined -100%); a terminal date whose net is negative — e.g. a same-day contribution not
 * fully offset, or two contributions with no terminal value — has no root and is
 * `no-solution`. An exact same-day offset where a positive terminal value cancels a same-day
 * contribution nets that date to 0 and is therefore classified as the -100% total loss (the
 * earlier contributions are entirely unrecovered).
 *
 * When a positive net flow does exist, net-zero dates are dropped (they add 0 to NPV at any
 * rate) and the conventional pattern places the positive terminal at the largest time, so
 * NPV → +∞ as the rate approaches -1 and → the first (negative) contribution as the rate
 * grows. The solver therefore knows the low bracket is positive without evaluating NPV at
 * the -1 boundary (which could overflow on long histories), expands the upper bracket until
 * NPV turns negative, and bisects under explicit iteration and rate-tolerance bounds. Every
 * returned rate is finite; a set that cannot be bracketed is `no-solution` and one that
 * exhausts the iteration budget is `not-converged` — never zero, never NaN.
 */
export function moneyWeightedReturn(flows: DatedCashFlow[]): MoneyWeightedReturn {
  for (const flow of flows) {
    if (!Number.isFinite(flow.amount) || !isRealCalendarDate(flow.date)) {
      return { status: 'invalid-flows' };
    }
  }

  // Net same-day flows before any analysis (defect: a same-day contribution and terminal
  // value must combine, or an all-negative net set can be mistaken for solvable).
  const netted = netByDate(flows);
  const hasContribution = netted.some((flow) => flow.amount < 0);
  if (netted.length < 2 || !hasContribution) {
    return { status: 'no-external-flows' };
  }

  if (!netted.some((flow) => flow.amount > 0)) {
    // No positive net flow anywhere. Only an explicit terminal value of zero (the last
    // date netting to exactly 0) is a defined total loss; a net-negative terminal has no root.
    return netted[netted.length - 1].amount === 0
      ? { status: 'available', annualizedRate: -1 }
      : { status: 'no-solution' };
  }

  // A positive net flow exists. Drop net-zero dates (they add 0 to NPV at any rate) and
  // require exactly one sign change, negative-to-positive: contributions, then a terminal
  // positive value. Any other pattern is not guaranteed to have a unique root.
  const ordered = netted.filter((flow) => flow.amount !== 0);
  const signs = ordered.map((flow) => (flow.amount < 0 ? -1 : 1));
  let signChanges = 0;
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) signChanges += 1;
  }
  if (signs[0] > 0 || signChanges !== 1) {
    return { status: 'ambiguous-flows' };
  }

  const firstDate = ordered[0].date;
  const times = ordered.map((flow) => daysBetween(firstDate, flow.date) / XIRR_DAYS_PER_YEAR);
  if (times[times.length - 1] <= 0) {
    // Every non-zero flow on one date: a zero-day span cannot be annualized.
    return { status: 'ambiguous-flows' };
  }

  const netPresentValue = (rate: number): number => {
    let total = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      total += ordered[index].amount / (1 + rate) ** times[index];
    }
    return total;
  };

  // Expand the upper bracket until NPV turns negative (the first contribution dominates).
  let high = 1;
  let highNpv = netPresentValue(high);
  while (highNpv > 0 && high < XIRR_RATE_UPPER_CAP) {
    high *= 2;
    highNpv = netPresentValue(high);
  }
  if (highNpv === 0) return { status: 'available', annualizedRate: high };
  if (highNpv > 0) return { status: 'no-solution' };

  // The low bracket is positive by the validated pattern, so it is never evaluated at
  // the -1 boundary. A non-finite NPV near that boundary is treated as the positive side.
  let low = XIRR_RATE_LOWER;
  for (let iteration = 0; iteration < XIRR_MAX_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    if ((high - low) / 2 < XIRR_RATE_TOLERANCE) {
      return { status: 'available', annualizedRate: mid };
    }
    const npvMid = netPresentValue(mid);
    if (!Number.isFinite(npvMid) || npvMid > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return { status: 'not-converged' };
}
