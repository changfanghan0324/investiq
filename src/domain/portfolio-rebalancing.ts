// Purpose: Pure, deterministic periodic-rebalancing simulator for a long-only portfolio.
//
// Scope and conventions:
// - This is a transparent accounting RULE, not an optimizer or a forecast. It compounds each
//   holding's "sleeve" of capital by that holding's daily return, and on each scheduled boundary
//   resets the sleeves back to the target weights. Nothing here reads correlations, expected
//   returns, or a covariance matrix, and it never places a trade.
// - Every return and weight is a decimal fraction (0.05 is +5%, 0.25 is a 25% weight). Nothing in
//   this module converts to percent, rounds for display, or formats.
// - Every function is deterministic: no clock, no randomness, no I/O. The same input always yields
//   the identical output.
// - The simulation is fully self-financing: no external cash flows, and rebalancing preserves the
//   total value exactly (it only redistributes it across sleeves).
// - Trading is frictionless by construction: zero modeled commissions, spreads, taxes, or slippage.
//   Reported turnover is therefore an information-only diagnostic of how much the schedule moved the
//   weights, NOT a cost. A real rebalance would incur costs this educational model omits.
// - `frequency: 'none'` is exactly buy-and-hold sleeve math: the sleeves compound and are never
//   reset, so it is the drift benchmark the periodic frequencies are measured against.

import { AnalyticsError, validateWeights } from '@/domain/analytics';
import type { DatedValue } from '@/domain/analytics';
import type { DateString } from '@/types/backtest';
import { addMonthsClamped } from '@/utils/date';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The largest number of holdings this simulator accepts; keeps the model small and auditable. */
export const MAX_REBALANCING_HOLDINGS = 10;

/**
 * How often the sleeves are reset to their target weights.
 * - `none`: never; the sleeves compound untouched (buy-and-hold).
 * - `quarterly`: on the first shared session on or after every 3-calendar-month boundary.
 * - `annual`: on the first shared session on or after every 12-calendar-month boundary.
 */
export type RebalanceFrequency = 'none' | 'quarterly' | 'annual';

/** Calendar months between schedule boundaries for each periodic frequency. */
const STEP_MONTHS: Record<Exclude<RebalanceFrequency, 'none'>, number> = {
  quarterly: 3,
  annual: 12,
};

/** One holding: a symbol, its long-only target weight, and its daily return series. */
export interface RebalancingHolding {
  symbol: string;
  /** Target portfolio weight as a fraction; long-only, so never negative. */
  targetWeight: number;
  /** Daily returns as decimal fractions, each stamped with the session date it was earned on. */
  returns: DatedValue[];
}

/** The full deterministic input to {@link simulatePeriodicRebalancing}. */
export interface RebalancingInput {
  holdings: RebalancingHolding[];
  /** The date the portfolio is funded; all shared session dates must fall strictly after it. */
  initialDate: DateString;
  /** The total starting value; strictly positive and finite. */
  initialValue: number;
  frequency: RebalanceFrequency;
}

/** A single scheduled rebalance, with the weights it corrected and the turnover it implied. */
export interface RebalanceEvent {
  /** The shared session on which the reset happened (first session on/after the boundary). */
  date: DateString;
  /** Drifted weights just before the reset, aligned to the input holdings order. */
  weightsBefore: number[];
  /** Weights just after the reset — always the target weights, aligned to the holdings order. */
  weightsAfter: number[];
  /** One-way turnover: 0.5 · Σ|target − before|, the fraction of the portfolio traded one way. */
  oneWayTurnover: number;
  /** Gross turnover: Σ|target − before|, the total absolute weight moved (buys plus sells). */
  grossTurnover: number;
}

/** The deterministic result of a rebalancing simulation. */
export interface RebalancingResult {
  frequency: RebalanceFrequency;
  /** Holding symbols in the order every weight array in this result is aligned to. */
  symbols: string[];
  /** Total portfolio value on each date, beginning with `initialValue` on `initialDate`. */
  valueSeries: DatedValue[];
  /** Portfolio daily returns, one per shared session, each stamped with the session date. */
  dailyReturns: DatedValue[];
  /** Total value on the final shared session. */
  endingValue: number;
  /** Cumulative return over the whole window: endingValue / initialValue − 1. */
  totalReturn: number;
  /** Every scheduled rebalance, in chronological order; empty when `frequency` is `none`. */
  events: RebalanceEvent[];
  /** Mean one-way turnover across `events`; 0 when there are no events. */
  averageTurnover: number;
  /** Sum of one-way turnover across `events`; 0 when there are no events. */
  totalTurnover: number;
}

/**
 * Simulates a long-only portfolio rebalanced on a fixed calendar cadence.
 *
 * Method, stated exactly:
 * - Sleeves: the portfolio starts split into one sleeve per holding, sleeveᵢ = initialValue · targetᵢ.
 * - Compounding: on each shared session (a date present in EVERY holding's return series, strictly
 *   after `initialDate`), each sleeve is multiplied by (1 + that holding's return). The total is the
 *   sum of the sleeves, and the portfolio's daily return that session is total / priorTotal − 1.
 * - Boundaries: schedule boundaries are anchored to `initialDate` at k · step calendar months
 *   (step = 3 for quarterly, 12 for annual), with month-end clamping (Jan 31 → Apr 30, not May 1).
 *   The reset for a boundary happens on the FIRST shared session on or after it. If sparse data skips
 *   several boundaries at once, they collapse into a single reset on that session — never a double
 *   reset.
 * - Reset: a reset redistributes the CURRENT total back to the target weights (sleeveᵢ = total · targetᵢ),
 *   so the total value is unchanged (self-financing) and no external cash enters or leaves.
 * - Turnover: recorded per event only; it is a diagnostic, and trading is modeled as costless.
 *
 * `none` performs no resets, so it is identical to buy-and-hold sleeve math.
 *
 * Rejections — the simulator never fabricates a path from unusable data. It throws {@link AnalyticsError}
 * for a non-ISO or invalid `initialDate`, a non-finite or non-positive `initialValue`, an unknown
 * frequency, more than {@link MAX_REBALANCING_HOLDINGS} holdings, duplicate symbols, weights that are
 * not long-only or do not sum to 1, a return series with a non-ISO date / duplicate date / non-finite
 * value / value at or below −1 (which would drive a sleeve non-positive), no dates shared by every
 * holding, or a shared session on or before `initialDate`.
 */
export function simulatePeriodicRebalancing(input: RebalancingInput): RebalancingResult {
  const { holdings, initialDate, initialValue, frequency } = input;

  if (!isValidIsoDate(initialDate)) {
    throw new AnalyticsError(`The initial date "${initialDate}" is not an ISO (YYYY-MM-DD) date.`);
  }
  if (!Number.isFinite(initialValue) || initialValue <= 0) {
    throw new AnalyticsError('The initial value must be a finite positive number.');
  }
  if (frequency !== 'none' && frequency !== 'quarterly' && frequency !== 'annual') {
    throw new AnalyticsError(`Unknown rebalancing frequency "${String(frequency)}".`);
  }
  if (holdings.length > MAX_REBALANCING_HOLDINGS) {
    throw new AnalyticsError(
      `A rebalancing portfolio accepts at most ${MAX_REBALANCING_HOLDINGS} holdings; received ${holdings.length}.`,
    );
  }

  // Reuse the shared long-only weight validation (non-empty, finite, non-negative, sums to 1).
  validateWeights(holdings.map((holding) => ({ symbol: holding.symbol, weight: holding.targetWeight })));

  const seen = new Set<string>();
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase();
    if (!symbol) throw new AnalyticsError('Every rebalancing holding needs a symbol.');
    if (seen.has(symbol)) {
      throw new AnalyticsError(`Holding ${symbol} appears more than once.`);
    }
    seen.add(symbol);
  }

  const returnMaps = holdings.map((holding) => validateReturnSeries(holding.returns, holding.symbol));

  const sharedDates = [...returnMaps[0].keys()]
    .filter((date) => returnMaps.every((byDate) => byDate.has(date)))
    .sort((left, right) => left.localeCompare(right));
  if (sharedDates.length === 0) {
    throw new AnalyticsError('No session date is shared by every holding; at least one is required.');
  }
  if (sharedDates[0] <= initialDate) {
    throw new AnalyticsError(
      `Every shared session must fall after the initial date ${initialDate}; found ${sharedDates[0]}.`,
    );
  }

  const targets = holdings.map((holding) => holding.targetWeight);
  let sleeves = targets.map((target) => initialValue * target);
  let priorTotal = initialValue;

  const valueSeries: DatedValue[] = [{ date: initialDate, value: initialValue }];
  const dailyReturns: DatedValue[] = [];
  const events: RebalanceEvent[] = [];

  const step = frequency === 'none' ? undefined : STEP_MONTHS[frequency];
  let boundaryIndex = 1;
  let boundary = step === undefined ? undefined : addMonthsClamped(initialDate, boundaryIndex * step);

  for (const date of sharedDates) {
    // Compound each sleeve by its return for this session.
    sleeves = sleeves.map((sleeve, index) => sleeve * (1 + (returnMaps[index].get(date) as number)));
    const total = sleeves.reduce((sum, sleeve) => sum + sleeve, 0);

    // The daily return is read off the totals; a reset preserves the total, so its placement within
    // the session cannot change this figure.
    dailyReturns.push({ date, value: total / priorTotal - 1 });

    if (boundary !== undefined && date >= boundary) {
      const weightsBefore = sleeves.map((sleeve) => sleeve / total);
      const grossTurnover = targets.reduce(
        (sum, target, index) => sum + Math.abs(target - weightsBefore[index]),
        0,
      );
      events.push({
        date,
        weightsBefore,
        weightsAfter: [...targets],
        oneWayTurnover: 0.5 * grossTurnover,
        grossTurnover,
      });

      // Reset the sleeves to target without changing the total (self-financing, no external cash).
      sleeves = targets.map((target) => total * target);

      // Advance past every boundary already reached so collapsed boundaries trigger only one reset.
      do {
        boundaryIndex += 1;
        boundary = addMonthsClamped(initialDate, boundaryIndex * step!);
      } while (boundary <= date);
    }

    valueSeries.push({ date, value: total });
    priorTotal = total;
  }

  const endingValue = priorTotal;
  const totalTurnover = events.reduce((sum, event) => sum + event.oneWayTurnover, 0);

  return {
    frequency,
    symbols: holdings.map((holding) => holding.symbol.trim().toUpperCase()),
    valueSeries,
    dailyReturns,
    endingValue,
    totalReturn: endingValue / initialValue - 1,
    events,
    averageTurnover: events.length === 0 ? 0 : totalTurnover / events.length,
    totalTurnover,
  };
}

/**
 * Validates one holding's daily return series and returns it as a date→value map. Rejects a non-ISO
 * date, a duplicate date, a non-finite value, or a value at or below −1 (a return of −100% or worse
 * would drive the sleeve to zero or negative, breaking the multiplicative model and every weight
 * derived from it). An empty series is allowed here; the shared-date check downstream is what
 * enforces that at least one usable session exists.
 */
function validateReturnSeries(returns: DatedValue[], symbol: string): Map<DateString, number> {
  const byDate = new Map<DateString, number>();
  for (const point of returns) {
    if (!isValidIsoDate(point.date)) {
      throw new AnalyticsError(
        `Return series for ${symbol} has a date "${point.date}" that is not an ISO (YYYY-MM-DD) date.`,
      );
    }
    if (byDate.has(point.date)) {
      throw new AnalyticsError(`Return series for ${symbol} has a duplicate date ${point.date}.`);
    }
    if (!Number.isFinite(point.value)) {
      throw new AnalyticsError(`Return series for ${symbol} has a non-finite return on ${point.date}.`);
    }
    if (point.value <= -1) {
      throw new AnalyticsError(
        `Return series for ${symbol} has a return of ${point.value} on ${point.date}; a return at ` +
          'or below -1 would drive the holding to zero or negative and is out of scope.',
      );
    }
    byDate.set(point.date, point.value);
  }
  return byDate;
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
